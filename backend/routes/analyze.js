// Image analysis + history routes (v2).
// Accepts one image upload (disk storage into backend/uploads/, 5MB max, image
// MIME types only), forwards it as multipart/form-data to the Python ML
// service, then persists the ML service's REAL response to AnalysisHistory.
// No fake data is ever generated here: ML errors are propagated honestly.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const AnalysisHistory = require('../models/AnalysisHistory');
const User = require('../models/User');
const Profile = require('../models/Profile');
const BodySpot = require('../models/BodySpot');
const { createNotification, getIo } = require('../lib/notify');

const router = express.Router();

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE'));
  },
});

const ML_BASE_URL = () => process.env.ML_SERVICE_URL || 'http://localhost:8000';
const DISCLAIMER =
  'Educational demo only — not a medical device. Consult a qualified dermatologist for any medical concern.';

// Normalize the ML service's risk label into our enum; fall back to "unknown".
const normalizeRiskTier = (value) => {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['low', 'medium', 'high'].includes(v)) return v;
    if (v === 'moderate') return 'medium';
  }
  return 'unknown';
};

const fullRecord = (r) => ({
  id: r._id,
  topClass: r.topClass,
  predictions: r.predictions,
  riskTier: r.riskTier,
  createdAt: r.createdAt,
  imageUrl: r.imageUrl || null,
  gradcamUrl: r.gradcamUrl || null,
  quality: r.quality || null,
  lesionCoverage: r.lesionCoverage != null ? r.lesionCoverage : null,
  modelUsed: r.modelUsed || 'mobilenet',
  altPredictions: r.altPredictions || [],
  altTopClass: r.altTopClass || null,
  feedback: r.feedback != null ? r.feedback : null,
  profileId: r.profileId || null,
  spotId: r.spotId || null,
  shareToken: r.shareToken || null,
  details: r.details || null,
  segUrl: r.segUrl || null,
  intake: r.intake || null,
  reviewStatus: r.reviewStatus || 'none',
  reviewComment: r.reviewComment || null,
  reviewedBy: r.reviewedBy || null,
  reviewedAt: r.reviewedAt || null,
});

const ALLOWED_INTAKE_CHANGES = ['growth', 'itching', 'bleeding', 'color-change', 'pain', 'none'];

const parseIntake = (b) => {
  if (!b) return null;
  const hasAny =
    b.intakeDuration || b.intakeChanges || b.intakeFamilyHistory !== undefined || b.intakeNotes;
  if (!hasAny) return null;
  let changes = [];
  if (b.intakeChanges) {
    if (Array.isArray(b.intakeChanges)) {
      changes = b.intakeChanges;
    } else if (typeof b.intakeChanges === 'string') {
      const raw = b.intakeChanges.trim();
      try {
        const parsed = JSON.parse(raw);
        changes = Array.isArray(parsed) ? parsed : raw.split(',');
      } catch (e) {
        changes = raw.split(',');
      }
    }
    changes = changes
      .map((c) => String(c).trim())
      .filter((c) => ALLOWED_INTAKE_CHANGES.includes(c));
  }
  return {
    duration: b.intakeDuration ? String(b.intakeDuration) : '',
    changes,
    familyHistory: b.intakeFamilyHistory === 'true' || b.intakeFamilyHistory === true,
    notes: b.intakeNotes ? String(b.intakeNotes) : '',
  };
};

