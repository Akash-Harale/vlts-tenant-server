// models/userModel.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role' },
  scope: { type: String, enum: ['system', 'tenant', 'client'], required: true },
  tenant_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
  client_profile_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientProfile' }
}, { collection: 'users' });

userSchema.pre('save', async function () {
  if (this.password && this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
});

userSchema.index({ role: 1, scope: 1 });

module.exports = mongoose.model('User', userSchema);
