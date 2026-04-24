// models/vehicleDeviceMap.js
// Maps GPS devices to vehicles — enforces one active mapping per vehicle and per device

const mongoose = require('mongoose');

const vehicleDeviceMapSchema = new mongoose.Schema({
  vehicle_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  gps_device_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GPSDevice',
    required: true
  },
  technician_id: {
    type: String,
    ref: 'Technician',
    required: false,
    default: null
  },
  installation_date: { type: Date, default: Date.now },
  installation_notes: { type: String },
  unmapped_on: { type: Date },
  status: { type: String, enum: ['MAPPED', 'UNMAPPED'], default: 'MAPPED' }
});

vehicleDeviceMapSchema.index({ vehicle_id: 1, status: 1 });
vehicleDeviceMapSchema.index({ gps_device_id: 1, status: 1 });

// Prevent duplicate active mappings: one vehicle ↔ one device at a time
// NOTE: Mongoose 9 async hooks do NOT receive a `next` param — use throw/return
vehicleDeviceMapSchema.pre('save', async function () {
  if (this.status !== 'MAPPED') return;

  // Check: vehicle already has an active mapping (exclude self)
  const vehicleConflict = await mongoose.model('VehicleDeviceMap').findOne({
    vehicle_id: this.vehicle_id,
    status: 'MAPPED',
    _id: { $ne: this._id }
  });
  if (vehicleConflict) {
    throw new Error(`Vehicle ${this.vehicle_id} already has an active GPS device mapped`);
  }

  // Check: device already mapped to another vehicle (exclude self)
  const deviceConflict = await mongoose.model('VehicleDeviceMap').findOne({
    gps_device_id: this.gps_device_id,
    status: 'MAPPED',
    _id: { $ne: this._id }
  });
  if (deviceConflict) {
    throw new Error(`GPS Device ${this.gps_device_id} is already mapped to another vehicle`);
  }
});

module.exports = mongoose.model('VehicleDeviceMap', vehicleDeviceMapSchema);
