// models/errorLogModel.js
const mongoose = require('mongoose');

const errorLogSchema = new mongoose.Schema({
  trace_id: { type: String, required: true },
  request_id: String,
  emp_id: String,
  emp_name: { type: String },
  role: String,
  tenant_id: String,
  resource: { type: String, required: true },
  error_message: { type: String, required: true },
  stack: String,
  status_code: { type: Number, default: 500 },
  timestamp: { type: Date, default: Date.now },
  log_date: { type: String, index: true }
}, { collection: 'error_logs' });

errorLogSchema.index({ tenant_id: 1, log_date: 1 });

module.exports = mongoose.model('ErrorLog', errorLogSchema);
