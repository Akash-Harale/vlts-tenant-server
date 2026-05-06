// controllers/gpsDeviceController.js
// GPS Device CRUD — Add, List, Get, Update, Delete

const mongoose = require('mongoose');
const GPSDevice = require('../models/gpsDevice');
const logger = require('../utils/logger');

const MAX_RETRIES = parseInt(process.env.TRANSACTION_MAX_RETRIES || '3', 10);
const BASE_DELAY_MS = parseInt(process.env.TRANSACTION_BACKOFF_MS || '100', 10);

// POST /api/gps → Add new GPS device
exports.addDevice = async (req, res) => {
  console.log(' [DEBUG] AddDevice request body:', req.body);

  const {
    imei,
    device_id,
    icc_id,
    make,
    model,
    firmware_version,
    protocol,
    sim_provider1,
    sim_provider2,
    status,
    device_type
  } = req.body;

  // Validate required fields explicitly
  if (!imei || !device_id || !icc_id) {
    return res.status(400).json({ error: 'imei, device_id, and icc_id are required fields' });
  }

  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();

    let savedDevice; // ✅ IMPORTANT

    try {
      attempt++;

      await session.withTransaction(async () => {
        // Construct the device object with explicit fields based on new schema
        const deviceData = {
          imei,
          device_id,
          icc_id,
          make,
          model,
          firmware_version,
          protocol,
          sim_provider1,
          sim_provider2
        };

        if (status) deviceData.status = status;
        if (device_type) deviceData.device_type = device_type;

        const device = new GPSDevice(deviceData);
        await device.save({ session });

        console.log(' [DEBUG] Device saved:', device);

        savedDevice = device; // ✅ store here
      });

      session.endSession();

      // ✅ AUDIT LOG
      await logger.audit(
        req.user?.employee_id || "SYSTEM",
        req.user?.employee_id?.name || "SYSTEM",
        req.user?.role || "unknown",
        "create",
        "gps_device",
        `Device ${savedDevice.imei} created`,
        "success",
        req.user?.tenant_id || null,
        req.trace_id
      );

      // ✅ RETURN CORRECT DATA
      return res.status(201).json(savedDevice);

    } catch (err) {
      session.endSession();

      if (
        err.errorLabels &&
        (err.errorLabels.includes("TransientTransactionError") ||
          err.errorLabels.includes("UnknownTransactionCommitResult"))
      ) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        if (attempt < MAX_RETRIES) {
          console.warn(` [RETRY] AddDevice attempt ${attempt} failed, retrying in ${delay}ms`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      console.error(' [ERROR] AddDevice failed:', err.message);

      await logger.error(
        req.user?.employee_id || "SYSTEM",
        req.user?.employee_id?.name || "SYSTEM",
        req.user?.role || "unknown",
        err,
        "gps_device",
        req.user?.tenant_id || null,
        req.trace_id,
        400
      );

      return res.status(400).json({ error: err.message });
    }
  }
};

// GET /api/gps → List all GPS devices
exports.getDevices = async (req, res) => {
  try {
    const devices = await GPSDevice.find();
    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      'read', 'gps_device',
      `Fetched ${devices.length} devices`,
      'success', req.user?.tenant_id || null, null
    );
    return res.json(devices);
  } catch (err) {
    console.error('[gpsDevice] getDevices error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// GET /api/gps/:id → Get single GPS device
exports.getDeviceById = async (req, res) => {
  try {
    const device = await GPSDevice.findById(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    return res.json(device);
  } catch (err) {
    console.error('[gpsDevice] getDeviceById error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// PUT /api/gps/:id → Update GPS device
exports.updateDevice = async (req, res) => {
  try {
    const device = await GPSDevice.findById(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    Object.assign(device, req.body);
    await device.save();

    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      'update', 'gps_device',
      `Updated device ${device.imei}`,
      'success', req.user?.tenant_id || null, null
    );
    return res.json({ message: 'Device updated successfully', device });
  } catch (err) {
    console.error('[gpsDevice] updateDevice error:', err.message);
    return res.status(400).json({ error: err.message });
  }
};

// DELETE /api/gps/:id → Delete GPS device
exports.deleteDevice = async (req, res) => {
  try {
    const device = await GPSDevice.findById(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    await device.deleteOne();

    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      'delete', 'gps_device',
      `Deleted device ${device.imei}`,
      'success', req.user?.tenant_id || null, null
    );
    return res.json({ message: 'Device deleted successfully', deleted_id: device._id });
  } catch (err) {
    console.error('[gpsDevice] deleteDevice error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
