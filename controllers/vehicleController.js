// controllers/vehicleController.js
// Vehicle CRUD — Register, List, Get, Update, Delete

const mongoose = require('mongoose');
const Vehicle = require('../models/vehicle');
const VehicleState = require('../models/vehicleState');
const logger = require('../utils/logger');

const MAX_RETRIES = parseInt(process.env.TRANSACTION_MAX_RETRIES || '3', 10);
const BASE_DELAY_MS = parseInt(process.env.TRANSACTION_BACKOFF_MS || '100', 10);

function isValidDate(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

// ─────────────────────────────────────────────
// POST /api/vehicles → Register a new vehicle (against a client)
// ─────────────────────────────────────────────
exports.registerVehicle = async (req, res) => {
  const {
    client_id, make, model, registration_number, manufacturing_year,
    chassis_number, engine_number, date_of_subscription, regn_valid_upto,
    status, availability_place, next_available_date
  } = req.body;

  console.log('[vehicle] registerVehicle:', req.body);

  if (!client_id) return res.status(400).json({ error: 'client_id is required' });
  if (!chassis_number) return res.status(400).json({ error: 'chassis_number is required' });
  if (!engine_number) return res.status(400).json({ error: 'engine_number is required' });
  if (!date_of_subscription) return res.status(400).json({ error: 'date_of_subscription is required' });
  if (!regn_valid_upto) return res.status(400).json({ error: 'regn_valid_upto is required' });
  if (!next_available_date) return res.status(400).json({ error: 'next_available_date is required' });
  if (!availability_place) return res.status(400).json({ error: 'availability_place is required' });
  if (!status) return res.status(400).json({ error: 'status is required' });

  if (!isValidDate(date_of_subscription))
    return res.status(400).json({ error: 'date_of_subscription must be a valid ISO date' });
  if (!isValidDate(regn_valid_upto))
    return res.status(400).json({ error: 'regn_valid_upto must be a valid ISO date' });
  if (!isValidDate(next_available_date))
    return res.status(400).json({ error: 'next_available_date must be a valid ISO date' });

  const inputDate = new Date(next_available_date);
  if (inputDate <= new Date())
    return res.status(400).json({ error: 'next_available_date must be in the future' });

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();
    try {
      attempt++;
      const result = await session.withTransaction(async () => {
        const vehicle = new Vehicle({
          client_id, make, model, registration_number, manufacturing_year,
          chassis_number, engine_number,
          date_of_subscription: new Date(date_of_subscription),
          regn_valid_upto: new Date(regn_valid_upto)
        });
        await vehicle.save({ session });

        const vehicleState = new VehicleState({
          vehicle_id: vehicle._id,
          place_of_availability: availability_place,
          next_available_date: inputDate,
          status: status.toUpperCase()
        });
        await vehicleState.save({ session });

        return { vehicle, vehicleState };
      });

      session.endSession();

      await logger.audit(
        req.user?.employee_id || 'SYSTEM',
        req.user?.employee_id?.name || 'SYSTEM',
        req.user?.role || 'unknown',
        'create', 'vehicle',
        `Vehicle ${registration_number} registered`,
        'success', req.user?.tenant_id || null, null
      );

      return res.status(201).json({
        success: true,
        message: 'Vehicle created successfully',
        vehicle: result.vehicle,
        availability_place,
        next_available_date,
        status
      });

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

      console.error('[vehicle] registerVehicle error:', err.message);
      await logger.error(
        req.user?.employee_id || 'SYSTEM',
        req.user?.employee_id?.name || 'SYSTEM',
        req.user?.role || 'unknown',
        err, 'vehicle',
        req.user?.tenant_id || null, null, 500
      );
      return res.status(500).json({ error: err.message });
    }
  }
};

