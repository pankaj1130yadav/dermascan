const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    specialty: { type: String, trim: true, default: 'Dermatology' },
    experienceYears: { type: Number, default: 0 },
    fee: { type: Number, default: 0 },
    rating: { type: Number, default: 0 },
    about: { type: String, trim: true, default: '' },
    demo: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Doctor', doctorSchema);
