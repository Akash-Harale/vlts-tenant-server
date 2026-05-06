// models/gpsDevice.js
// Mongoose schema for GPS devices with self-healing validation
/*
GPSDevice model with a self‑healing validation hook. 
This hook will automatically mark a device as FAULTY if repeated mapping attempts fail 
(for example, due to tamper detection, health issues, or validation errors). 
This way, operators don’t have to manually update the device status every time.
*/
const mongoose = require('mongoose');

const gpsDeviceSchema = new mongoose.Schema({
  imei: { type: String, required: true, unique: true },
  device_id: { type: String, required: true, unique: true },
  icc_id: { type: String, required: true, unique: true },
  make: { type: String },
  model: { type: String },
  firmware_version: { type: String },
  protocol: { type: String },
  sim_provider1: { type: String },
  sim_provider2: { type: String },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'FAULTY'], default: 'ACTIVE' },
  device_type: { type: String, enum: ['GPS', 'MOBILE'], default: 'GPS' },
  created_at: { type: Date, default: Date.now },
});

// Indexes for faster queries
gpsDeviceSchema.index({ imei: 1 });

// Validation method: only ACTIVE devices can be mapped
gpsDeviceSchema.methods.canBeMapped = function () {
  if (this.status !== 'ACTIVE') {
    console.error(` [VALIDATION ERROR] Device ${this._id} is ${this.status} and cannot be mapped`);
    return false;
  }
  return true;
};

// Middleware: if failed attempts exceed threshold, mark device as FAULTY
gpsDeviceSchema.pre('save', function () {
  if (this.failed_attempts >= 3 && this.status === 'ACTIVE') {
    console.warn(` [AUTO-UPDATE] Device ${this._id} exceeded failed attempts. Marking as FAULTY.`);
    this.status = 'FAULTY';
  }
});

module.exports = mongoose.model('GPSDevice', gpsDeviceSchema);
