// Notifications REST — auth, own only.
const express = require('express');
const auth = require('../middleware/auth');
const Notification = require('../models/Notification');

const router = express.Router();
router.use(auth);

const pub = (n) => ({
  id: n._id,
  type: n.type,
  message: n.message,
  analysisId: n.analysisId || null,
  read: n.read,
  createdAt: n.createdAt,
});

// GET /api/notifications — newest first, cap 30
router.get('/', async (req, res, next) => {
  try {
    const items = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(30);
    return res.json(items.map(pub));
  } catch (err) {
    return next(err);
  }
});

// POST /api/notifications/read — mark all own notifications read
router.post('/read', async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { user: req.user.id, read: false },
      { $set: { read: true } }
    );
    return res.json({ markedRead: result.modifiedCount != null ? result.modifiedCount : 0 });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
