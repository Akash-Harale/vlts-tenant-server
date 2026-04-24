// config/db.js
// MongoDB connection with retry logic

const mongoose = require('mongoose');

let retryCount = 0;
const maxRetries = 5;
const baseDelay = 2000;
const pingInterval = 600000; // 10 minutes

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[DB] MongoDB connected successfully');
    monitorHealth();
  } catch (err) {
    retryCount++;
    console.error(`[DB] MongoDB connection failed [Attempt ${retryCount}]:`, err.message);

    if (retryCount <= maxRetries) {
      const delay = baseDelay * Math.pow(2, retryCount);
      console.log(`[DB] Retrying in ${delay / 1000}s...`);
      setTimeout(connectDB, delay);
    } else {
      console.error('[DB] Max retries reached. Exiting...');
      process.exit(1);
    }
  }
};

function monitorHealth() {
  setInterval(async () => {
    try {
      await mongoose.connection.db.admin().ping();
      console.log(`[${new Date().toISOString()}] MongoDB ping OK`);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] MongoDB ping failed:`, err.message);
    }
  }, pingInterval);
}

module.exports = connectDB;
