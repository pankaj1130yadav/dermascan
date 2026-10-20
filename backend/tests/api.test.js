// DermaScan backend API tests.
// Uses node:test + supertest + mongodb-memory-server and a STUB ML server
// (a tiny local http server returning a fixed, clearly-labeled STUB payload —
// no real model is involved in these tests).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-api-tests';
process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

// A tiny valid 1x1 JPEG (base64) used as a stub gradcam/segmentation overlay.
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwH/2Q==';

const stubPredictPayload = {
  predictions: [
    { class_id: 'mel', name: 'melanoma', probability: 0.62, risk_tier: 'high' },
    { class_id: 'nv', name: 'melanocytic nevus', probability: 0.3, risk_tier: 'low' },
  ],
  top_class: 'mel',
  overall_risk_tier: 'high',
  advisory: 'STUB advisory (test fixture, not a real model output).',
  quality: { blur_variance: 123.4, brightness: 0.55, score: 82, warnings: [] },
  lesion: { coverage_percent: 12.5, method: 'stub-threshold' },
  gradcam: `data:image/jpeg;base64,${TINY_JPEG_B64}`,
  uncertainty: { entropy: 0.42, reliability: 'medium' },
  ood: { skin_coverage_percent: 88, is_likely_lesion_photo: true, warning: null },
  segmentation: {
    overlay: `data:image/jpeg;base64,${TINY_JPEG_B64}`,
    coverage_percent: 12.5,
  },
};

let mongoServer;
let stubServer;
let app;
let token;
let analysisId;
let profileId;

