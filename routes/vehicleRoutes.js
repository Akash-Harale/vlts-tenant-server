// routes/vehicleRoutes.js
// Vehicle CRUD routes — vehicles are always registered against a client

const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicleController');
const authMiddleware = require('../middleware/authMiddleware');

// POST   /api/vehicle/              → Register a new vehicle (against a client)
router.post('/', authMiddleware(['create_vehicle']), vehicleController.registerVehicle);

// GET    /api/vehicle/              → List ALL vehicles
router.get('/', authMiddleware(['read_vehicle']), vehicleController.getVehicles);

// GET    /api/vehicle/client/:client_id  → All vehicles for a specific client
// IMPORTANT: must be BEFORE /:id so the literal "client" segment is matched first
router.get('/client/:client_id', authMiddleware(['read_vehicle']), vehicleController.getVehiclesByClient);

// GET    /api/vehicle/:id           → Single vehicle by its MongoDB _id
router.get('/:id', authMiddleware(['read_vehicle']), vehicleController.getVehicleById);

// PUT    /api/vehicle/:id           → Update vehicle
router.put('/:id', authMiddleware(['update_vehicle']), vehicleController.updateVehicle);

// DELETE /api/vehicle/:id           → Delete vehicle
router.delete('/:id', authMiddleware(['delete_vehicle']), vehicleController.deleteVehicle);

module.exports = router;
