// Demo doctors + bookings — auth required. Doctors are clearly fictional/demo.
const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Doctor = require('../models/Doctor');
const Booking = require('../models/Booking');

const router = express.Router();
router.use(auth);

const DEMO_DOCTORS = [
  {
    name: 'Dr. A. Sharma (demo)',
    specialty: 'Dermatology',
    experienceYears: 12,
    fee: 800,
    rating: 4.8,
    about: 'Fictional demo dermatologist for the DermaScan demo booking flow.',
    demo: true,
  },
  {
    name: 'Dr. R. Verma (demo)',
    specialty: 'Dermato-oncology',
    experienceYears: 15,
    fee: 1200,
    rating: 4.9,
    about: 'Fictional demo specialist in skin lesion screening (demo only).',
    demo: true,
  },
  {
    name: 'Dr. S. Patel (demo)',
    specialty: 'Dermatology',
    experienceYears: 8,
    fee: 600,
    rating: 4.6,
    about: 'Fictional demo dermatologist for general skin concerns (demo only).',
    demo: true,
  },
  {
    name: 'Dr. M. Khan (demo)',
    specialty: 'Pediatric Dermatology',
    experienceYears: 10,
    fee: 700,
    rating: 4.7,
    about: 'Fictional demo dermatologist for family skin care (demo only).',
    demo: true,
  },
];

const ensureDoctors = async () => {
  // Seed the fictional demo doctors unless they are already present.
  // (Other Doctor docs — e.g. the demo reviewer created by seed:accounts —
  // must not suppress this seeding.)
  const existing = await Doctor.countDocuments({
    name: { $in: DEMO_DOCTORS.map((d) => d.name) },
  });
  if (existing === 0) {
    await Doctor.insertMany(DEMO_DOCTORS);
  }
};

// GET /api/doctors
router.get('/doctors', async (req, res, next) => {
  try {
    await ensureDoctors();
    const doctors = await Doctor.find().sort({ rating: -1 });
    return res.json(
      doctors.map((d) => ({
        id: d._id,
        name: d.name,
        specialty: d.specialty,
        experienceYears: d.experienceYears,
        fee: d.fee,
        rating: d.rating,
        about: d.about,
        demo: d.demo,
      }))
    );
  } catch (err) {
    return next(err);
  }
});

// POST /api/bookings { doctorId, dateTime, reason }
router.post(
  '/bookings',
  body('doctorId').notEmpty().withMessage('doctorId is required.'),
  body('dateTime').notEmpty().withMessage('dateTime is required.'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'BadRequest', message: errors.array()[0].msg });
    }
    return next();
  },
  async (req, res, next) => {
  try {
    const { doctorId, dateTime, reason } = req.body || {};
    if (!doctorId) {
      return res.status(400).json({ error: 'BadRequest', message: 'doctorId is required.' });
    }
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ error: 'NotFound', message: 'Doctor not found.' });
    }
    const dt = new Date(dateTime);
    if (!dateTime || Number.isNaN(dt.getTime())) {
      return res.status(400).json({ error: 'BadRequest', message: 'A valid dateTime is required.' });
    }
    const booking = await Booking.create({
      user: req.user.id,
      doctor: doctor._id,
      dateTime: dt,
      reason: reason || '',
    });
    return res.status(201).json({
      id: booking._id,
      doctorId: booking.doctor,
      doctorName: doctor.name,
      dateTime: booking.dateTime,
      reason: booking.reason,
      status: booking.status,
      createdAt: booking.createdAt,
      demo: true,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/bookings — own, newest first, doctor populated
router.get('/bookings', async (req, res, next) => {
  try {
    const items = await Booking.find({ user: req.user.id })
      .populate('doctor', 'name specialty')
      .sort({ createdAt: -1 });
    return res.json(
      items.map((b) => ({
        id: b._id,
        doctorId: b.doctor ? b.doctor._id : null,
        doctorName: b.doctor ? b.doctor.name : null,
        doctorSpecialty: b.doctor ? b.doctor.specialty : null,
        dateTime: b.dateTime,
        reason: b.reason,
        status: b.status,
        createdAt: b.createdAt,
      }))
    );
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/bookings/:id — own → status 'cancelled'
router.delete('/bookings/:id', async (req, res, next) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, user: req.user.id });
    if (!booking) {
      return res.status(404).json({ error: 'NotFound', message: 'Booking not found.' });
    }
    booking.status = 'cancelled';
    await booking.save();
    return res.json({ message: 'Booking cancelled.', id: booking._id, status: booking.status });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
