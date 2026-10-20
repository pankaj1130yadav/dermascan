// Demo doctor review queue — role 'doctor' or 'admin' only. All demo-labeled.
const express = require('express');
const auth = require('../middleware/auth');
const AnalysisHistory = require('../models/AnalysisHistory');
const User = require('../models/User');
const { createNotification } = require('../lib/notify');

const router = express.Router();

const requireReviewer = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user || !['doctor', 'admin'].includes(user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only demo doctors or admins can access the review queue.',
      });
    }
    req.reviewer = user;
    return next();
  } catch (err) {
    return next(err);
  }
};

// GET /api/reviews/queue
router.get('/queue', auth, requireReviewer, async (req, res, next) => {
  try {
    const items = await AnalysisHistory.find({ reviewStatus: 'requested' })
      .populate('user', 'name')
      .sort({ createdAt: 1 });
    return res.json(
      items.map((r) => ({
        id: r._id,
        userName: r.user ? r.user.name : null,
        topClass: r.topClass,
        riskTier: r.riskTier,
        createdAt: r.createdAt,
        imageUrl: r.imageUrl || null,
        gradcamUrl: r.gradcamUrl || null,
        intake: r.intake || null,
        demo: true,
      }))
    );
  } catch (err) {
    return next(err);
  }
});

// POST /api/reviews/:id/respond { comment }
router.post('/:id/respond', auth, requireReviewer, async (req, res, next) => {
  try {
    const { comment } = req.body || {};
    if (!comment || typeof comment !== 'string' || !comment.trim()) {
      return res.status(400).json({ error: 'BadRequest', message: 'comment is required.' });
    }
    const record = await AnalysisHistory.findById(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'NotFound', message: 'Analysis not found.' });
    }
    record.reviewStatus = 'reviewed';
    record.reviewComment = comment.trim();
    record.reviewedBy = req.reviewer.name;
    record.reviewedAt = new Date();
    await record.save();
    try {
      await createNotification({
        user: record.user,
        type: 'review_update',
        message: `A demo doctor reviewed your analysis (${record.topClass}).`,
        analysisId: record._id,
      });
    } catch (e) {
      console.error('Review notification failed (non-fatal):', e.message);
    }
    return res.json({
      id: record._id,
      reviewStatus: record.reviewStatus,
      reviewComment: record.reviewComment,
      reviewedBy: record.reviewedBy,
      reviewedAt: record.reviewedAt,
      demo: true,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
