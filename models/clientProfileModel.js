// models/clientProfileModel.js
// ClientProfile — a client company onboarded by a Tenant Admin
// Each client gets its own admin user (client_admin) upon creation.

const mongoose = require('mongoose');

const clientProfileSchema = new mongoose.Schema({
  tenant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  entity_name: { type: String, required: true },
  contact_name: { type: String, required: true },
  gst_number: { type: String, required: true, unique: true },
  cin_number: { type: String, required: true, unique: true },
  address1: { type: String },
  address2: { type: String },
  city: { type: String },
  district: { type: String },
  state: { type: String },
  pincode: { type: String },
  mobile_number: { type: String },
  whatsapp_number: { type: String },
  email_id: { type: String, required: true },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  auth_methods: { type: [String], default: ['local'] },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { collection: 'client_profiles' });

// Auto-update updated_at
clientProfileSchema.pre('save', async function () {
  this.updated_at = new Date();
});

module.exports = mongoose.model('ClientProfile', clientProfileSchema);
