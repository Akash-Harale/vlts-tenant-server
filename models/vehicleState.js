// models/vehicleState.js
const mongoose = require('mongoose');

const vehicleStateSchema = new mongoose.Schema({
  vehicle_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  prev_place_of_availability: { type: String, default: null },
  prev_available_date: { type: Date, default: null },
  place_of_availability: { type: String, required: true },
  next_available_date: { type: Date, default: Date.now },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
});

vehicleStateSchema.index({ vehicle_id: 1 }, { unique: true });

module.exports = mongoose.model('VehicleState', vehicleStateSchema);
