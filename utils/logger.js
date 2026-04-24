// utils/logger.js
// Centralized audit + error logging

const { v4: uuidv4 } = require('uuid');
const AuditLog = require('../models/auditLogModel');
const ErrorLog = require('../models/errorLogModel');

module.exports = {
  /**
   * Write an audit log entry
   * @param {String} empId
   * @param {String} empName
   * @param {String} role
   * @param {String} action - create, update, delete, login, logout, etc.
   * @param {String} resource - gps_device, vehicle, vehicle_device_map, user
   * @param {String} reason - human-readable description
   * @param {String} status - success | failed
   * @param {String} tenantId
   * @param {String} requestId
   */
  audit: async (
    empId,
    empName,
    role,
    action,
    resource,
    reason,
    status = 'success',
    tenantId = null,
    requestId = null
  ) => {
    try {
      const logEntry = new AuditLog({
        trace_id: uuidv4(),
        request_id: requestId,
        emp_id: empId,
        emp_name: empName,
        role,
        tenant_id: tenantId,
        action,
        resource,
        reason,
        status,
        timestamp: new Date()
      });
      await logEntry.save();
    } catch (err) {
      console.error('[logger.audit] Failed to write audit log:', err.message);
    }
  },

  /**
   * Write an error log entry
   * @param {String} empId
   * @param {String} empName
   * @param {String} role
   * @param {Error} error
   * @param {String} resource
   * @param {String} tenantId
   * @param {String} requestId
   * @param {Number} statusCode
   */
  error: async (
    empId,
    empName,
    role,
    error,
    resource,
    tenantId = null,
    requestId = null,
    statusCode = 500
  ) => {
    try {
      const logEntry = new ErrorLog({
        trace_id: uuidv4(),
        request_id: requestId,
        emp_id: empId,
        emp_name: empName,
        role,
        tenant_id: tenantId,
        resource,
        error_message: error.message,
        stack: error.stack,
        status_code: statusCode,
        timestamp: new Date()
      });
      await logEntry.save();
      console.error('[ERROR_LOG]', JSON.stringify({ resource, error: error.message, statusCode }));
    } catch (err) {
      console.error('[logger.error] Failed to write error log:', err.message);
    }
  }
};
