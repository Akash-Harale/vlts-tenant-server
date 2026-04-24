// middleware/authMiddleware.js
// Purpose: Validate JWT and enforce role-based privileges
/*
Gatekeeper for all tenant APIs.
Privilege examples:
  create_gps, read_gps, update_gps, delete_gps
  create_vehicle, read_vehicle, update_vehicle, delete_vehicle
  map_device_to_vehicle, read_mapped_device_to_vehicle,
  update_mapped_device_to_vehicle, delete_mapped_device_to_vehicle
*/

const jwt = require('jsonwebtoken');
const Role = require('../models/roleModel');

/**
 * Middleware to validate JWT and check privileges
 * @param {Array<string>} requiredPrivileges - Privileges required to access the route
 */
function authMiddleware(requiredPrivileges = []) {
  return async (req, res, next) => {
    try {
      // Step 1: Validate Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization token missing' });
      }

      // Step 2: Verify JWT
      const token = authHeader.split(' ')[1];
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      // Attach decoded payload to request
      // Payload: { id, role, employee_id, tenant_id, privileges }
      req.user = decoded;

      // Step 3: Resolve privileges (from JWT or DB fallback)
      let userPrivileges = decoded.privileges;

      if (!userPrivileges || userPrivileges.length === 0) {
        // Fallback: fetch role from DB if privileges not embedded in token
        const roleDoc = await Role.findOne({ name: decoded.role });
        if (!roleDoc) {
          return res.status(403).json({ error: 'Role not recognized' });
        }
        userPrivileges = roleDoc.privileges;
        req.user.privileges = userPrivileges;
      }

      // Step 4: Enforce required privileges
      if (requiredPrivileges.length > 0) {
        const hasPrivilege = requiredPrivileges.every(p =>
          userPrivileges.includes(p)
        );

        if (!hasPrivilege) {
          return res.status(403).json({ error: 'Insufficient privileges' });
        }
      }

      // Step 5: Proceed
      next();
    } catch (err) {
      console.error('[authMiddleware] Error:', err);
      return res.status(500).json({ error: 'Authentication middleware error' });
    }
  };
}

module.exports = authMiddleware;
