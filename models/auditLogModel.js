// models/auditLogModel.js
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  trace_id: { type: String, required: true },
  request_id: { type: String },
  emp_id: { type: String, required: true },
  emp_name: { type: String },
  role: { type: String, required: true },
  tenant_id: { type: String },
  action: { type: String, required: true },
  resource: { type: String, required: true },
  reason: { type: String },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  timestamp: { type: Date, default: Date.now }
}, { collection: 'audit_logs' });

module.exports = mongoose.model('AuditLog', auditLogSchema);
