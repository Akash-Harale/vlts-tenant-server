// controllers/tenantClientController.js
// Purpose: Tenant Admin manages client company profiles (CRUD)
// Creating a client also provisions a client_admin Employee + User in one transaction.
// Deleting a client is blocked if it still has associated users.

const mongoose = require("mongoose");
const ClientProfile = require("../models/clientProfileModel");
const User = require("../models/userModel");
const Employee = require("../models/employeeModel");
const Role = require("../models/roleModel");
const logger = require("../utils/logger");

const MAX_RETRIES = parseInt(process.env.TRANSACTION_MAX_RETRIES || "3", 10);
const BASE_DELAY_MS = parseInt(process.env.TRANSACTION_BACKOFF_MS || "100", 10);

function getMeta(req) {
  return {
    emp_id:
      req.user?.employee_id?._id?.toString() ||
      req.user?.employee_id ||
      "SYSTEM",
    emp_name: req.user?.name || req.user?.employee_id?.name || "SYSTEM",
    role: req.user?.role || "unknown",
    tenant_id: req.user?.tenant_id || null,
    trace_id: req.headers["x-request-id"] || null,
  };
}

// ─────────────────────────────────────────────────────────────
// POST /api/clients
// Create a new client profile + client_admin user in one transaction
// Body: {
//   entity_name, contact_name, gst_number, cin_number,
//   address1, address2, city, district, state, pincode,
//   mobile_number, whatsapp_number, email_id,           ← client company contact
//   admin_email, admin_mobile_number, password           ← admin login credentials
// }
// ─────────────────────────────────────────────────────────────
exports.createClient = async (req, res) => {
  const meta = getMeta(req);
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();
    try {
      attempt++;

      const result = await session.withTransaction(async () => {
        const {
          entity_name,
          contact_name,
          gst_number,
          cin_number,
          address1,
          address2,
          city,
          district,
          state,
          pincode,
          mobile_number,
          whatsapp_number,
          email_id,
          admin_email,
          admin_mobile_number,
          password,
        } = req.body;

        // Required field validation
        if (
          !entity_name ||
          !contact_name ||
          !gst_number ||
          !cin_number ||
          !email_id
        ) {
          const e = new Error(
            "entity_name, contact_name, gst_number, cin_number and email_id are required",
          );
          e.statusCode = 400;
          throw e;
        }
        if (!admin_email || !password) {
          const e = new Error(
            "admin_email and password are required for client admin login",
          );
          e.statusCode = 400;
          throw e;
        }

        // Duplicate check on GST
        const duplicate = await ClientProfile.findOne({
          gst_number: gst_number.toUpperCase().trim(),
        }).session(session);
        if (duplicate) {
          const e = new Error("A client with this GST number already exists");
          e.statusCode = 409;
          throw e;
        }

        // Fetch client_admin role
        const clientAdminRole = await Role.findOne({
          name: "client_admin",
        }).session(session);
        if (!clientAdminRole) {
          const e = new Error(
            'Role "client_admin" not found — ensure roles are seeded',
          );
          e.statusCode = 500;
          throw e;
        }

        // Create client profile
        const [clientProfile] = await ClientProfile.create(
          [
            {
              tenant_id: req.user.tenant_id,
              entity_name,
              contact_name,
              gst_number: gst_number.toUpperCase().trim(),
              cin_number: cin_number.toUpperCase().trim(),
              address1,
              address2,
              city,
              district,
              state,
              pincode,
              mobile_number,
              whatsapp_number,
              email_id,
              auth_methods: ["local"],
              status: "active",
            },
          ],
          { session },
        );

        // Create employee for client admin
        const [employee] = await Employee.create(
          [
            {
              name: contact_name,
              email: admin_email,
              mobile_number: admin_mobile_number || null,
              designation: "Client Admin",
              scope: "client",
              tenant_id: req.user.tenant_id,
              client_profile_id: clientProfile._id,
            },
          ],
          { session },
        );

        // Create login user for client admin
        const [clientAdmin] = await User.create(
          [
            {
              employee_id: employee._id,
              email: admin_email,
              password, // pre-save hook hashes it
              role: clientAdminRole._id,
              scope: "client",
              tenant_id: req.user.tenant_id,
              client_profile_id: clientProfile._id,
            },
          ],
          { session },
        );

        return { clientProfile, employee, clientAdmin };
      });

      session.endSession();

      await logger.audit(
        meta.emp_id,
        meta.emp_name,
        meta.role,
        "create",
        "client",
        `Client "${result.clientProfile.entity_name}" created with admin ${result.clientAdmin.email}`,
        "success",
        meta.tenant_id,
        meta.trace_id,
      );

      return res.status(201).json({
        success: true,
        message: "Client created successfully",
        clientProfile: result.clientProfile,
        clientAdmin: {
          _id: result.clientAdmin._id,
          email: result.clientAdmin.email,
          employee_name: result.employee.name,
        },
      });
    } catch (err) {
      session.endSession();

      if (err.statusCode === 400 || err.statusCode === 409) {
        return res
          .status(err.statusCode)
          .json({ success: false, message: err.message });
      }

      if (
        err.errorLabels &&
        (err.errorLabels.includes("TransientTransactionError") ||
          err.errorLabels.includes("UnknownTransactionCommitResult"))
      ) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)),
          );
          continue;
        }
      }

      const statusCode = err.code === 11000 ? 409 : 500;
      const message =
        err.code === 11000
          ? "Duplicate entry (GST/CIN/email already exists)"
          : err.message;

      await logger.error(
        meta.emp_id,
        meta.emp_name,
        meta.role,
        err,
        "clientCreate",
        meta.tenant_id,
        meta.trace_id,
        statusCode,
      );
      return res.status(statusCode).json({ success: false, message });
    }
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/clients
// List all clients belonging to this tenant
// ─────────────────────────────────────────────────────────────
exports.getClients = async (req, res) => {
  const meta = getMeta(req);
  try {
    const clients = await ClientProfile.find({
      tenant_id: req.user.tenant_id,
    }).sort({ created_at: -1 });

    await logger.audit(
      meta.emp_id,
      meta.emp_name,
      meta.role,
      "read",
      "client",
      `Fetched ${clients.length} clients`,
      "success",
      meta.tenant_id,
      meta.trace_id,
    );

    return res.json({ success: true, count: clients.length, clients });
  } catch (err) {
    await logger.error(
      meta.emp_id,
      meta.emp_name,
      meta.role,
      err,
      "clientRead",
      meta.tenant_id,
      meta.trace_id,
      500,
    );
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/clients/:id
// Get a single client by ID (tenant-scoped)
// ─────────────────────────────────────────────────────────────
exports.getClientById = async (req, res) => {
  const meta = getMeta(req);
  try {
    const client = await ClientProfile.findOne({
      _id: req.params.id,
      tenant_id: req.user.tenant_id,
    });

    if (!client) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    await logger.audit(
      meta.emp_id,
      meta.emp_name,
      meta.role,
      "read",
      "client",
      `Fetched client ${client.entity_name}`,
      "success",
      meta.tenant_id,
      meta.trace_id,
    );

    return res.json({ success: true, client });
  } catch (err) {
    await logger.error(
      meta.emp_id,
      meta.emp_name,
      meta.role,
      err,
      "clientRead",
      meta.tenant_id,
      meta.trace_id,
      500,
    );
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// PUT /api/clients/:id
// Update client profile — entity_name is locked (cannot change company name)
// Also propagates admin_email changes to linked Employee and User records
// ─────────────────────────────────────────────────────────────
exports.updateClient = async (req, res) => {
  const meta = getMeta(req);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const clientId = req.params.id;

    // entity_name is immutable
    if (req.body.entity_name) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "entity_name cannot be changed after creation",
      });
    }

    // Whitelist updatable client profile fields
    const allowedFields = [
      "contact_name",
      "gst_number",
      "cin_number",
      "address1",
      "address2",
      "city",
      "district",
      "state",
      "pincode",
      "mobile_number",
      "whatsapp_number",
      "email_id",
      "status",
    ];
    const updateFields = {};
    allowedFields.forEach((f) => {
      if (req.body[f] !== undefined) updateFields[f] = req.body[f];
    });

    const client = await ClientProfile.findOneAndUpdate(
      { _id: clientId, tenant_id: req.user.tenant_id },
      { $set: updateFields },
      { new: true, runValidators: true, session },
    );

    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    // Propagate admin contact changes to Employee and User
    const empUpdate = {};
    const userUpdate = {};
    if (req.body.admin_email) {
      empUpdate.email = req.body.admin_email;
      userUpdate.email = req.body.admin_email;
    }
    if (req.body.admin_mobile_number)
      empUpdate.mobile_number = req.body.admin_mobile_number;
    if (req.body.admin_whatsapp_number)
      empUpdate.whatsapp_number = req.body.admin_whatsapp_number;

    if (Object.keys(empUpdate).length > 0) {
      await Employee.updateMany(
        { client_profile_id: clientId },
        { $set: empUpdate },
        { session },
      );
    }
    if (Object.keys(userUpdate).length > 0) {
      await User.updateMany(
        { client_profile_id: clientId },
        { $set: userUpdate },
        { session },
      );
    }

    await session.commitTransaction();
    session.endSession();

    await logger.audit(
      meta.emp_id,
      meta.emp_name,
      meta.role,
      "update",
      "client",
      `Client ${client.entity_name} updated`,
      "success",
      meta.tenant_id,
      meta.trace_id,
    );

    return res.json({
      success: true,
      message: "Client updated successfully",
      client,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    await logger.error(
      meta.emp_id,
      meta.emp_name,
      meta.role,
      err,
      "clientUpdate",
      meta.tenant_id,
      meta.trace_id,
      500,
    );
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/clients/:id
// Delete client — blocked if client still has associated users
// ─────────────────────────────────────────────────────────────
exports.deleteClient = async (req, res) => {
  const meta = getMeta(req);
  try {
    const clientId = req.params.id;

    // delete all users linked to this client first (including client_admins) — cascade delete not possible due to tenant scoping
    await User.deleteMany({
      client_profile_id: clientId,
      tenant_id: req.user.tenant_id,
    });
    // Guard: block delete if client has users
    const userCount = await User.countDocuments({
      client_profile_id: clientId,
    });
    if (userCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete client — ${userCount} user(s) still associated. Delete client users first.`,
        user_count: userCount,
      });
    }

    const client = await ClientProfile.findOneAndDelete({
      _id: clientId,
      tenant_id: req.user.tenant_id,
    });

    if (!client) {
      return res
        .status(404)
        .json({ success: false, message: "Client not found" });
    }

    // Also clean up orphaned employees for this client
    await Employee.deleteMany({ client_profile_id: clientId });

    await logger.audit(
      meta.emp_id,
      meta.emp_name,
      meta.role,
      "delete",
      "client",
      `Client "${client.entity_name}" deleted`,
      "success",
      meta.tenant_id,
      meta.trace_id,
    );

    return res.json({ success: true, message: "Client deleted successfully" });
  } catch (err) {
    await logger.error(
      meta.emp_id,
      meta.emp_name,
      meta.role,
      err,
      "clientDelete",
      meta.tenant_id,
      meta.trace_id,
      500,
    );
    return res.status(500).json({ success: false, message: err.message });
  }
};
