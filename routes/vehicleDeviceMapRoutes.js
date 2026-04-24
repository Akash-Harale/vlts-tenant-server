// routes/vehicleDeviceMapRoutes.js
// GPS-Vehicle Mapping routes: Allocate, Read, Update, Deallocate

const express = require('express');
const router = express.Router();
const vehicleDeviceMapController = require('../controllers/vehicleDeviceMapController');
const authMiddleware = require('../middleware/authMiddleware');

// POST   /api/assignments/gps-vehicle
// → Allocate (map) a GPS device to a vehicle
router.post('/', authMiddleware(['map_device_to_vehicle']), vehicleDeviceMapController.mapDevice);

// GET    /api/assignments/gps-vehicle
// → List all active GPS-Vehicle mappings
router.get('/', authMiddleware(['read_mapped_device_to_vehicle']), vehicleDeviceMapController.getAllGPSAssignedVehicle);

// GET    /api/assignments/gps-vehicle/:id
// → Get mapping by vehicle_id or gps_device_id
router.get('/:id', authMiddleware(['read_mapped_device_to_vehicle']), vehicleDeviceMapController.getMappedDevice);

// PUT    /api/assignments/gps-vehicle/:deviceId
// → Update/replace GPS device for a vehicle (unmaps old, creates new)
router.put('/:deviceId', authMiddleware(['update_mapped_device_to_vehicle']), vehicleDeviceMapController.updateMapping);

// DELETE /api/assignments/gps-vehicle/:deviceId
// → Deallocate (unmap) GPS device from its vehicle
router.delete('/:deviceId', authMiddleware(['delete_mapped_device_to_vehicle']), vehicleDeviceMapController.removeMapping);

module.exports = router;
