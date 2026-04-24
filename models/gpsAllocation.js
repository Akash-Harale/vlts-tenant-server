// models/gpsAllocation.js
// Tracks GPS device allocation to a Technician or Salesperson
// Before a GPS device can be installed on a vehicle, it must be allocated to a technician.
// Status lifecycle: ALLOCATED → UNALLOCATED (when installed or returned)

const mongoose = require('mongoose');

const gpsAllocationSchema = new mongoose.Schema({
  gps_device_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GPSDevice',
    required: true
  },
  allocated_to_type: {
    type: String,
    enum: ['TECHNICIAN', 'SALESPERSON'],
    required: true
  },
  // User ID of the technician or salesperson (from the users collection)
  allocated_to_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['ALLOCATED', 'UNALLOCATED'],
    default: 'ALLOCATED'
  },
  allocated_date: {
    type: Date,
    default: Date.now
  },
  unallocated_date: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    default: null
  },
  allocated_by: {
    // Tenant user who performed the allocation (for audit trail)
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  collection: 'gps_allocations',
  timestamps: true
});

// Indexes for fast lookup
gpsAllocationSchema.index({ gps_device_id: 1, status: 1 });
gpsAllocationSchema.index({ allocated_to_user_id: 1, status: 1 });
gpsAllocationSchema.index({ allocated_to_type: 1 });

module.exports = mongoose.model('GpsAllocation', gpsAllocationSchema);
