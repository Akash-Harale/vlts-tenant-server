// models/vehicle.js
const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
  client_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  make: { type: String },
  model: { type: String },
  availability_place: { type: String },
  registration_number: { type: String, required: true, unique: true },
  manufacturing_year: { type: Number },
  chassis_number: { type: String, required: true, unique: true },
  engine_number: { type: String, required: true, unique: true },
  date_of_subscription: { type: Date, required: true },
  regn_valid_upto: { type: Date, required: true },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Vehicle', vehicleSchema);
