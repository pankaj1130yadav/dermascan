// Stats, rule-based insights, and follow-up reminders — auth, own data only.
const express = require('express');
const auth = require('../middleware/auth');
const AnalysisHistory = require('../models/AnalysisHistory');
const Profile = require('../models/Profile');
const Notification = require('../models/Notification');
const { createNotification } = require('../lib/notify');

const router = express.Router();
router.use(auth);

const dayKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

// GET /api/stats
router.get('/stats', async (req, res, next) => {
  try {
    const items = await AnalysisHistory.find({ user: req.user.id }).sort({ createdAt: 1 });

    const perClass = {};
    const perRisk = { low: 0, medium: 0, high: 0, unknown: 0 };
    const feedback = { right: 0, wrong: 0 };
    const perModel = { mobilenet: 0, efficientnet: 0, both: 0, ensemble: 0 };

    for (const r of items) {
      perClass[r.topClass] = (perClass[r.topClass] || 0) + 1;
      if (perRisk[r.riskTier] !== undefined) perRisk[r.riskTier] += 1;
      else perRisk.unknown += 1;
      if (r.feedback === 'right') feedback.right += 1;
      if (r.feedback === 'wrong') feedback.wrong += 1;
      const m = r.modelUsed || 'mobilenet';
      if (perModel[m] !== undefined) perModel[m] += 1;
    }

    // Zero-filled last 30 days, ascending.
    const counts = {};
    for (const r of items) {
      const k = dayKey(new Date(r.createdAt));
      counts[k] = (counts[k] || 0) + 1;
    }
    const last30Days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const k = dayKey(d);
      last30Days.push({ date: k, count: counts[k] || 0 });
    }

    return res.json({
      total: items.length,
      perClass,
      perRisk,
      last30Days,
      feedback,
      perModel,
    });
  } catch (err) {
    return next(err);
  }
});

// GET /api/insights — rule-based only, computed from real data.
router.get('/insights', async (req, res, next) => {
  try {
    const items = await AnalysisHistory.find({ user: req.user.id }).sort({ createdAt: -1 });
    if (items.length === 0) {
      return res.json({
        generatedBy: 'rule-based',
        insights: ['No analyses yet — run your first analysis to see insights.'],
      });
    }

    const insights = [];
    const total = items.length;

    // Most frequent topClass
    const perClass = {};
    for (const r of items) perClass[r.topClass] = (perClass[r.topClass] || 0) + 1;
    const topEntry = Object.entries(perClass).sort((a, b) => b[1] - a[1])[0];
    insights.push(
      `Your most frequent result is "${topEntry[0]}" (${topEntry[1]} of ${total} analyses).`
    );

    // % high-risk
    const highCount = items.filter((r) => r.riskTier === 'high').length;
    const pct = Math.round((highCount / total) * 100);
    insights.push(`${pct}% of your analyses were flagged high-risk (${highCount} of ${total}).`);

    // Trend: last 30d vs previous 30d
    const now = Date.now();
    const d30 = 30 * 24 * 60 * 60 * 1000;
    const recent = items.filter((r) => now - new Date(r.createdAt).getTime() <= d30).length;
    const previous = items.filter((r) => {
      const age = now - new Date(r.createdAt).getTime();
      return age > d30 && age <= 2 * d30;
    }).length;
    if (recent > previous) {
      insights.push(
        `You ran more analyses in the last 30 days (${recent}) than in the previous 30 days (${previous}).`
      );
    } else if (recent < previous) {
      insights.push(
        `You ran fewer analyses in the last 30 days (${recent}) than in the previous 30 days (${previous}).`
      );
    } else {
      insights.push(
        `Your analysis count is the same in the last 30 days (${recent}) as in the previous 30 days (${previous}).`
      );
    }

    // Feedback accuracy
    const fb = items.filter((r) => r.feedback === 'right' || r.feedback === 'wrong');
    if (fb.length >= 1) {
      const right = fb.filter((r) => r.feedback === 'right').length;
      insights.push(`You marked ${right} of ${fb.length} predictions as looking right.`);
    }

    // Days since last analysis
    const last = new Date(items[0].createdAt).getTime();
    const daysSince = Math.floor((now - last) / (24 * 60 * 60 * 1000));
    insights.push(
      daysSince === 0
        ? 'Your most recent analysis was today.'
        : `It has been ${daysSince} day${daysSince === 1 ? '' : 's'} since your last analysis.`
    );

    // Most-used profile
    const withProfile = items.filter((r) => r.profileId);
    if (withProfile.length > 0) {
      const perProfile = {};
      for (const r of withProfile) {
        const k = r.profileId.toString();
        perProfile[k] = (perProfile[k] || 0) + 1;
      }
      const topProfileId = Object.entries(perProfile).sort((a, b) => b[1] - a[1])[0][0];
      const profile = await Profile.findById(topProfileId);
      if (profile) {
        insights.push(
          `Most of your tracked analyses are for ${profile.name} (${perProfile[topProfileId]} analyses).`
        );
      }
    }

    return res.json({ generatedBy: 'rule-based', insights });
  } catch (err) {
    return next(err);
  }
});

// GET /api/reminders — analyses older than 90 days, newest first, cap 20.
router.get('/reminders', async (req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const items = await AnalysisHistory.find({ user: req.user.id, createdAt: { $lt: cutoff } })
      .sort({ createdAt: -1 })
      .limit(20);
    // Lazily create at most one unread reminder_due notification per day.
    if (items.length > 0) {
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const existing = await Notification.findOne({
          user: req.user.id,
          type: 'reminder_due',
          read: false,
          createdAt: { $gte: startOfDay },
        });
        if (!existing) {
          await createNotification({
            user: req.user.id,
            type: 'reminder_due',
            message: `You have ${items.length} follow-up reminder${items.length === 1 ? '' : 's'} due`,
            analysisId: null,
          });
        }
      } catch (e) {
        console.error('Reminder notification failed (non-fatal):', e.message);
      }
    }
    const now = Date.now();
    return res.json(
      items.map((r) => ({
        analysisId: r._id,
        topClass: r.topClass,
        createdAt: r.createdAt,
        daysAgo: Math.floor((now - new Date(r.createdAt).getTime()) / (24 * 60 * 60 * 1000)),
        imageUrl: r.imageUrl || null,
        message:
          'This analysis is over 3 months old — consider retaking the photo to track changes.',
      }))
    );
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
