// routes/gpsAllocationRoutes.js
// GPS Allocation routes — assign/unassign GPS devices to Technicians or Salespersons
//
// Privilege mapping:
//   allocate_gps    → POST (allocate)
//   read_gps        → GET (list / get)
//   unallocate_gps  → PUT (unallocate)
//   delete_gps      → DELETE (hard delete)

const express = require('express');
const router = express.Router();
const gpsAllocationController = require('../controllers/gpsAllocationController');
const authMiddleware = require('../middleware/authMiddleware');

// ─── Allocate ──────────────────────────────────────────────────
// POST /api/gps-allocations
// Body: { gps_device_id, allocated_to_type: "TECHNICIAN"|"SALESPERSON", allocated_to_user_id, notes }
router.post(
  '/',
  authMiddleware(['allocate_gps']),
  gpsAllocationController.allocateGps
);

// ─── List all allocations (with optional filters) ─────────────
// GET /api/gps-allocations?status=ALLOCATED&type=TECHNICIAN
router.get(
  '/',
  authMiddleware(['read_gps_allocation']),
  gpsAllocationController.getAllAllocations
);

// ─── Get by allocation record ID ──────────────────────────────
// GET /api/gps-allocations/:id
router.get(
  '/:id',
  authMiddleware(['read_gps_allocation']),
  gpsAllocationController.getAllocationById
);

// ─── Get allocation history for a GPS device ──────────────────
// GET /api/gps-allocations/by-device/:gps_device_id
router.get(
  '/by-device/:gps_device_id',
  authMiddleware(['read_gps_allocation']),
  gpsAllocationController.getAllocationsByDevice
);

// ─── Get all GPS devices allocated to a specific user ─────────
// GET /api/gps-allocations/by-user/:user_id?status=ALLOCATED
router.get(
  '/by-user/:user_id',
  authMiddleware(['read_gps_allocation']),
  gpsAllocationController.getAllocationsByUser
);

// ─── Unallocate ────────────────────────────────────────────────
// PUT /api/gps-allocations/:id/unallocate
// Marks the allocation as UNALLOCATED (soft — keeps history)
router.put(
  '/:id/unallocate',
  authMiddleware(['unallocate_gps_allocation']),
  gpsAllocationController.unallocateGps
);

// ─── Delete ────────────────────────────────────────────────────
// DELETE /api/gps-allocations/:id
// Hard-delete an UNALLOCATED record (use sparingly)
router.delete(
  '/:id',
  authMiddleware(['delete_gps_allocation']),
  gpsAllocationController.deleteAllocation
);

module.exports = router;
