// Authentication routes: register + login.
// Issues a JWT valid for 7 days on success.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'BadRequest', message: errors.array()[0].msg });
  }
  return next();
};

const router = express.Router();
const SALT_ROUNDS = 10;
const TOKEN_TTL = '7d';

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role || 'user',
});

// POST /api/auth/register  { name, email, password }
router.post(
  '/register',
  body('email').isEmail().withMessage('Please provide a valid email address.'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
  validate,
  async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'BadRequest', message: 'Name is required.' });
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'BadRequest', message: 'Email is required.' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res
        .status(400)
        .json({ error: 'BadRequest', message: 'Password must be at least 6 characters.' });
    }

    const existing = await User.findOne({ email: email.trim().toLowerCase() });
    if (existing) {
      return res.status(400).json({
        error: 'EmailTaken',
        message: 'An account with this email already exists.',
      });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
    });

    return res.status(201).json({
      token: signToken(user._id),
      user: publicUser(user),
    });
  } catch (err) {
    // In case of a race between two identical registrations.
    if (err && err.code === 11000) {
      return res.status(400).json({
        error: 'EmailTaken',
        message: 'An account with this email already exists.',
      });
    }
    return next(err);
  }
});

// POST /api/auth/login  { email, password }
router.post(
  '/login',
  body('email').isEmail().withMessage('Please provide a valid email address.'),
  body('password').isString().notEmpty().withMessage('Password is required.'),
  validate,
  async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Email and password are required.',
      });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
    if (!user) {
      return res.status(401).json({
        error: 'InvalidCredentials',
        message: 'Invalid email or password.',
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({
        error: 'InvalidCredentials',
        message: 'Invalid email or password.',
      });
    }

    return res.json({
      token: signToken(user._id),
      user: publicUser(user),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