// Decode a base64 data URI (gradcam) into a file under uploads/. Returns URL or null.
const saveDataUriImage = (dataUri, baseName) => {
  try {
    if (typeof dataUri !== 'string') return null;
    const match = dataUri.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!match) return null;
    const buf = Buffer.from(match[1], 'base64');
    const filename = `${baseName}_cam.jpg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
    return `/uploads/${filename}`;
  } catch (e) {
    return null;
  }
};

const findOwnedRecord = async (req, res) => {
  const record = await AnalysisHistory.findById(req.params.id);
  if (!record) {
    res.status(404).json({ error: 'NotFound', message: 'No analysis found with that id.' });
    return null;
  }
  if (record.user.toString() !== req.user.id) {
    res.status(403).json({ error: 'Forbidden', message: 'You can only access your own analyses.' });
    return null;
  }
  return record;
};

// ---------------------------------------------------------------------------
// POST /api/analyze  (auth required)  multipart field: "image"
// Optional form fields: model ('mobilenet'|'efficientnet'|'both'), profileId, spotId
// ---------------------------------------------------------------------------
router.post('/analyze', auth, upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'No image uploaded. Send multipart form data with an "image" file field.',
      });
    }

    const model = ['mobilenet', 'efficientnet', 'both', 'ensemble'].includes(
      req.body && req.body.model
    )
      ? req.body.model
      : 'mobilenet';
    const ttaUsed = !!(req.body && (req.body.tta === 'true' || req.body.tta === true));
    const hairRemovalUsed = !!(
      req.body &&
      (req.body.hairRemoval === 'true' || req.body.hairRemoval === true)
    );
    const intake = parseIntake(req.body);

    // Validate profileId / spotId belong to this user.
    let profileId = null;
    let spotId = null;
    if (req.body && req.body.profileId) {
      const profile = await Profile.findOne({ _id: req.body.profileId, user: req.user.id });
      if (!profile) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          error: 'BadRequest',
          message: 'profileId does not belong to you or does not exist.',
        });
      }
      profileId = profile._id;
    }
    if (req.body && req.body.spotId) {
      const spot = await BodySpot.findOne({ _id: req.body.spotId, user: req.user.id });
      if (!spot) {
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({
          error: 'BadRequest',
          message: 'spotId does not belong to you or does not exist.',
        });
      }
      spotId = spot._id;
    }

    // Forward the image to the ML service. The ml-service expects field "file".
    const endpoint =
      model === 'both'
        ? '/predict/compare'
        : model === 'ensemble'
          ? '/predict/ensemble'
          : model === 'efficientnet'
            ? '/predict/efficientnet'
            : '/predict';
    const timeout = model === 'both' || model === 'ensemble' ? 180000 : 120000;

    const form = new FormData();
    form.append('file', fs.createReadStream(req.file.path), {
      filename: req.file.originalname || 'upload.jpg',
      contentType: req.file.mimetype,
    });
    if (ttaUsed) form.append('tta', 'true');
    if (hairRemovalUsed) form.append('hair_removal', 'true');

    let mlResponse;
    try {
      mlResponse = await axios.post(`${ML_BASE_URL()}${endpoint}`, form, {
        headers: form.getHeaders(),
        maxBodyLength: MAX_BYTES + 1024,
        timeout,
      });
    } catch (err) {
      if (err.response && err.response.status === 503) {
        return res.status(503).json({
          error: 'ModelNotTrained',
          message:
            'The ML service has no trained model loaded. Train it first by running "python train.py" inside the ml-service directory, then retry this request.',
        });
      }
      if (!err.response) {
        return res.status(502).json({
          error: 'MlServiceUnreachable',
          message: `Could not reach the ML service at ${ML_BASE_URL()}${endpoint}. Make sure the ml-service is running.`,
        });
      }
      return res.status(502).json({
        error: 'MlServiceError',
        message: `The ML service returned status ${err.response.status}.`,
        details: err.response.data,
      });
    }

    const data = mlResponse.data || {};

    // Normalize the three possible ML response shapes.
    let predictions = [];
    let topClass = null;
    let riskTier = 'unknown';
    let altPredictions = [];
    let altTopClass = null;
    let quality = data.quality || null;
    let lesion = data.lesion || null;
    let gradcam = data.gradcam || null;
    let advisory = data.advisory || null;

    // v2.1 extras present on /predict, /predict/efficientnet, /predict/ensemble
    const uncertainty = data.uncertainty || null;
    const ood = data.ood || null;
    const segmentation = data.segmentation || null;
    let disagreement = null;
    let perModelTops = null;

    if (model === 'both') {
      const mob = data.mobilenet || {};
      const eff = data.efficientnet || null;
      predictions = Array.isArray(mob.predictions) ? mob.predictions : [];
      topClass = mob.top_class || mob.topClass || null;
      riskTier = normalizeRiskTier(mob.overall_risk_tier ?? mob.risk_tier ?? mob.riskTier);
      gradcam = mob.gradcam || gradcam;
      advisory = mob.advisory || advisory;
      if (eff) {
        altPredictions = Array.isArray(eff.predictions) ? eff.predictions : [];
        altTopClass = eff.top_class || eff.topClass || null;
      }
    } else if (model === 'ensemble') {
      predictions = Array.isArray(data.predictions) ? data.predictions : [];
      topClass = data.top_class || data.topClass || null;
      riskTier = normalizeRiskTier(data.overall_risk_tier ?? data.risk_tier ?? data.riskTier);
      disagreement = data.disagreement != null ? data.disagreement : null;
      perModelTops = data.per_model || data.perModel || data.per_model_tops || null;
      if (perModelTops) {
        const mobTop =
          perModelTops.mobilenet && (perModelTops.mobilenet.top_class || perModelTops.mobilenet.topClass);
        const effTop =
          perModelTops.efficientnet &&
          (perModelTops.efficientnet.top_class || perModelTops.efficientnet.topClass);
        if (effTop) altTopClass = effTop;
        if (mobTop && !topClass) topClass = mobTop;
        if (perModelTops.efficientnet && Array.isArray(perModelTops.efficientnet.predictions)) {
          altPredictions = perModelTops.efficientnet.predictions;
        }
      }
    } else if (model === 'efficientnet') {
      predictions = Array.isArray(data.predictions) ? data.predictions : [];
      topClass = data.top_class || data.topClass || null;
      riskTier = normalizeRiskTier(data.overall_risk_tier ?? data.risk_tier ?? data.riskTier);
    } else {
      predictions = Array.isArray(data.predictions) ? data.predictions : [];
      topClass = data.top_class || data.topClass || null;
      riskTier = normalizeRiskTier(data.overall_risk_tier ?? data.risk_tier ?? data.riskTier);
    }

    if (!topClass) {
      return res.status(502).json({
        error: 'MlServiceError',
        message: 'The ML service response did not include a top class.',
        details: data,
      });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const baseName = path.parse(req.file.filename).name;
    const gradcamUrl = gradcam ? saveDataUriImage(gradcam, baseName) : null;
    let lesionCoverage =
      lesion && typeof lesion.coverage_percent === 'number' ? lesion.coverage_percent : null;
    if (lesionCoverage == null && segmentation && typeof segmentation.coverage_percent === 'number') {
      lesionCoverage = segmentation.coverage_percent;
    }

    // Segmentation overlay → uploads/<base>_seg.jpg
    let segUrl = null;
    if (segmentation && segmentation.overlay) {
      try {
        const match = String(segmentation.overlay).match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
        if (match) {
          const segName = `${baseName}_seg.jpg`;
          fs.writeFileSync(path.join(UPLOADS_DIR, segName), Buffer.from(match[1], 'base64'));
          segUrl = `/uploads/${segName}`;
        }
      } catch (e) {
        segUrl = null;
      }
    }

    const details = {
      uncertainty,
      ood,
      disagreement,
      perModelTops,
      ttaUsed,
      hairRemovalUsed,
      ttaDelta:
        data.tta && data.tta.delta_top_probability != null
          ? data.tta.delta_top_probability
          : data.tta_delta != null
            ? data.tta_delta
            : data.ttaDelta != null
              ? data.ttaDelta
              : null,
      segmentationCoverage:
        segmentation && segmentation.coverage_percent != null ? segmentation.coverage_percent : null,
    };
    const hasDetails = Object.values(details).some((v) => v !== null && v !== false);

    const record = await AnalysisHistory.create({
      user: req.user.id,
      topClass,
      predictions,
      riskTier,
      imageUrl,
      gradcamUrl,
      quality,
      lesionCoverage,
      modelUsed: model,
      altPredictions,
      altTopClass,
      profileId,
      spotId,
      details: hasDetails ? details : null,
      segUrl,
      intake,
    });

    // Notifications + realtime (best-effort; never fail the analysis response).
    try {
      await createNotification({
        user: req.user.id,
        type: 'analysis_completed',
        message: `Analysis completed: ${record.topClass} (${record.riskTier} risk).`,
        analysisId: record._id,
      });
      const io = getIo();
      if (io) {
        io.to(`user:${req.user.id.toString()}`).emit('analysisCompleted', {
          id: record._id,
          topClass: record.topClass,
          riskTier: record.riskTier,
          createdAt: record.createdAt,
        });
      }
    } catch (e) {
      console.error('Notification failed (non-fatal):', e.message);
    }

    return res.status(200).json({
      id: record._id,
      topClass: record.topClass,
      predictions: record.predictions,
      riskTier: record.riskTier,
      createdAt: record.createdAt,
      disclaimer: DISCLAIMER,
      advisory,
      imageUrl: record.imageUrl,
      gradcamUrl: record.gradcamUrl,
      quality: record.quality,
      lesion,
      modelUsed: record.modelUsed,
      altPredictions: record.altPredictions,
      altTopClass: record.altTopClass,
      profileId: record.profileId,
      spotId: record.spotId,
      details: record.details,
      segUrl: record.segUrl,
      intake: record.intake,
      reviewStatus: record.reviewStatus,
      uncertainty,
      ood,
      segmentation: segmentation
        ? { coverage_percent: segmentation.coverage_percent != null ? segmentation.coverage_percent : null }
        : null,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/export.csv  (auth) — MUST be declared before /history/:id
// ---------------------------------------------------------------------------
router.get('/history/export.csv', auth, async (req, res, next) => {
  try {
    const items = await AnalysisHistory.find({ user: req.user.id }).sort({ createdAt: -1 });
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['date,topClass,riskTier,modelUsed,predictions,feedback,profileId'];
    for (const r of items) {
      const top3 = [...(r.predictions || [])]
        .sort((a, b) => (b.probability || 0) - (a.probability || 0))
        .slice(0, 3)
        .map((p) => `${p.name || p.class_id || ''}:${p.probability != null ? Number(p.probability).toFixed(4) : ''}`)
        .join(' | ');
      lines.push(
        [
          esc(r.createdAt ? r.createdAt.toISOString() : ''),
          esc(r.topClass),
          esc(r.riskTier),
          esc(r.modelUsed || 'mobilenet'),
          esc(top3),
          esc(r.feedback || ''),
          esc(r.profileId ? r.profileId.toString() : ''),
        ].join(',')
      );
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="dermascan-history.csv"');
    return res.send(lines.join('\n'));
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/history  (auth required) — newest first; ?profileId= & ?spotId= filters
// ---------------------------------------------------------------------------
router.get('/history', auth, async (req, res, next) => {
  try {
    const filter = { user: req.user.id };
    if (req.query.profileId) filter.profileId = req.query.profileId;
    if (req.query.spotId) filter.spotId = req.query.spotId;
    const items = await AnalysisHistory.find(filter).sort({ createdAt: -1 });
    return res.json(items.map(fullRecord));
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/full-report.pdf  (auth) — MUST be before /history/:id
// ---------------------------------------------------------------------------
router.get('/history/full-report.pdf', auth, async (req, res, next) => {
  try {
    const [user, items] = await Promise.all([
      User.findById(req.user.id),
      AnalysisHistory.find({ user: req.user.id }).sort({ createdAt: -1 }),
    ]);
    const perRisk = { low: 0, medium: 0, high: 0, unknown: 0 };
    const perClass = {};
    for (const r of items) {
      if (perRisk[r.riskTier] !== undefined) perRisk[r.riskTier] += 1;
      perClass[r.topClass] = (perClass[r.topClass] || 0) + 1;
    }
    const now = Date.now();
    const d30 = 30 * 24 * 60 * 60 * 1000;
    const recent = items.filter((r) => now - new Date(r.createdAt).getTime() <= d30).length;
    const previous = items.filter((r) => {
      const age = now - new Date(r.createdAt).getTime();
      return age > d30 && age <= 2 * d30;
    }).length;
    const trend =
      recent > previous
        ? `more analyses in the last 30 days (${recent}) than the previous 30 days (${previous})`
        : recent < previous
          ? `fewer analyses in the last 30 days (${recent}) than the previous 30 days (${previous})`
          : `the same number of analyses in the last 30 days (${recent}) as the previous 30 days (${previous})`;

    const pdf = await new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.fontSize(22).text('DermaScan — Full Health Report', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#666666').text(DISCLAIMER, { align: 'center' }).fillColor('#000000');
        doc.moveDown();
        doc.fontSize(12).text(`User: ${user ? user.name : ''}`);
        doc.text(`Generated: ${new Date().toISOString()}`);
        doc.moveDown();
        doc.fontSize(15).text('Summary');
        doc.fontSize(11);
        doc.text(`Total analyses: ${items.length}`);
        doc.text(
          `By risk — low: ${perRisk.low}, medium: ${perRisk.medium}, high: ${perRisk.high}, unknown: ${perRisk.unknown}`
        );
        doc.text(
          `By class: ${Object.entries(perClass).map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}`
        );
        doc.text(`Trend: ${trend}.`);
        doc.moveDown();
        doc.fontSize(15).text('All analyses');
        doc.fontSize(9);
        if (items.length === 0) doc.text('No analyses yet.');
        for (const r of items) {
          doc.text(
            `${new Date(r.createdAt).toISOString().slice(0, 10)}  |  ${r.topClass}  |  risk: ${r.riskTier}  |  model: ${r.modelUsed || 'mobilenet'}  |  feedback: ${r.feedback || '—'}`
          );
        }
        doc.moveDown();
        doc
          .fontSize(10)
          .fillColor('#666666')
          .text('Educational demo — not a medical diagnosis.', { align: 'center' });
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="dermascan-full-report.pdf"');
    return res.send(pdf);
  } catch (err) {
    return next(err);
  }
});

// GET /api/history/:id  (auth, own only)
router.get('/history/:id', auth, async (req, res, next) => {
  try {
    const record = await findOwnedRecord(req, res);
    if (!record) return;
    return res.json(fullRecord(record));
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/history/:id  (auth required)
router.delete('/history/:id', auth, async (req, res, next) => {
  try {
    const record = await findOwnedRecord(req, res);
    if (!record) return;
    await record.deleteOne();
    return res.json({ message: 'Analysis deleted.', id: record._id });
  } catch (err) {
    return next(err);
  }
});

// POST /api/history/:id/feedback  { verdict: 'right' | 'wrong' }
router.post(
  '/history/:id/feedback',
  auth,
  body('verdict').isIn(['right', 'wrong']).withMessage('verdict must be "right" or "wrong".'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'BadRequest',
          message: errors.array()[0].msg,
        });
      }
      const record = await findOwnedRecord(req, res);
      if (!record) return;
      record.feedback = req.body.verdict;
      await record.save();
      return res.json(fullRecord(record));
    } catch (err) {
      return next(err);
    }
  }
);

// PATCH /api/history/:id/intake  (auth, own) — edit case intake later
router.patch(
  '/history/:id/intake',
  auth,
  body('changes')
    .optional()
    .isArray()
    .withMessage('changes must be an array.')
    .custom((arr) => arr.every((c) => ALLOWED_INTAKE_CHANGES.includes(c)))
    .withMessage(`changes must be a subset of: ${ALLOWED_INTAKE_CHANGES.join(', ')}`),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'BadRequest', message: errors.array()[0].msg });
      }
      const record = await findOwnedRecord(req, res);
      if (!record) return;
      const { duration, changes, familyHistory, notes } = req.body || {};
      const intake = record.intake || { duration: '', changes: [], familyHistory: false, notes: '' };
      if (duration !== undefined) intake.duration = String(duration);
      if (changes !== undefined) intake.changes = changes;
      if (familyHistory !== undefined) intake.familyHistory = !!familyHistory;
      if (notes !== undefined) intake.notes = String(notes);
      record.intake = intake;
      record.markModified('intake');
      await record.save();
      return res.json(fullRecord(record));
    } catch (err) {
      return next(err);
    }
  }
);

// POST /api/history/:id/request-review  (auth, own) — demo doctor review queue
router.post('/history/:id/request-review', auth, async (req, res, next) => {
  try {
    const record = await findOwnedRecord(req, res);
    if (!record) return;
    record.reviewStatus = 'requested';
    await record.save();
    return res.json({ ...fullRecord(record), demo: true });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// PDF report helpers
// ---------------------------------------------------------------------------
const buildReportPdf = (record) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text('DermaScan — Analysis Report', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#666666').text(DISCLAIMER, { align: 'center' });
      doc.fillColor('#000000').moveDown();

      doc.fontSize(12).text(`Date: ${record.createdAt ? new Date(record.createdAt).toISOString() : ''}`);
      doc.text(`Top class: ${record.topClass}`);
      doc.text(`Risk tier: ${record.riskTier}`);
      if (record.details && record.details.uncertainty) {
        const u = record.details.uncertainty;
        if (u.reliability) doc.text(`Uncertainty reliability: ${u.reliability}`);
        if (u.reliability === 'low') {
          doc
            .fontSize(13)
            .fillColor('#cc0000')
            .text('UNCERTAIN RESULT — model reliability is LOW for this image. Please consult a dermatologist.')
            .fillColor('#000000')
            .fontSize(12);
        }
      }
      doc.text(`Model used: ${record.modelUsed || 'mobilenet'}`);
      if (record.quality && record.quality.score != null) {
        doc.text(`Photo quality score: ${record.quality.score}`);
      }
      if (record.lesionCoverage != null) {
        doc.text(`Lesion coverage: ${record.lesionCoverage}%`);
      }
      doc.moveDown();

      doc.fontSize(14).text('Predictions');
      doc.fontSize(11);
      const preds = [...(record.predictions || [])].sort(
        (a, b) => (b.probability || 0) - (a.probability || 0)
      );
      if (preds.length === 0) doc.text('No predictions stored.');
      for (const p of preds) {
        const prob = p.probability != null ? `${(Number(p.probability) * 100).toFixed(2)}%` : 'n/a';
        doc.text(`• ${p.name || p.class_id || 'unknown'} — ${prob}${p.risk_tier ? ` (risk: ${p.risk_tier})` : ''}`);
      }
      if (record.altTopClass) {
        doc.moveDown();
        doc.fontSize(12).text(`Alternate model (EfficientNet) top class: ${record.altTopClass}`);
      }
      doc.moveDown();

      if (record.intake) {
        doc.fontSize(14).text('Intake');
        doc.fontSize(11);
        if (record.intake.duration) doc.text(`Duration: ${record.intake.duration}`);
        if (Array.isArray(record.intake.changes) && record.intake.changes.length) {
          doc.text(`Changes noticed: ${record.intake.changes.join(', ')}`);
        }
        doc.text(`Family history of skin cancer: ${record.intake.familyHistory ? 'Yes' : 'No'}`);
        if (record.intake.notes) doc.text(`Notes: ${record.intake.notes}`);
        doc.moveDown();
      }
      if (record.reviewStatus === 'reviewed' && record.reviewComment) {
        doc.fontSize(14).text('Demo doctor review');
        doc.fontSize(11).text(`Reviewed by: ${record.reviewedBy || 'demo doctor'}`);
        doc.text(`Comment: ${record.reviewComment}`);
        doc.moveDown();
      }

      // Embed the stored photo if it still exists on disk.
      if (record.imageUrl) {
        const imgPath = path.join(UPLOADS_DIR, path.basename(record.imageUrl));
        if (fs.existsSync(imgPath)) {
          doc.fontSize(14).text('Uploaded photo');
          doc.moveDown(0.5);
          try {
            doc.image(imgPath, { fit: [400, 400] });
          } catch (e) {
            doc.fontSize(10).text('(Image could not be embedded.)');
          }
          doc.moveDown();
        }
      }

      doc
        .fontSize(10)
        .fillColor('#666666')
        .text('Educational demo — not a medical diagnosis.', { align: 'center' });
      doc.end();
    } catch (e) {
      reject(e);
    }
  });

// GET /api/history/:id/report.pdf  (auth, own only)
router.get('/history/:id/report.pdf', auth, async (req, res, next) => {
  try {
    const record = await findOwnedRecord(req, res);
    if (!record) return;
    const pdf = await buildReportPdf(record);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dermascan-report-${record._id}.pdf"`
    );
    return res.send(pdf);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/history/:id/email  { email }
