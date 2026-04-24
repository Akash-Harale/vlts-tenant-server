// models/employeeModel.js
const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mobile_number: { type: String },
  designation: { type: String },
  scope: { type: String, enum: ['system', 'tenant', 'client'], required: true },
  tenant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
  client_profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { collection: 'employees' });

// Virtual to link back to User
employeeSchema.virtual('user', {
  ref: 'User',
  localField: '_id',
  foreignField: 'employee_id'
});

employeeSchema.index({ scope: 1, email: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
