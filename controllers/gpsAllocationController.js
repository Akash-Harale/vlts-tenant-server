// controllers/gpsAllocationController.js
// GPS Allocation — Assign GPS devices to Technicians or Salespersons
//
// Improvements over the original branch:
//  ✅ Unified controller (technician + salesperson in one endpoint using `allocated_to_type`)
//  ✅ Validates GPS device exists and is ACTIVE before allocating
//  ✅ Prevents double-allocation (rejects if device already ALLOCATED)
//  ✅ GET all allocations with filters (type, status, user_id)
//  ✅ GET allocation by GPS device ID
//  ✅ GET allocations by user (technician / salesperson)
//  ✅ PUT — unallocate GPS device (sets status to UNALLOCATED + unallocated_date)
//  ✅ Audit logging on all operations
//  ✅ Proper error codes (400, 404, 409)

const GpsAllocation = require('../models/gpsAllocation');
const GPSDevice = require('../models/gpsDevice');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────
// POST /api/gps-allocations
// Allocate a GPS device to a Technician or Salesperson
// Body: { gps_device_id, allocated_to_type, allocated_to_user_id, notes }
// ─────────────────────────────────────────────────────────────
exports.allocateGps = async (req, res) => {
  const { gps_device_id, allocated_to_type, allocated_to_user_id, notes } = req.body;

  console.log('[gpsAllocation] allocateGps:', req.body);

  // ── Validate required fields ──
  if (!gps_device_id) {
    return res.status(400).json({ success: false, error: 'gps_device_id is required' });
  }
  if (!allocated_to_type || !['TECHNICIAN', 'SALESPERSON'].includes(allocated_to_type.toUpperCase())) {
    return res.status(400).json({
      success: false,
      error: 'allocated_to_type is required and must be TECHNICIAN or SALESPERSON'
    });
  }
  if (!allocated_to_user_id) {
    return res.status(400).json({ success: false, error: 'allocated_to_user_id is required' });
  }

  try {
    // ── Validate GPS device exists and is ACTIVE ──
    const device = await GPSDevice.findById(gps_device_id);
    if (!device) {
      return res.status(404).json({ success: false, error: 'GPS device not found' });
    }
    if (device.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        error: `GPS device is ${device.status} — only ACTIVE devices can be allocated`
      });
    }

    // ── Prevent double-allocation ──
    const existing = await GpsAllocation.findOne({ gps_device_id, status: 'ALLOCATED' });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: `GPS device is already allocated to user ${existing.allocated_to_user_id} as ${existing.allocated_to_type}. Unallocate it first.`
      });
    }

    // ── Create allocation ──
    const allocation = await GpsAllocation.create({
      gps_device_id,
      allocated_to_type: allocated_to_type.toUpperCase(),
      allocated_to_user_id,
      notes: notes || null,
      allocated_by: req.user?.id || null,
      status: 'ALLOCATED',
      allocated_date: new Date()
    });

    // Populate for response
    const populated = await GpsAllocation.findById(allocation._id)
      .populate('gps_device_id', 'imei serial_number model status')
      .populate('allocated_to_user_id', 'email')
      .populate('allocated_by', 'email');

    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      'create', 'gps_allocation',
      `GPS ${device.imei} allocated to ${allocated_to_type} (user: ${allocated_to_user_id})`,
      'success', req.user?.tenant_id || null, null
    );

    return res.status(201).json({ success: true, allocation: populated });

  } catch (err) {
    console.error('[gpsAllocation] allocateGps error:', err.message);
    await logger.error(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      err, 'gps_allocation', req.user?.tenant_id || null, null, 500
    );
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/gps-allocations
// List all GPS allocations
// Query filters: ?status=ALLOCATED|UNALLOCATED  ?type=TECHNICIAN|SALESPERSON
// ─────────────────────────────────────────────────────────────
exports.getAllAllocations = async (req, res) => {
  const { status, type } = req.query;
  console.log('[gpsAllocation] getAllAllocations filters:', req.query);

  try {
    const filter = {};
    if (status) filter.status = status.toUpperCase();
    if (type) filter.allocated_to_type = type.toUpperCase();

    const allocations = await GpsAllocation.find(filter)
      .populate('gps_device_id', 'imei serial_number model status manufacturer')
      .populate('allocated_to_user_id', 'email')
      .populate('allocated_by', 'email')
      .sort({ allocated_date: -1 });

    return res.json({
      success: true,
      count: allocations.length,
      allocations
    });
  } catch (err) {
    console.error('[gpsAllocation] getAllAllocations error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/gps-allocations/by-device/:gps_device_id
// Get allocation history for a specific GPS device
// ─────────────────────────────────────────────────────────────
exports.getAllocationsByDevice = async (req, res) => {
  const { gps_device_id } = req.params;
  console.log('[gpsAllocation] getAllocationsByDevice:', gps_device_id);

  try {
    const allocations = await GpsAllocation.find({ gps_device_id })
      .populate('gps_device_id', 'imei serial_number model status')
      .populate('allocated_to_user_id', 'email')
      .sort({ allocated_date: -1 });

    if (!allocations.length) {
      return res.status(404).json({ success: false, error: 'No allocations found for this GPS device' });
    }

    return res.json({ success: true, count: allocations.length, allocations });
  } catch (err) {
    console.error('[gpsAllocation] getAllocationsByDevice error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/gps-allocations/by-user/:user_id
// Get all GPS devices currently allocated to a specific user (technician or salesperson)
// Query: ?status=ALLOCATED (defaults to ALLOCATED)
// ─────────────────────────────────────────────────────────────
exports.getAllocationsByUser = async (req, res) => {
  const { user_id } = req.params;
  const { status = 'ALLOCATED' } = req.query;
  console.log('[gpsAllocation] getAllocationsByUser:', user_id, 'status:', status);

  try {
    const allocations = await GpsAllocation.find({
      allocated_to_user_id: user_id,
      status: status.toUpperCase()
    })
      .populate('gps_device_id', 'imei serial_number model status manufacturer')
      .sort({ allocated_date: -1 });

    return res.json({ success: true, count: allocations.length, allocations });
  } catch (err) {
    console.error('[gpsAllocation] getAllocationsByUser error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/gps-allocations/:id
// Get a single allocation record by its ID
// ─────────────────────────────────────────────────────────────
exports.getAllocationById = async (req, res) => {
  const { id } = req.params;
  try {
    const allocation = await GpsAllocation.findById(id)
      .populate('gps_device_id', 'imei serial_number model status manufacturer')
      .populate('allocated_to_user_id', 'email')
      .populate('allocated_by', 'email');

    if (!allocation) {
      return res.status(404).json({ success: false, error: 'Allocation not found' });
    }
    return res.json({ success: true, allocation });
  } catch (err) {
    console.error('[gpsAllocation] getAllocationById error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// PUT /api/gps-allocations/:id/unallocate
// Unallocate a GPS device — marks allocation as UNALLOCATED
// ─────────────────────────────────────────────────────────────
exports.unallocateGps = async (req, res) => {
  const { id } = req.params;
  console.log('[gpsAllocation] unallocateGps:', id);

  try {
    const allocation = await GpsAllocation.findById(id);
    if (!allocation) {
      return res.status(404).json({ success: false, error: 'Allocation not found' });
    }
    if (allocation.status === 'UNALLOCATED') {
      return res.status(400).json({ success: false, error: 'GPS device is already unallocated' });
    }

    allocation.status = 'UNALLOCATED';
    allocation.unallocated_date = new Date();
    await allocation.save();

    const populated = await GpsAllocation.findById(id)
      .populate('gps_device_id', 'imei serial_number model status')
      .populate('allocated_to_user_id', 'email');

    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      'update', 'gps_allocation',
      `GPS allocation ${id} unallocated`,
      'success', req.user?.tenant_id || null, null
    );

    return res.json({ success: true, message: 'GPS device unallocated successfully', allocation: populated });
  } catch (err) {
    console.error('[gpsAllocation] unallocateGps error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/gps-allocations/:id
// Hard-delete an allocation record (admin use only)
// ─────────────────────────────────────────────────────────────
exports.deleteAllocation = async (req, res) => {
  const { id } = req.params;
  console.log('[gpsAllocation] deleteAllocation:', id);

  try {
    const allocation = await GpsAllocation.findById(id);
    if (!allocation) {
      return res.status(404).json({ success: false, error: 'Allocation not found' });
    }
    if (allocation.status === 'ALLOCATED') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete an active allocation — unallocate it first'
      });
    }

    await allocation.deleteOne();

    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      'delete', 'gps_allocation',
      `GPS allocation ${id} deleted`,
      'success', req.user?.tenant_id || null, null
    );

    return res.json({ success: true, message: 'Allocation record deleted', deleted_id: id });
  } catch (err) {
    console.error('[gpsAllocation] deleteAllocation error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
