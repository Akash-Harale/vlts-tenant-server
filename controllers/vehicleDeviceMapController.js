// controllers/vehicleDeviceMapController.js
// GPS-Vehicle Mapping — Allocate, Read, Update, Deallocate

const mongoose = require('mongoose');
const GPSDevice = require('../models/gpsDevice');
const VehicleDeviceMap = require('../models/vehicleDeviceMap');
const Vehicle = require('../models/vehicle');
const logger = require('../utils/logger');

const MAX_RETRIES = parseInt(process.env.TRANSACTION_MAX_RETRIES || '3', 10);
const BASE_DELAY_MS = parseInt(process.env.TRANSACTION_BACKOFF_MS || '100', 10);

function getMeta(req) {
  return {
    emp_id: req.user?.employee_id?._id?.toString() || 'SYSTEM',
    emp_name: req.user?.employee_id?.name || 'SYSTEM',
    role: req.user?.role || 'unknown',
    tenant_id: req.user?.tenant_id || null,
    trace_id: req.headers['x-request-id'] || null
  };
}

// ─────────────────────────────────────────────
// POST /api/assignments/gps-vehicle → Allocate GPS device to vehicle
// ─────────────────────────────────────────────
exports.mapDevice = async (req, res) => {
  const { gps_device_id, vehicle_id, technician_id, installation_date, installation_notes } = req.body;
  console.log('[vehicleDeviceMap] mapDevice:', { gps_device_id, vehicle_id });

  if (!gps_device_id || !vehicle_id) {
    return res.status(400).json({ error: 'Both gps_device_id and vehicle_id are required' });
  }

  const meta = getMeta(req);
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();
    let savedMapping;

    try {
      attempt++;
      await session.withTransaction(async () => {
        const vehicle = await Vehicle.findById(vehicle_id).session(session);
        if (!vehicle) { const e = new Error('Vehicle not found'); e.statusCode = 404; throw e; }

        const device = await GPSDevice.findById(gps_device_id).session(session);
        if (!device) { const e = new Error('GPS Device not found'); e.statusCode = 404; throw e; }

        if (!device.canBeMapped()) {
          device.failed_attempts += 1;
          await device.save({ session });
          const e = new Error(`Device ${device.serial_number || device.imei} is ${device.status} — cannot be mapped`);
          e.statusCode = 400;
          e.auditMessage = `Failed to map device ${device.serial_number || device.imei} to vehicle ${vehicle.registration_number}`;
          throw e;
        }

        const existing = await VehicleDeviceMap.findOne({ gps_device_id }).session(session);
        if (existing && existing.status === 'MAPPED') {
          const e = new Error('Device already mapped to another vehicle');
          e.statusCode = 409;
          e.auditMessage = `Device ${device.serial_number || device.imei} already mapped`;
          throw e;
        }

        const mapping = new VehicleDeviceMap({
          vehicle_id, gps_device_id, technician_id, installation_date, installation_notes
        });
        await mapping.save({ session });

        mapping._deviceLabel = device.serial_number || device.imei;
        mapping._vehicleLabel = vehicle.registration_number;
        savedMapping = mapping;
      });

      session.endSession();

      await logger.audit(
        meta.emp_id, meta.emp_name, meta.role,
        'create', 'vehicle_device_map',
        `Device ${savedMapping._deviceLabel} mapped to vehicle ${savedMapping._vehicleLabel}`,
        'success', meta.tenant_id, meta.trace_id
      );

      return res.status(201).json(savedMapping);

    } catch (err) {
      session.endSession();

      if (err.statusCode === 404 || err.statusCode === 400 || err.statusCode === 409) {
        await logger.audit(
          meta.emp_id, meta.emp_name, meta.role,
          'create', 'vehicle_device_map',
          err.auditMessage || err.message,
          'failed', meta.tenant_id, meta.trace_id
        );
        return res.status(err.statusCode).json({ error: err.message });
      }

      if (err.errorLabels &&
        (err.errorLabels.includes('TransientTransactionError') || err.errorLabels.includes('UnknownTransactionCommitResult'))) {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
          continue;
        }
      }

      await logger.error(meta.emp_id, meta.emp_name, meta.role, err, 'vehicle_device_map', meta.tenant_id, meta.trace_id, 500);
      return res.status(500).json({ error: err.message });
    }
  }
};

