// models/tenantModel.js
const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
  tenant_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  domain: { type: String },
  auth_methods: { type: [String], default: ['local'] },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  created_at: { type: Date, default: Date.now }
}, { collection: 'tenants' });

module.exports = mongoose.model('Tenant', tenantSchema);
