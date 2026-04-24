// controllers/tenantAuthController.js
// Purpose: Handles tenant user authentication (login, logout, token refresh)

const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const logger = require('../utils/logger');
const TokenBlacklist = require('../models/tokenBlacklistModel');

// These must be required so Mongoose registers the schemas
// before populate('role') and populate('employee_id') are called
require('../models/roleModel');
require('../models/employeeModel');


/**
 * Generate access + refresh tokens for a tenant user
 */
function generateTokens(user) {
  const accessToken = jwt.sign(
    {
      id: user._id,
      role: user.role.name,
      employee_id: user.employee_id,
      privileges: user.role.privileges,
      tenant_id: user.tenant_id
    },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );

  const refreshToken = jwt.sign(
    {
      id: user._id,
      role: user.role.name,
      tenant_id: user.tenant_id
    },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
}

/**
 * POST /api/auth/tenant/login
 * Authenticates a tenant user with email + password
 */
exports.tenantLogin = async (req, res, next) => {
  const { email, password } = req.body;
  console.log('[tenantAuth] Login attempt:', email);

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // +password forces inclusion even if the schema field has select:false
    const user = await User.findOne({ email })
      .select('+password')
      .populate('role')
      .populate('employee_id');

    if (!user) {
      console.log('[tenantAuth] No user found for email:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('[tenantAuth] User found:', user.email, '| has password field:', !!user.password);

    // Guard: account was provisioned without a password (SSO / script bypass)
    if (!user.password) {
      console.warn('[tenantAuth] User has no password set — was this account created via script?');
      return res.status(401).json({
        error: 'Account has no password. Contact your administrator to reset it.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log('[tenantAuth] Password match:', isMatch);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Guard: role must be populated correctly
    if (!user.role || !user.role.name) {
      console.error('[tenantAuth] User has no role assigned:', user.email);
      return res.status(403).json({
        error: 'User has no role assigned. Contact your administrator.'
      });
    }

    const { accessToken, refreshToken } = generateTokens(user);

    await logger.audit(
      user.employee_id?._id?.toString() || 'SYSTEM',
      user.employee_id?.name || 'SYSTEM',
      user.role?.name || 'unknown',
      'login', 'user',
      `${user.role?.name} ${user.employee_id?.name} login successful`,
      'success',
      user.tenant_id?.toString() || null,
      null
    );

    console.log('[tenantAuth] Login successful:', user.email, '| role:', user.role?.name);
    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        email: user.email,
        role: user.role?.name,
        name: user.employee_id?.name,
        tenant_id: user.tenant_id
      }
    });
  } catch (err) {
    console.error('[tenantAuth] Login error:', err.message, err.stack);
    await logger.error(null, null, 'unknown', err, 'user', null, null, 500);
    next(err);
  }
};

/**
 * POST /api/auth/tenant/logout
 * Blacklists the refresh token
 */
// POST /api/auth/tenant/logout
exports.tenantLogout = async (req, res) => {
  try {
    const { token } = req.body;

    if (token) {
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
      } catch (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }

      const expiresAt = decoded?.exp
        ? new Date(decoded.exp * 1000)
        : new Date();

      await TokenBlacklist.create({
        token,
        user_id: req.user?.id || decoded?.id,
        reason: 'logout',
        expiresAt
      });
    }

    await logger.audit(
      req.user?.employee_id || 'SYSTEM',
      'SYSTEM',
      req.user?.role || 'unknown',
      'logout',
      'user',
      `${req.user?.role || 'unknown'} logout successful`,
      'success',
      req.user?.tenant_id || null,
      null
    );

    return res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('[tenantAuth] Logout error:', err.message);
    return res.status(500).json({ error: 'Logout failed' });
  }
};

/**
 * POST /api/auth/tenant/refresh
 * Issues a new access + refresh token pair using a valid refresh token
 */
exports.tenantRefresh = async (req, res) => {
  const { token } = req.body;
  console.log('[tenantAuth] Token refresh request');

  if (!token) {
    return res.status(401).json({ error: 'Refresh token required' });
  }

  try {
    // Check if token is blacklisted
    const blacklisted = await TokenBlacklist.findOne({ token });
    if (blacklisted) {
      return res.status(403).json({ error: 'Refresh token is blacklisted' });
    }

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);

    const user = await User.findById(decoded.id)
      .populate('role')
      .populate('employee_id');

    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    const { accessToken, refreshToken } = generateTokens(user);

    await logger.audit(
      user.employee_id?._id?.toString() || 'SYSTEM',
      user.employee_id?.name || 'SYSTEM',
      user.role?.name || 'unknown',
      'refresh',
      'user',
      `${user.role?.name} ${user.employee_id?.name} token refreshed`,
      'success',
      user.tenant_id?.toString() || null,
      null
    );

    return res.json({ accessToken, refreshToken });
  } catch (err) {
    console.error('[tenantAuth] Refresh error:', err.message);
    return res.status(403).json({ error: 'Invalid or expired refresh token' });
  }
};
