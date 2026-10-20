// Seed script: create/update the admin (and, for seed:accounts, demo doctor) account.
// Usage: node seed-admin.js   (also used by `npm run seed:accounts` with SEED_ACCOUNTS=1)
// Demo credentials only — change via ADMIN_EMAIL / ADMIN_PASSWORD / DOCTOR_* env.
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Doctor = require('./models/Doctor');
const connectDB = require('./config/db');

async function ensureUser({ email, password, name, role }) {
  const normalized = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);
  let user = await User.findOne({ email: normalized }).select('+passwordHash');
  if (user) {
    user.role = role;
    user.passwordHash = passwordHash;
    if (name) user.name = name;
    await user.save();
    console.log(`Updated ${role} user: ${normalized} (id ${user._id})`);
  } else {
    user = await User.create({ name: name || role, email: normalized, passwordHash, role });
    console.log(`Created ${role} user: ${normalized} (id ${user._id})`);
  }
  return user;
}

async function main() {
  await connectDB();
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@dermascan.demo';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  await ensureUser({ email: adminEmail, password: adminPassword, name: 'DermaScan Admin', role: 'admin' });

  if (process.env.SEED_ACCOUNTS === '1') {
    const doctorEmail = process.env.DOCTOR_EMAIL || 'doctor@dermascan.demo';
    const doctorPassword = process.env.DOCTOR_PASSWORD || 'Doctor@123';
    await ensureUser({ email: doctorEmail, password: doctorPassword, name: 'Dr. Demo Reviewer (demo)', role: 'doctor' });
    const existing = await Doctor.findOne({ name: 'Dr. Demo Reviewer (demo)' });
    if (!existing) {
      await Doctor.create({
        name: 'Dr. Demo Reviewer (demo)',
        specialty: 'Dermatology',
        experienceYears: 10,
        fee: 0,
        rating: 5.0,
        about: 'Demo reviewer account for the DermaScan review queue (fictional, demo only).',
        demo: true,
      });
      console.log('Created demo Doctor doc: Dr. Demo Reviewer (demo)');
    } else {
      console.log('Demo Doctor doc already exists: Dr. Demo Reviewer (demo)');
    }
  }
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Seed failed:', err.message);
  try { await mongoose.disconnect(); } catch (e) { /* ignore */ }
  process.exit(1);
});
