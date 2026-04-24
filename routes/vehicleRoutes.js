// routes/vehicleRoutes.js
// Vehicle CRUD routes — vehicles are always registered against a client

const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const authMiddleware = require('../middleware/authMiddleware');

// POST   /api/vehicles          → Register a new vehicle (against a client)
router.post('/vehicles', authMiddleware(['create_vehicle']), vehicleController.registerVehicle);

// GET    /api/vehicles          → List all vehicles
router.get('/vehicles', authMiddleware(['read_vehicle']), vehicleController.getVehicles);

// GET    /api/vehicle?vehicle_id=<id> OR ?registration_number=<reg>
router.get('/vehicle', authMiddleware(['read_vehicle']), vehicleController.getVehicleById);

// PUT    /api/vehicles/:id      → Update vehicle
router.put('/vehicles/:id', authMiddleware(['update_vehicle']), vehicleController.updateVehicle);

// DELETE /api/vehicles/:id      → Delete vehicle
router.delete('/vehicles/:id', authMiddleware(['delete_vehicle']), vehicleController.deleteVehicle);

module.exports = router;
