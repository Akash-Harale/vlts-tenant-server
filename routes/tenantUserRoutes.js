// routes/tenantUserRoutes.js
// Tenant user management — Create/Read/Update/Delete users within the tenant
//
// Privilege: create_user, read_user, update_user, delete_user
// (as defined in the tenant_admin role in the RBAC bootstrap)

const express = require('express');
const router = express.Router();
const tenantUserController = require('../controllers/tenantUserController');
const authMiddleware = require('../middleware/authMiddleware');

// ─── Create tenant user ───────────────────────────────────────
// POST /api/users
// Body: { name, email, mobile_number, designation, password, roleName }
// roleName must be a tenant-scoped role: tenant_manager, tenant_helpdesk, etc.
router.post(
  '/',
  authMiddleware(['create_user']),
  tenantUserController.createTenantUser
);

// ─── List all tenant users ────────────────────────────────────
// GET /api/users
router.get(
  '/',
  authMiddleware(['read_user']),
  tenantUserController.getTenantUsers
);

// ─── Get single tenant user ───────────────────────────────────
// GET /api/users/:id
router.get(
  '/:id',
  authMiddleware(['read_user']),
  tenantUserController.getTenantUserById
);

// ─── Update tenant user ───────────────────────────────────────
// PUT /api/users/:id
// Body: { roleName?, designation?, mobile_number? }
router.put(
  '/:id',
  authMiddleware(['update_user']),
  tenantUserController.updateTenantUser
);

// ─── Delete tenant user ───────────────────────────────────────
// DELETE /api/users/:id
router.delete(
  '/:id',
  authMiddleware(['delete_user']),
  tenantUserController.deleteTenantUser
);

module.exports = router;
