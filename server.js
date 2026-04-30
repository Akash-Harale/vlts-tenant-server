// server.js
// VLTS-Tenant API Server

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

// ─── Route imports ───────────────────────────
const authRoutes = require('./routes/authRoutes');
const gpsDeviceRoutes = require('./routes/gpsDeviceRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const vehicleDeviceMapRoutes = require('./routes/vehicleDeviceMapRoutes');
const gpsAllocationRoutes = require('./routes/gpsAllocationRoutes');
const tenantUserRoutes = require('./routes/tenantUserRoutes');
const tenantClientRoutes = require('./routes/tenantClientRoutes');

const app = express();

// ─── CORS ────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow Postman / curl (no origin header)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.error('[CORS] Blocked origin:', origin);
    return callback(null, false); // ← return false, NOT an Error — avoids 500
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// ─── Body parser ─────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ─── Request logger (dev only) ───────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Database ────────────────────────────────
connectDB();

// ─── Routes ──────────────────────────────────

// Auth: Login, Logout, Refresh
app.use('/api/auth/tenant', authRoutes);

// GPS Device CRUD
app.use('/api/gps', gpsDeviceRoutes);

// GPS Allocation — assign GPS devices to Technician or Salesperson
app.use('/api/gps-allocations',  gpsAllocationRoutes);

// GPS-Vehicle Mapping: Allocate, Read, Update, Deallocate
app.use('/api/assignments/gps-vehicle', vehicleDeviceMapRoutes);

// Tenant User Management (manager, helpdesk, executive, etc.)
app.use('/api/user', tenantUserRoutes);

// Tenant Client Management (client companies onboarded by tenant)
app.use('/api/clients', tenantClientRoutes);

// Vehicle CRUD — mounted LAST at /api to avoid swallowing other /api/* routes
app.use('/api/vehicle', vehicleRoutes);

// ─── Health check ────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'vlts-tenant',
    timestamp: new Date().toISOString()
  });
});

// ─── Root ────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'VLTS Tenant API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth/tenant/login | /logout | /refresh',
      gps_devices: '/api/gps  (CRUD)',
      gps_allocations: '/api/gps-allocations  (allocate to technician/salesperson)',
      vehicles: '/api/vehicles | /api/vehicle  (CRUD)',
      gps_vehicle_mapping: '/api/assignments/gps-vehicle  (map GPS to vehicle)',
      users: '/api/users  (tenant user CRUD — manager, helpdesk, etc.)',
      clients: '/api/clients  (client company CRUD)'
    }
  });
});

// ─── 404 handler ─────────────────────────────
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.path} not found`);
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ─── Global error handler ────────────────────
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ─── Start server ────────────────────────────
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => {
  console.log(`[server] VLTS-Tenant API running on port ${PORT}`);
});
