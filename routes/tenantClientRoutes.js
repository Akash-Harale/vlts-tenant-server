// routes/tenantClientRoutes.js
// Tenant client management — Create/Read/Update/Delete client companies
//
// Privilege: manage_clients
// (as defined in the tenant_admin role in the RBAC bootstrap)
// Creating a client also auto-creates a client_admin user login.

const express = require('express');
const router = express.Router();
const tenantClientController = require('../controllers/tenantClientController');
const authMiddleware = require('../middleware/authMiddleware');

// ─── Create client ────────────────────────────────────────────
// POST /api/clients
// Body: {
//   entity_name, contact_name, gst_number, cin_number,
//   address1?, address2?, city?, district?, state?, pincode?,
//   mobile_number?, whatsapp_number?, email_id,     ← company contact
//   admin_email, admin_mobile_number?, password      ← client admin login
// }
router.post(
  '/',
  authMiddleware(['manage_clients']),
  tenantClientController.createClient
);

// ─── List all clients (tenant-scoped) ────────────────────────
// GET /api/clients
router.get(
  '/',
  authMiddleware(['manage_clients']),
  tenantClientController.getClients
);

// ─── Get single client ────────────────────────────────────────
// GET /api/clients/:id
router.get(
  '/:id',
  authMiddleware(['manage_clients']),
  tenantClientController.getClientById
);

// ─── Update client ────────────────────────────────────────────
// PUT /api/clients/:id
// Note: entity_name is immutable — will be rejected
// Optional: admin_email, admin_mobile_number, admin_whatsapp_number
//           → propagates to linked Employee and User records
router.put(
  '/:id',
  authMiddleware(['manage_clients']),
  tenantClientController.updateClient
);

// ─── Delete client ────────────────────────────────────────────
// DELETE /api/clients/:id
// Blocked if client still has users (must delete users first)
router.delete(
  '/:id',
  authMiddleware(['manage_clients']),
  tenantClientController.deleteClient
);

module.exports = router;
