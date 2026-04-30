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
// GET /api/vehicle  → List ALL vehicles for this tenant
// ─────────────────────────────────────────────
exports.getVehicles = async (req, res) => {
  try {
    // Vehicles are linked to clients; clients are linked to tenants.
    // The simplest correct join: fetch all vehicles then populate state.
    // NOTE: VehicleState has no client_id/tenant_id — those live on Vehicle.
    const vehicles = await Vehicle.find().lean();

    // Bulk-fetch all states and index them by vehicle_id string
    const vehicleIds = vehicles.map(v => v._id);
    const states = await VehicleState.find({ vehicle_id: { $in: vehicleIds } }).lean();
    const stateMap = Object.fromEntries(states.map(s => [s.vehicle_id.toString(), s]));

    const result = vehicles.map(v => {
      const vs = stateMap[v._id.toString()] || {};
      return {
        vehicleId: v._id,
        client_id: v.client_id,
        registration_number: v.registration_number,
        make: v.make,
        model: v.model,
        manufacturing_year: v.manufacturing_year,
        chassis_number: v.chassis_number,
        engine_number: v.engine_number,
        date_of_subscription: v.date_of_subscription,
        regn_valid_upto: v.regn_valid_upto,
        place_of_availability: vs.place_of_availability || null,
        next_available_date: vs.next_available_date || null,
        status: vs.status || null,
      };
    });

    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      'read', 'vehicle',
      `Fetched ${result.length} vehicles (all clients)`,
      'success', req.user?.tenant_id || null, null
    );

    return res.json(result);
  } catch (err) {
    console.error('[vehicle] getVehicles error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/vehicle/client/:client_id
//   List all vehicles for a specific client.
//   Tenant-scoped: ensures the client belongs to req.user.tenant_id.
// ─────────────────────────────────────────────

// what is the complete api url for this 
exports.getVehiclesByClient = async (req, res) => {
  const { client_id } = req.params;
  const tenant_id = req.user?.tenant_id;

  if (!client_id) {
    return res.status(400).json({ error: 'client_id param is required' });
  }

  try {
    // Security: verify the client belongs to this tenant before returning data
    const ClientProfile = require('../models/clientProfileModel'); // collection: client_profiles
    const client = await ClientProfile.findOne({ _id: client_id, tenant_id }).lean();
    if (!client) {
      return res.status(404).json({ error: 'Client not found for this tenant' });
    }

    // Fetch all vehicles registered under this client
    const vehicles = await Vehicle.find({ client_id }).lean();

    if (vehicles.length === 0) {
      return res.json([]);
    }

    // Enrich with vehicle state
    const vehicleIds = vehicles.map(v => v._id);
    const states = await VehicleState.find({ vehicle_id: { $in: vehicleIds } }).lean();
    const stateMap = Object.fromEntries(states.map(s => [s.vehicle_id.toString(), s]));

    const result = vehicles.map(v => {
      const vs = stateMap[v._id.toString()] || {};
      return {
        vehicleId: v._id,
        client_id: v.client_id,
        registration_number: v.registration_number,
        make: v.make,
        model: v.model,
        manufacturing_year: v.manufacturing_year,
        chassis_number: v.chassis_number,
        engine_number: v.engine_number,
        date_of_subscription: v.date_of_subscription,
        regn_valid_upto: v.regn_valid_upto,
        place_of_availability: vs.place_of_availability || null,
        next_available_date: vs.next_available_date || null,
        status: vs.status || null,
      };
    });

    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      req.user?.employee_id?.name || 'SYSTEM',
      req.user?.role || 'unknown',
      'read', 'vehicle',
      `Fetched ${result.length} vehicles for client ${client_id}`,
      'success', tenant_id || null, null
    );

    return res.json(result);
  } catch (err) {
    console.error('[vehicle] getVehiclesByClient error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/vehicle/:id  → Single vehicle by its MongoDB _id
// ─────────────────────────────────────────────
exports.getVehicleById = async (req, res) => {
  try {
    const { id } = req.params;  // vehicle MongoDB _id from the URL path

    if (!id) {
      return res.status(400).json({ error: 'vehicle id is required in the URL path' });
    }

    const vehicle = await Vehicle.findById(id).lean();
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const vehicleState = await VehicleState.findOne({ vehicle_id: vehicle._id }).lean();

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
      place_of_availability: vehicleState?.place_of_availability || null,
      next_available_date: vehicleState?.next_available_date || null,
      status: vehicleState?.status || null,
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