// ─────────────────────────────────────────────
// GET /api/vehicles → List all vehicles with state
// ─────────────────────────────────────────────
exports.getVehicles = async (req, res) => {
  try {
    const states = await VehicleState.find().populate('vehicle_id');
    const result = states.map(vs => ({
      vehicleId: vs?.vehicle_id?._id,
      client_id: vs?.vehicle_id?.client_id,
      registration_number: vs?.vehicle_id?.registration_number,
      make: vs?.vehicle_id?.make,
      model: vs?.vehicle_id?.model,
      manufacturing_year: vs?.vehicle_id?.manufacturing_year,
      chassis_number: vs?.vehicle_id?.chassis_number,
      engine_number: vs?.vehicle_id?.engine_number,
      date_of_subscription: vs?.vehicle_id?.date_of_subscription,
      regn_valid_upto: vs?.vehicle_id?.regn_valid_upto,
      place_of_availability: vs?.place_of_availability,
      next_available_date: vs?.next_available_date,
      status: vs?.status
    }));

    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      'read', 'vehicle',
      `Fetched ${result.length} vehicles`,
      'success', req.user?.tenant_id || null, null
    );

    return res.json(result);
  } catch (err) {
    console.error('[vehicle] getVehicles error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/vehicle?vehicle_id=<id> OR ?registration_number=<reg>
// ─────────────────────────────────────────────
exports.getVehicleById = async (req, res) => {
  try {
    const { vehicle_id, registration_number } = req.query;

    let vehicle;
    if (vehicle_id) {
      vehicle = await Vehicle.findById(vehicle_id);
    } else if (registration_number) {
      vehicle = await Vehicle.findOne({ registration_number });
    } else {
      return res.status(400).json({ error: 'Provide either vehicle_id or registration_number' });
    }

    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const vehicleState = await VehicleState.findOne({ vehicle_id: vehicle._id });

    return res.json({
      vehicleId: vehicle._id,
      client_id: vehicle.client_id,
      registration_number: vehicle.registration_number,
      make: vehicle.make,
      model: vehicle.model,
      manufacturing_year: vehicle.manufacturing_year,
      chassis_number: vehicle.chassis_number,
      engine_number: vehicle.engine_number,
      date_of_subscription: vehicle.date_of_subscription,
      regn_valid_upto: vehicle.regn_valid_upto,
      place_of_availability: vehicleState?.place_of_availability,
      next_available_date: vehicleState?.next_available_date || null,
      status: vehicleState?.status
    });
  } catch (err) {
    console.error('[vehicle] getVehicleById error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// PUT /api/vehicles/:id → Update vehicle
// ─────────────────────────────────────────────
exports.updateVehicle = async (req, res) => {
  const { id } = req.params;
  const { status, availability_place, next_available_date, date_of_subscription, regn_valid_upto, ...updateData } = req.body;

  if (date_of_subscription) {
    if (!isValidDate(date_of_subscription))
      return res.status(400).json({ error: 'date_of_subscription must be a valid ISO date' });
    updateData.date_of_subscription = new Date(date_of_subscription);
  }
  if (regn_valid_upto) {
    if (!isValidDate(regn_valid_upto))
      return res.status(400).json({ error: 'regn_valid_upto must be a valid ISO date' });
    updateData.regn_valid_upto = new Date(regn_valid_upto);
  }

  let inputDate;
  if (next_available_date) {
    if (!isValidDate(next_available_date))
      return res.status(400).json({ error: 'next_available_date must be a valid ISO date' });
    inputDate = new Date(next_available_date);
    if (inputDate <= new Date())
      return res.status(400).json({ error: 'next_available_date must be in the future' });
  }

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();
    try {
      attempt++;
      const result = await session.withTransaction(async () => {
        const updatedVehicle = await Vehicle.findByIdAndUpdate(
          id, { $set: updateData },
          { new: true, runValidators: true, omitUndefined: true, session }
        );
        if (!updatedVehicle) { const e = new Error('Vehicle not found'); e.statusCode = 404; throw e; }

        let updatedState = null;
        if (next_available_date) {
          updatedState = await VehicleState.findOneAndUpdate(
            { vehicle_id: id },
            { status: status?.toUpperCase(), place_of_availability: availability_place, next_available_date: inputDate },
            { new: true, session }
          );
          if (!updatedState) { const e = new Error('Vehicle state not found'); e.statusCode = 404; throw e; }
        }
        return { updatedVehicle, updatedState };
      });

      session.endSession();
      await logger.audit(
        req.user?.employee_id || 'SYSTEM',
        req.user?.employee_id?.name || 'SYSTEM',
        req.user?.role || 'unknown',
        'update', 'vehicle', 'Vehicle updated', 'success', req.user?.tenant_id || null, null
      );
      return res.json({ success: true, message: 'Vehicle updated successfully' });

    } catch (err) {
      session.endSession();
      if (err.statusCode === 404) return res.status(404).json({ success: false, message: err.message });
      if (err.errorLabels &&
        (err.errorLabels.includes('TransientTransactionError') || err.errorLabels.includes('UnknownTransactionCommitResult'))) {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
          continue;
        }
      }
      console.error('[vehicle] updateVehicle error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
};

// ─────────────────────────────────────────────
// DELETE /api/vehicles/:id → Delete vehicle + state
// ─────────────────────────────────────────────
exports.deleteVehicle = async (req, res) => {
  const { id } = req.params;
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    const session = await mongoose.startSession();
    try {
      attempt++;
      const result = await session.withTransaction(async () => {
        const vehicle = await Vehicle.findById(id).session(session);
        if (!vehicle) { const e = new Error('Vehicle not found'); e.statusCode = 404; throw e; }

        const vehicleState = await VehicleState.findOne({ vehicle_id: id }).session(session);
        if (!vehicleState) { const e = new Error('Vehicle state not found'); e.statusCode = 404; throw e; }

        if (vehicleState.next_available_date >= new Date()) {
          const e = new Error(`Vehicle is on trip, next available: ${vehicleState.next_available_date}`);
          e.statusCode = 400; throw e;
        }

        await Vehicle.findByIdAndDelete(id, { session });
        await VehicleState.deleteOne({ vehicle_id: id }, { session });
        return { vehicle, vehicleState };
      });

      session.endSession();
      await logger.audit(
        req.user?.employee_id || 'SYSTEM',
        req.user?.employee_id?.name || 'SYSTEM',
        req.user?.role || 'unknown',
        'delete', 'vehicle',
        `Vehicle ${result.vehicle.registration_number} deleted`,
        'success', req.user?.tenant_id || null, null
      );
      return res.json({ success: true, message: 'Vehicle deleted successfully' });

    } catch (err) {
      session.endSession();
      if (err.statusCode === 404) return res.status(404).json({ success: false, message: err.message });
      if (err.statusCode === 400) return res.status(400).json({ success: false, message: err.message });
      if (err.errorLabels &&
        (err.errorLabels.includes('TransientTransactionError') || err.errorLabels.includes('UnknownTransactionCommitResult'))) {
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
          continue;
        }
      }
      console.error('[vehicle] deleteVehicle error:', err.message);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
};
