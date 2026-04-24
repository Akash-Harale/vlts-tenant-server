// models/client.model.js
const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
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
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Client || mongoose.model('Client', clientSchema);
