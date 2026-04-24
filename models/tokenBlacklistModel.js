// models/tokenBlacklistModel.js
// Stores blacklisted JWT refresh tokens. TTL index auto-expires entries.
const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, default: 'logout' },
  timestamp: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
}, { collection: 'token_blacklist' });

// TTL index: documents auto-expire at expiresAt timestamp
tokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);
