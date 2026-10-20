// Admin routes — auth + admin role required.
const express = require('express');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const User = require('../models/User');
const AnalysisHistory = require('../models/AnalysisHistory');

const router = express.Router();
router.use(auth, admin);

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    const counts = await AnalysisHistory.aggregate([
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    for (const c of counts) countMap[c._id.toString()] = c.count;
    return res.json(
      users.map((u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role || 'user',
        createdAt: u.createdAt,
        analysisCount: countMap[u._id.toString()] || 0,
      }))
    );
  } catch (err) {
    return next(err);
  }
});

// GET /api/admin/stats
router.get('/stats', async (req, res, next) => {
  try {
    const [totalUsers, totalAnalyses, items] = await Promise.all([
      User.countDocuments(),
      AnalysisHistory.countDocuments(),
      AnalysisHistory.find().select('topClass riskTier'),
    ]);
    const perClass = {};
    const perRisk = { low: 0, medium: 0, high: 0, unknown: 0 };
    for (const r of items) {
      perClass[r.topClass] = (perClass[r.topClass] || 0) + 1;
      if (perRisk[r.riskTier] !== undefined) perRisk[r.riskTier] += 1;
      else perRisk.unknown += 1;
    }
    return res.json({ totalUsers, totalAnalyses, perClass, perRisk });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