before(async () => {
  // Stub ML server
  stubServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/predict/ensemble') {
      return res.end(
        JSON.stringify({
          ...stubPredictPayload,
          disagreement: 0.1,
          per_model: {
            mobilenet: { top_class: 'mel', predictions: stubPredictPayload.predictions },
            efficientnet: { top_class: 'nv', predictions: [] },
          },
        })
      );
    }
    if (req.url === '/change-score') {
      return res.end(
        JSON.stringify({
          area_a_percent: 10,
          area_b_percent: 12,
          area_delta_percent: 2,
          color_delta: 0.03,
          change_score: 0.21,
          method: 'stub',
        })
      );
    }
    // /predict, /predict/efficientnet, /predict/compare fall through to the stub.
    // /predict/compare has a different shape; emulate it minimally.
    if (req.url === '/predict/compare') {
      return res.end(
        JSON.stringify({
          quality: stubPredictPayload.quality,
          lesion: stubPredictPayload.lesion,
          mobilenet: {
            predictions: stubPredictPayload.predictions,
            top_class: 'mel',
            overall_risk_tier: 'high',
            gradcam: stubPredictPayload.gradcam,
            advisory: stubPredictPayload.advisory,
          },
          efficientnet: {
            predictions: [
              { class_id: 'nv', name: 'melanocytic nevus', probability: 0.5, risk_tier: 'low' },
            ],
            top_class: 'nv',
            overall_risk_tier: 'low',
            gradcam: null,
            advisory: 'STUB',
          },
        })
      );
    }
    return res.end(JSON.stringify(stubPredictPayload));
  });
  await new Promise((resolve) => stubServer.listen(0, '127.0.0.1', resolve));
  const stubPort = stubServer.address().port;
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${stubPort}`;

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  // Require the app only after env + DB are ready (it does not listen on require).
  app = require('../server');
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  if (stubServer) await new Promise((resolve) => stubServer.close(resolve));
});

test('register validation failure: bad email → 400', async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Bad', email: 'not-an-email', password: 'secret123' });
  assert.strictEqual(res.status, 400);
});

test('register + login happy path, user payload includes role', async () => {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email: 'test@example.com', password: 'secret123' });
  assert.strictEqual(reg.status, 201);
  assert.ok(reg.body.token);
  assert.strictEqual(reg.body.user.role, 'user');

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'test@example.com', password: 'secret123' });
  assert.strictEqual(login.status, 200);
  assert.ok(login.body.token);
  token = login.body.token;
});

test('analyze happy path: image stored, details persisted (STUB ML)', async () => {
  const res = await request(app)
    .post('/api/analyze')
    .set('Authorization', `Bearer ${token}`)
    .field('intakeDuration', '3 months')
    .field('intakeChanges', 'growth,itching')
    .attach('image', Buffer.from(TINY_JPEG_B64, 'base64'), {
      filename: 'lesion.jpg',
      contentType: 'image/jpeg',
    });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.topClass, 'mel');
  assert.ok(res.body.imageUrl && res.body.imageUrl.startsWith('/uploads/'));
  assert.ok(res.body.gradcamUrl, 'gradcam should be decoded to a file URL');
  assert.ok(res.body.segUrl, 'segmentation overlay should be decoded to a file URL');
  assert.ok(res.body.details, 'details blob should be present');
  assert.strictEqual(res.body.details.uncertainty.reliability, 'medium');
  assert.strictEqual(res.body.intake.duration, '3 months');
  assert.deepStrictEqual(res.body.intake.changes, ['growth', 'itching']);
  analysisId = res.body.id;
});

test('history list + profileId filter', async () => {
  const all = await request(app).get('/api/history').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(all.status, 200);
  assert.strictEqual(all.body.length, 1);
  assert.ok(all.body[0].details);
  assert.strictEqual(all.body[0].segUrl != null, true);

  const filtered = await request(app)
    .get('/api/history?profileId=64b64c2f2f2f2f2f2f2f2f2f')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(filtered.status, 200);
  assert.strictEqual(filtered.body.length, 0);
});

test('feedback: wrong verdict → 400; right verdict → 200', async () => {
  const bad = await request(app)
    .post(`/api/history/${analysisId}/feedback`)
    .set('Authorization', `Bearer ${token}`)
    .send({ verdict: 'maybe' });
  assert.strictEqual(bad.status, 400);

  const ok = await request(app)
    .post(`/api/history/${analysisId}/feedback`)
    .set('Authorization', `Bearer ${token}`)
    .send({ verdict: 'right' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.feedback, 'right');
});

test('CSV export content-type + header', async () => {
  const res = await request(app)
    .get('/api/history/export.csv')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.ok(res.text.startsWith('date,topClass,riskTier,modelUsed,predictions,feedback,profileId'));
  assert.ok(res.text.includes('mel'));
});

test('share token + public shared fetch (no auth, no user info)', async () => {
  const share = await request(app)
    .post(`/api/history/${analysisId}/share`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.strictEqual(share.status, 200);
  assert.ok(share.body.token);
  assert.ok(share.body.qrDataUrl.startsWith('data:image/png;base64,'));

  const pub = await request(app).get(`/api/shared/${share.body.token}`);
  assert.strictEqual(pub.status, 200);
  assert.strictEqual(pub.body.topClass, 'mel');
  assert.strictEqual(pub.body.user, undefined);
  assert.strictEqual(pub.body.email, undefined);
});

test('PDF report + full report return application/pdf', async () => {
  const one = await request(app)
    .get(`/api/history/${analysisId}/report.pdf`)
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(one.status, 200);
  assert.match(one.headers['content-type'], /application\/pdf/);

  const full = await request(app)
    .get('/api/history/full-report.pdf')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(full.status, 200);
  assert.match(full.headers['content-type'], /application\/pdf/);
});

test('email without SMTP configured → 501 EmailNotConfigured', async () => {
  delete process.env.SMTP_HOST;
  const res = await request(app)
    .post(`/api/history/${analysisId}/email`)
    .set('Authorization', `Bearer ${token}`)
    .send({ email: 'someone@example.com' });
  assert.strictEqual(res.status, 501);
  assert.strictEqual(res.body.error, 'EmailNotConfigured');
});

test('profiles CRUD', async () => {
  const created = await request(app)
    .post('/api/profiles')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Family Member', relation: 'mother', birthYear: 1975 });
  assert.strictEqual(created.status, 201);
  profileId = created.body.id;

  const list = await request(app).get('/api/profiles').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(list.body.length, 1);

  const updated = await request(app)
    .put(`/api/profiles/${profileId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ notes: 'check yearly' });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.notes, 'check yearly');

  const badCreate = await request(app)
    .post('/api/profiles')
    .set('Authorization', `Bearer ${token}`)
    .send({ relation: 'x' });
  assert.strictEqual(badCreate.status, 400);

  const del = await request(app)
    .delete(`/api/profiles/${profileId}`)
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(del.status, 200);
});

test('stats + notifications endpoints respond', async () => {
  const stats = await request(app).get('/api/stats').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(stats.status, 200);
  assert.strictEqual(stats.body.total, 1);
  assert.strictEqual(stats.body.last30Days.length, 30);

  const notifs = await request(app)
    .get('/api/notifications')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(notifs.status, 200);
  assert.ok(notifs.body.some((n) => n.type === 'analysis_completed'));
});

test('admin guard: non-admin → 403', async () => {
  const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 403);
});

test('review queue guard: normal user → 403', async () => {
  const res = await request(app)
    .get('/api/reviews/queue')
    .set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 403);
});

test('ensemble analyze (STUB ML) stores modelUsed=ensemble + disagreement', async () => {
  const res = await request(app)
    .post('/api/analyze')
    .set('Authorization', `Bearer ${token}`)
    .field('model', 'ensemble')
    .attach('image', Buffer.from(TINY_JPEG_B64, 'base64'), {
      filename: 'lesion2.jpg',
      contentType: 'image/jpeg',
    });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.modelUsed, 'ensemble');
  assert.strictEqual(res.body.details.disagreement, 0.1);
});
