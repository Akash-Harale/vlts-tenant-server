// controllers/gpsDeviceController.js
// GPS Device CRUD — Add, List, Get, Update, Delete

const mongoose = require('mongoose');
const GPSDevice = require('../models/gpsDevice');
const logger = require('../utils/logger');

const MAX_RETRIES = parseInt(process.env.TRANSACTION_MAX_RETRIES || '3', 10);
const BASE_DELAY_MS = parseInt(process.env.TRANSACTION_BACKOFF_MS || '100', 10);

// POST /api/gps → Add new GPS device
exports.addDevice = async (req, res) => {
  console.log('[gpsDevice] addDevice:', req.body);
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();
    let savedDevice;
    try {
      attempt++;
      await session.withTransaction(async () => {
        const device = new GPSDevice(req.body);
        await device.save({ session });
        savedDevice = device;
      });
      session.endSession();

      await logger.audit(
        req.user?.employee_id || 'SYSTEM',
        req.user?.employee_id?.name || 'SYSTEM',
        req.user?.role || 'unknown',
        'create', 'gps_device',
        `Device ${savedDevice.imei} created`,
        'success', req.user?.tenant_id || null, null
      );
      return res.status(201).json(savedDevice);

    } catch (err) {
      session.endSession();
      if (err.errorLabels &&
        (err.errorLabels.includes('TransientTransactionError') ||
          err.errorLabels.includes('UnknownTransactionCommitResult'))) {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
          continue;
        }
      }
      console.error('[gpsDevice] addDevice error:', err.message);
      await logger.error(
        req.user?.employee_id || 'SYSTEM',
        req.user?.employee_id?.name || 'SYSTEM',
        req.user?.role || 'unknown',
        err, 'gps_device',
        req.user?.tenant_id || null, null, 400
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
