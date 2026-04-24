// models/roleModel.js
const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  privileges: [{ type: String }],
  scope: { type: String, enum: ['system', 'tenant'], required: true },
  remarks: String
}, { collection: 'roles' });

module.exports = mongoose.model('Role', roleSchema);
