// Data export (Addendum-2 D5): the signed-in user can download ALL of their
// own DermaScan data as one JSON file — account info, family profiles,
// analysis metadata, body-map spots and consult bookings.
// Only the requester's own records are included; password hashes never leave.
const express = require('express');
const auth = require('../middleware/auth');
const User = require('../models/User');
const Profile = require('../models/Profile');
const BodySpot = require('../models/BodySpot');
const Booking = require('../models/Booking');
const AnalysisHistory = require('../models/AnalysisHistory');

const router = express.Router();

// GET /api/export/me  (auth required) -> JSON file download
router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({ error: 'NotFound', message: 'User not found.' });
    }

    const [profiles, analyses, spots, bookings] = await Promise.all([
      Profile.find({ user: req.user.id }).lean(),
      AnalysisHistory.find({ user: req.user.id }).sort({ createdAt: 1 }).lean(),
      BodySpot.find({ user: req.user.id }).lean(),
      Booking.find({ user: req.user.id }).populate('doctor', 'name specialty').lean(),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      note: 'Complete export of your DermaScan data (educational demo — not a medical record).',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
      profiles,
      analyses,
      spots,
      bookings,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dermascan-my-data-${new Date().toISOString().slice(0, 10)}.json"`
    );
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
