// models/gpsDevice.js
// GPS device model with self-healing validation hook
const mongoose = require('mongoose');

const gpsDeviceSchema = new mongoose.Schema({
  imei: { type: String, required: true, unique: true },
  serial_number: { type: String, required: true, unique: true },
  manufacturer: { type: String },
  model: { type: String },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'FAULTY'], default: 'ACTIVE' },
  installed_on: { type: Date },
  created_at: { type: Date, default: Date.now },
  failed_attempts: { type: Number, default: 0 }
});

// Indexes handled automatically via unique:true on imei and serial_number

// Only ACTIVE devices can be mapped
gpsDeviceSchema.methods.canBeMapped = function () {
  if (this.status !== 'ACTIVE') {
    console.error(`[VALIDATION] Device ${this._id} is ${this.status} — cannot be mapped`);
    return false;
  }
  return true;
};

// Auto-mark as FAULTY after 3 failed mapping attempts
gpsDeviceSchema.pre('save', async function () {
  if (this.failed_attempts >= 3 && this.status === 'ACTIVE') {
    console.warn(`[AUTO-UPDATE] Device ${this._id} exceeded failed attempts. Marking FAULTY.`);
    this.status = 'FAULTY';
  }
});

module.exports = mongoose.model('GPSDevice', gpsDeviceSchema);
