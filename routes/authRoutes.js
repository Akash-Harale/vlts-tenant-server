// routes/authRoutes.js
// Tenant authentication routes: login, logout, refresh

const express = require('express');
const router = express.Router();
const { tenantLogin, tenantLogout, tenantRefresh } = require('../controllers/tenantAuthController');
const authMiddleware = require('../middleware/authMiddleware');

// POST /api/auth/tenant/login  — no token required
router.post('/login', tenantLogin);

// POST /api/auth/tenant/logout — valid token required (to blacklist refresh token)
router.post('/logout', authMiddleware(), tenantLogout);

// POST /api/auth/tenant/refresh — issues new token pair using refresh token
router.post('/refresh', tenantRefresh);

module.exports = router;