// ---------------------------------------------------------------------------
router.post('/history/:id/email', auth, async (req, res, next) => {
  try {
    if (!process.env.SMTP_HOST) {
      return res.status(501).json({
        error: 'EmailNotConfigured',
        message: 'Email is not configured on this server (SMTP settings missing).',
      });
    }
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ error: 'BadRequest', message: 'A valid email is required.' });
    }
    const record = await findOwnedRecord(req, res);
    if (!record) return;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });

    const top3 = [...(record.predictions || [])]
      .sort((a, b) => (b.probability || 0) - (a.probability || 0))
      .slice(0, 3)
      .map((p) => `${p.name || p.class_id}: ${p.probability != null ? (Number(p.probability) * 100).toFixed(1) + '%' : 'n/a'}`)
      .join('\n');

    let attachments = [];
    try {
      const pdf = await buildReportPdf(record);
      attachments = [{ filename: `dermascan-report-${record._id}.pdf`, content: pdf }];
    } catch (e) {
      attachments = [];
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Your DermaScan analysis report',
      text:
        `DermaScan — Analysis Report\n\n` +
        `Date: ${record.createdAt ? new Date(record.createdAt).toISOString() : ''}\n` +
        `Top class: ${record.topClass}\nRisk tier: ${record.riskTier}\nModel: ${record.modelUsed || 'mobilenet'}\n\n` +
        `Top predictions:\n${top3}\n\n${DISCLAIMER}\n\nEducational demo — not a medical diagnosis.`,
      attachments,
    });
    return res.json({ sent: true });
  } catch (err) {
    return res.status(502).json({
      error: 'EmailSendFailed',
      message: `Could not send email: ${err.message}`,
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/history/:id/share  (auth, own only) → token + QR
// ---------------------------------------------------------------------------
router.post('/history/:id/share', auth, async (req, res, next) => {
  try {
    const record = await findOwnedRecord(req, res);
    if (!record) return;
    if (!record.shareToken) {
      record.shareToken = crypto.randomBytes(16).toString('hex');
      await record.save();
    }
    const sharePath = `/shared/${record.shareToken}`;
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    const qrDataUrl = await QRCode.toDataURL(`${frontend}${sharePath}`);
    return res.json({ token: record.shareToken, sharePath, qrDataUrl });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/shared/:token  (PUBLIC — no auth, no user info)
// ---------------------------------------------------------------------------
router.get('/shared/:token', async (req, res, next) => {
  try {
    const record = await AnalysisHistory.findOne({ shareToken: req.params.token });
    if (!record) {
      return res.status(404).json({ error: 'NotFound', message: 'Shared analysis not found.' });
    }
    return res.json({
      topClass: record.topClass,
      predictions: record.predictions,
      riskTier: record.riskTier,
      createdAt: record.createdAt,
      imageUrl: record.imageUrl || null,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/change-score  (auth) — multipart file_a + file_b (aliases imageA/imageB)
// Forwards both photos to ML POST /change-score and returns its real result.
// ---------------------------------------------------------------------------
router.post(
  '/change-score',
  auth,
  upload.fields([
    { name: 'file_a', maxCount: 1 },
    { name: 'file_b', maxCount: 1 },
    { name: 'imageA', maxCount: 1 },
    { name: 'imageB', maxCount: 1 },
  ]),
  async (req, res, next) => {
    try {
      const files = req.files || {};
      const a = (files.file_a && files.file_a[0]) || (files.imageA && files.imageA[0]);
      const b = (files.file_b && files.file_b[0]) || (files.imageB && files.imageB[0]);
      if (!a || !b) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Send two images as multipart fields "file_a" and "file_b".',
        });
      }
      const form = new FormData();
      form.append('file_a', fs.createReadStream(a.path), {
        filename: a.originalname || 'a.jpg',
        contentType: a.mimetype,
      });
      form.append('file_b', fs.createReadStream(b.path), {
        filename: b.originalname || 'b.jpg',
        contentType: b.mimetype,
      });
      try {
        const ml = await axios.post(`${ML_BASE_URL()}/change-score`, form, {
          headers: form.getHeaders(),
          maxBodyLength: MAX_BYTES * 2 + 2048,
          timeout: 120000,
        });
        return res.json({ ...(ml.data || {}), demo: true });
      } catch (err) {
        if (err.response && err.response.status === 503) {
          return res.status(503).json({
            error: 'ModelNotTrained',
            message: 'The ML service cannot compute a change score right now (503).',
          });
        }
        if (!err.response) {
          return res.status(502).json({
            error: 'MlServiceUnreachable',
            message: `Could not reach the ML service at ${ML_BASE_URL()}/change-score.`,
          });
        }
        return res.status(502).json({
          error: 'MlServiceError',
          message: `The ML service returned status ${err.response.status}.`,
          details: err.response.data,
        });
      }
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