// ─────────────────────────────────────────────
// GET /api/assignments/gps-vehicle → List all active GPS-Vehicle mappings
// ─────────────────────────────────────────────
exports.getAllGPSAssignedVehicle = async (req, res) => {
  console.log('[vehicleDeviceMap] getAllGPSAssignedVehicle');
  try {
    const mappings = await VehicleDeviceMap.find({ status: 'MAPPED' })
      .populate('gps_device_id')
      .populate('vehicle_id');

    if (!mappings || mappings.length === 0) {
      return res.status(200).json([]);
    }
    return res.json(mappings);
  } catch (err) {
    console.error('[vehicleDeviceMap] getAllGPSAssignedVehicle error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/assignments/gps-vehicle/:id → Get mapping by vehicle_id or gps_device_id
// ─────────────────────────────────────────────
exports.getMappedDevice = async (req, res) => {
  const { id } = req.params;
  console.log('[vehicleDeviceMap] getMappedDevice:', id);
  try {
    let mapping = await VehicleDeviceMap.findOne({ vehicle_id: id, status: 'MAPPED' })
      .populate('gps_device_id').populate('vehicle_id');

    if (!mapping) {
      mapping = await VehicleDeviceMap.findOne({ gps_device_id: id, status: 'MAPPED' })
        .populate('gps_device_id').populate('vehicle_id');
    }

    if (!mapping) return res.status(404).json([]);

    return res.json([mapping]);
  } catch (err) {
    console.error('[vehicleDeviceMap] getMappedDevice error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// PUT /api/assignments/gps-vehicle/:deviceId → Update/replace GPS mapping for a vehicle
// ─────────────────────────────────────────────
exports.updateMapping = async (req, res) => {
  const { deviceId } = req.params;
  const { vehicle_id, technician_id, installation_date, installation_notes } = req.body;
  console.log('[vehicleDeviceMap] updateMapping:', { deviceId, vehicle_id });

  const meta = getMeta(req);
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();
    let updatedMapping;

    try {
      attempt++;
      await session.withTransaction(async () => {
        // Unmap any existing mapping for this vehicle
        await VehicleDeviceMap.updateMany(
          { vehicle_id, status: 'MAPPED' },
          { status: 'UNMAPPED', unmapped_on: new Date() },
          { session }
        );
        // Unmap this device if mapped elsewhere
        await VehicleDeviceMap.updateMany(
          { gps_device_id: deviceId, status: 'MAPPED' },
          { status: 'UNMAPPED', unmapped_on: new Date() },
          { session }
        );
        // Upsert new mapping
        const mapping = await VehicleDeviceMap.findOneAndUpdate(
          { vehicle_id, gps_device_id: deviceId },
          { vehicle_id, gps_device_id: deviceId, technician_id, installation_date, installation_notes, status: 'MAPPED' },
          { upsert: true, new: true, session }
        ).populate('gps_device_id').populate('vehicle_id');

        if (!mapping) { const e = new Error('Mapping update failed'); e.statusCode = 404; throw e; }
        updatedMapping = mapping;
      });

      session.endSession();
      await logger.audit(
        meta.emp_id, meta.emp_name, meta.role,
        'update', 'vehicle_device_map',
        `Mapping updated for vehicle ${vehicle_id}`,
        'success', meta.tenant_id, meta.trace_id
      );
      return res.json([updatedMapping]);

    } catch (err) {
      session.endSession();
      if (err.statusCode === 404) return res.status(404).json([]);
      if (err.errorLabels &&
        (err.errorLabels.includes('TransientTransactionError') || err.errorLabels.includes('UnknownTransactionCommitResult'))) {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
          continue;
        }
      }
      await logger.error(meta.emp_id, meta.emp_name, meta.role, err, 'vehicle_device_map', meta.tenant_id, meta.trace_id, 500);
      return res.status(400).json({ error: err.message });
    }
  }
};

// ─────────────────────────────────────────────
// DELETE /api/assignments/gps-vehicle/:deviceId → Deallocate GPS from vehicle
// ─────────────────────────────────────────────
exports.removeMapping = async (req, res) => {
  const { deviceId } = req.params;
  console.log('[vehicleDeviceMap] removeMapping (deallocate):', deviceId);

  const meta = getMeta(req);
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();
    try {
      attempt++;
      const mapping = await session.withTransaction(async () => {
        const m = await VehicleDeviceMap.findOneAndUpdate(
          { gps_device_id: deviceId, status: 'MAPPED' },
          { status: 'UNMAPPED', unmapped_on: new Date() },
          { new: true, session }
        ).populate('gps_device_id').populate('vehicle_id');

        if (!m) { const e = new Error('Mapping not found'); e.statusCode = 404; throw e; }
        return m;
      });

      session.endSession();

      await logger.audit(
        meta.emp_id, meta.emp_name, meta.role,
        'delete', 'vehicle_device_map',
        `Device ${deviceId} deallocated`,
        'success', meta.tenant_id, meta.trace_id
      );

      return res.json([mapping]);

    } catch (err) {
      session.endSession();
      if (err.statusCode === 404) return res.status(404).json({ error: 'Mapping not found' });
      if (err.errorLabels &&
        (err.errorLabels.includes('TransientTransactionError') || err.errorLabels.includes('UnknownTransactionCommitResult'))) {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
          continue;
        }
      }
      console.error('[vehicleDeviceMap] removeMapping error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }
};
