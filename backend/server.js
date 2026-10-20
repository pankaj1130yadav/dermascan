// DermaScan backend entry point (v2.1).
// Creates the Express app + HTTP server + Socket.io, mounts all routers.
// When required as a module (tests), it exports the app WITHOUT listening or
// connecting to MongoDB; `npm start` / `node server.js` behavior is unchanged.
require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const swaggerUi = require('swagger-ui-express');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { setIo } = require('./lib/notify');
const authRoutes = require('./routes/auth');
const analyzeRoutes = require('./routes/analyze');
const profilesRoutes = require('./routes/profiles');
const spotsRoutes = require('./routes/spots');
const statsRoutes = require('./routes/stats');
const consultRoutes = require('./routes/consult');
const reviewsRoutes = require('./routes/reviews');
const notificationsRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const exportRoutes = require('./routes/export');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Copy .env.example to .env and set it.');
  if (require.main === module) process.exit(1);
}

const app = express();
const server = http.createServer(app);

// Socket.io — client sends JWT in handshake auth; joins room `user:<id>`.
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
setIo(io);
io.on('connection', (socket) => {
  const token = socket.handshake && socket.handshake.auth && socket.handshake.auth.token;
  if (!token) {
    socket.disconnect(true);
    return;
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.join(`user:${decoded.id}`);
  } catch (e) {
    socket.disconnect(true);
  }
});

// Security headers (CSP relaxed only for the Swagger UI path).
app.use((req, res, next) => {
  if (req.path.startsWith('/api/docs')) {
    return helmet({ contentSecurityPolicy: false })(req, res, next);
  }
  return helmet()(req, res, next);
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Static uploads (analysis photos, gradcam, segmentation overlays)
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Rate limits — honest 429 in the standard error shape.
const rateLimitHandler = (req, res) =>
  res.status(429).json({
    error: 'TooManyRequests',
    message: 'Too many requests. Please slow down and try again later.',
  });
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
const analyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Swagger UI (mounted before the 404 handler)
// eslint-disable-next-line import/no-dynamic-require
const openapiDoc = require('./docs/openapi.json');
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc));

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/analyze', analyzeLimiter);
app.use('/api', analyzeRoutes);
app.use('/api/profiles', profilesRoutes);
app.use('/api/spots', spotsRoutes);
app.use('/api', statsRoutes); // /api/stats, /api/insights, /api/reminders
app.use('/api', consultRoutes); // /api/doctors, /api/bookings
app.use('/api/reviews', reviewsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/export', exportRoutes);

// 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'NotFound', message: 'Route not found.' });
});

// Central error-handling middleware. Never leaks stack traces or fake data.
app.use((err, req, res, next) => {
  if (err && (err.name === 'MulterError' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
    let message = 'File upload failed.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'Image too large. Maximum size is 5MB.';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Only image files are allowed (e.g. image/jpeg, image/png).';
    } else if (err.message) {
      message = err.message;
    }
    return res.status(400).json({ error: 'UploadError', message });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'BadRequest', message: 'Malformed JSON body.' });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: 'InternalError',
    message: 'Something went wrong on the server.',
  });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  connectDB()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`DermaScan backend listening on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error('FATAL: could not connect to MongoDB:', err.message);
      process.exit(1);
    });
}

module.exports = app;
module.exports.server = server;
module.exports.io = io;
