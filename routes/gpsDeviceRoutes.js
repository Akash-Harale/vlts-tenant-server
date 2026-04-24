// routes/gpsDeviceRoutes.js
// GPS Device CRUD routes

const express = require('express');
const router = express.Router();
const gpsDeviceController = require('../controllers/gpsDeviceController');
const authMiddleware = require('../middleware/authMiddleware');

// POST   /api/gps     → Add new GPS device
router.post('/', authMiddleware(['create_gps']), gpsDeviceController.addDevice);

// GET    /api/gps     → List all GPS devices
router.get('/', authMiddleware(['read_gps']), gpsDeviceController.getDevices);

// GET    /api/gps/:id → Get single GPS device
router.get('/:id', authMiddleware(['read_gps']), gpsDeviceController.getDeviceById);

// PUT    /api/gps/:id → Update GPS device
router.put('/:id', authMiddleware(['update_gps']), gpsDeviceController.updateDevice);

// DELETE /api/gps/:id → Delete GPS device
router.delete('/:id', authMiddleware(['delete_gps']), gpsDeviceController.deleteDevice);

module.exports = router;
