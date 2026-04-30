// controllers/tenantUserController.js
// Purpose: Tenant Admin manages tenant users (CRUD)
// Roles: tenant_admin, tenant_manager, tenant_helpdesk, tenant_executive, etc.
// Each user creation atomically creates an Employee + User record.

const mongoose = require('mongoose');
const User = require('../models/userModel');
const Employee = require('../models/employeeModel');
const ClientProfile = require('../models/clientProfileModel');
const Role = require('../models/roleModel');
const logger = require('../utils/logger');

const MAX_RETRIES = parseInt(process.env.TRANSACTION_MAX_RETRIES || '3', 10);
const BASE_DELAY_MS = parseInt(process.env.TRANSACTION_BACKOFF_MS || '100', 10);

function getMeta(req) {
  return {
    emp_id: req.user?.employee_id?._id?.toString() || req.user?.employee_id || 'SYSTEM',
    emp_name: req.user?.name || req.user?.employee_id?.name || 'SYSTEM',
    role: req.user?.role || 'unknown',
    tenant_id: req.user?.tenant_id || null,
    trace_id: req.headers['x-request-id'] || null
  };
}

// ─────────────────────────────────────────────────────────────
// POST /api/users
// Create a new tenant user (Employee + User in one transaction)
// Body: { name, email, mobile_number, designation, password, roleName }
// roleName must be a tenant-scoped role e.g. tenant_manager, tenant_helpdesk
// ─────────────────────────────────────────────────────────────
exports.createTenantUser = async (req, res) => {
  const meta = getMeta(req);
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();
    try {
      attempt++;

      const result = await session.withTransaction(async () => {
        const { name, email, mobile_number, designation, password, roleName } = req.body;

        if (!name || !email || !password || !roleName) {
          const e = new Error('name, email, password and roleName are required');
          e.statusCode = 400;
          throw e;
        }

        // Validate role — must be tenant-scoped
        const role = await Role.findOne({ name: roleName, scope: 'tenant' }).session(session);
        if (!role) {
          const e = new Error(`Tenant role "${roleName}" not found. Check that the role exists and has scope=tenant`);
          e.statusCode = 400;
          throw e;
        }

        // Check for duplicate email
        const existing = await User.findOne({ email }).session(session);
        if (existing) {
          const e = new Error(`A user with email "${email}" already exists`);
          e.statusCode = 409;
          throw e;
        }

        // Create Employee record
        const [employee] = await Employee.create([{
          name,
          email,
          mobile_number: mobile_number || null,
          designation: designation || null,
          scope: 'tenant',
          tenant_id: req.user.tenant_id,
          client_profile_id: null
        }], { session });

        // Create User record linked to Employee
        const [user] = await User.create([{
          employee_id: employee._id,
          email,
          password, // pre-save hook will hash
          role: role._id,
          scope: 'tenant',
          tenant_id: req.user.tenant_id
        }], { session });

        return { employee, user, roleName };
      });

      session.endSession();

      await logger.audit(
        meta.emp_id, meta.emp_name, meta.role,
        'create', 'user',
        `Tenant user ${result.user.email} created with role ${result.roleName}`,
        'success', meta.tenant_id, meta.trace_id
      );

      return res.status(201).json({
        success: true,
        message: 'Tenant user created successfully',
        user: {
          _id: result.user._id,
          email: result.user.email,
          role: result.roleName,
          employee: {
            _id: result.employee._id,
            name: result.employee.name,
            designation: result.employee.designation,
            mobile_number: result.employee.mobile_number
          }
        }
      });

    } catch (err) {
      session.endSession();

      if (err.statusCode === 400 || err.statusCode === 409) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }

      if (err.errorLabels &&
        (err.errorLabels.includes('TransientTransactionError') ||
          err.errorLabels.includes('UnknownTransactionCommitResult'))) {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
          continue;
        }
      }

      const statusCode = err.code === 11000 ? 409 : 500;
      const message = err.code === 11000 ? 'Duplicate entry — email already in use' : err.message;

      await logger.error(meta.emp_id, meta.emp_name, meta.role, err, 'tenantUserCreate', meta.tenant_id, meta.trace_id, statusCode);
      return res.status(statusCode).json({ success: false, message });
    }
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/users
// List all users belonging to this tenant
// ─────────────────────────────────────────────────────────────
exports.getTenantUsers = async (req, res) => {
  const meta = getMeta(req);
  try {

    const users = await User.find({ tenant_id: req.user.tenant_id, scope: 'tenant', role: { $ne: '69f07a3815ecfec8bb4fc4c4' } }) // also exculde this role - 69f07a3815ecfec8bb4fc4c4
      .populate('role', 'name privileges scope')
      .populate('employee_id', 'name email mobile_number designation');

    await logger.audit(
      meta.emp_id, meta.emp_name, meta.role,
      'read', 'user',
      `Fetched ${users.length} tenant users`,
      'success', meta.tenant_id, meta.trace_id
    );

    return res.json({ success: true, count: users.length, users });
  } catch (err) {
    await logger.error(meta.emp_id, meta.emp_name, meta.role, err, 'tenantUserRead', meta.tenant_id, meta.trace_id, 500);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/users/:id
// Get a single tenant user by ID
// ─────────────────────────────────────────────────────────────
exports.getTenantUserById = async (req, res) => {
  const meta = getMeta(req);
  try {
    const user = await User.findOne({
      _id: req.params.id,
      tenant_id: req.user.tenant_id
    })
      .populate('role', 'name privileges scope')
      .populate('employee_id', 'name email mobile_number designation');

    if (!user) {
      return res.status(404).json({ success: false, message: 'Tenant user not found' });
    }

    return res.json({ success: true, user });
  } catch (err) {
    await logger.error(meta.emp_id, meta.emp_name, meta.role, err, 'tenantUserRead', meta.tenant_id, meta.trace_id, 500);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// PUT /api/users/:id
// Update tenant user — can change role, designation, mobile_number
// Body: { roleName?, designation?, mobile_number? }
// ─────────────────────────────────────────────────────────────
exports.updateTenantUser = async (req, res) => {
  const meta = getMeta(req);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { roleName, designation, mobile_number } = req.body;
    const userId = req.params.id;

    if (!roleName && !designation && !mobile_number) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'At least one field (roleName, designation, mobile_number) is required'
      });
    }

    const user = await User.findOne({
      _id: userId,
      tenant_id: req.user.tenant_id
    }).populate('role').session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ success: false, message: 'Tenant user not found' });
    }

    // Role update
    if (roleName) {
      const newRole = await Role.findOne({ name: roleName, scope: 'tenant' }).session(session);
      if (!newRole) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({ success: false, message: `Invalid tenant role: ${roleName}` });
      }
      if (user.role._id.toString() === newRole._id.toString()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(200).json({ success: true, message: `User already has role ${roleName}` });
      }
      user.role = newRole._id;
      await user.save({ session });
    }

    // Employee update
    const empUpdate = {};
    if (designation) empUpdate.designation = designation;
    if (mobile_number) empUpdate.mobile_number = mobile_number;

    if (Object.keys(empUpdate).length > 0) {
      await Employee.findByIdAndUpdate(
        user.employee_id,
        { $set: empUpdate },
        { new: true, runValidators: true, session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    await logger.audit(
      meta.emp_id, meta.emp_name, meta.role,
      'update', 'user',
      `Tenant user ${userId} updated`,
      'success', meta.tenant_id, meta.trace_id
    );

    return res.status(200).json({ success: true, message: 'Tenant user updated successfully' });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    await logger.error(meta.emp_id, meta.emp_name, meta.role, err, 'tenantUserUpdate', meta.tenant_id, meta.trace_id, 500);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/users/:id
// Delete tenant user — also deletes linked Employee
// Blocks if deleting the last tenant_admin while users/clients exist
// ─────────────────────────────────────────────────────────────
exports.deleteTenantUser = async (req, res) => {
  const meta = getMeta(req);
  try {
    const user = await User.findOne({
      _id: req.params.id,
      tenant_id: req.user.tenant_id
    }).populate('role').populate('employee_id');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Guard: cannot delete last tenant_admin if tenant still has users or clients
    if (user.role?.name === 'tenant_admin') {
      const remainingUsers = await User.countDocuments({
        tenant_id: req.user.tenant_id,
        _id: { $ne: user._id }
      });
      const clientCount = await ClientProfile.countDocuments({
        tenant_id: req.user.tenant_id
      });

      if (remainingUsers > 0 || clientCount > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete Tenant Admin while tenant has active users or clients',
          remaining_users: remainingUsers,
          client_count: clientCount
        });
      }
    }

    // Delete User + Employee atomically
    await User.deleteOne({ _id: user._id });
    if (user.employee_id) {
      await Employee.findByIdAndDelete(user.employee_id._id);
    }

    await logger.audit(
      meta.emp_id, meta.emp_name, meta.role,
      'delete', 'user',
      `Tenant user ${user.employee_id?.name || user.email} deleted`,
      'success', meta.tenant_id, meta.trace_id
    );

    return res.json({ success: true, message: 'Tenant user deleted successfully' });

  } catch (err) {
    await logger.error(meta.emp_id, meta.emp_name, meta.role, err, 'tenantUserDelete', meta.tenant_id, meta.trace_id, 500);
    return res.status(500).json({ success: false, message: err.message });
  }
};
