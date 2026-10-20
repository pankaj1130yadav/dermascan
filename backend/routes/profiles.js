// Family profiles CRUD — auth required, own records only.
const express = require('express');
const { body, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const Profile = require('../models/Profile');
const AnalysisHistory = require('../models/AnalysisHistory');

const router = express.Router();
router.use(auth);

const pub = (p) => ({
  id: p._id,
  name: p.name,
  relation: p.relation || '',
  birthYear: p.birthYear != null ? p.birthYear : null,
  notes: p.notes || '',
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

router.post(
  '/',
  body('name').isString().trim().notEmpty().withMessage('Name is required.'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'BadRequest', message: errors.array()[0].msg });
    }
    return next();
  },
  async (req, res, next) => {
  try {
    const { name, relation, birthYear, notes } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'BadRequest', message: 'Name is required.' });
    }
    const profile = await Profile.create({
      user: req.user.id,
      name: name.trim(),
      relation: relation || '',
      birthYear: birthYear != null ? Number(birthYear) : null,
      notes: notes || '',
    });
    return res.status(201).json(pub(profile));
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const items = await Profile.find({ user: req.user.id }).sort({ createdAt: -1 });
    return res.json(items.map(pub));
  } catch (err) {
    return next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const profile = await Profile.findOne({ _id: req.params.id, user: req.user.id });
    if (!profile) {
      return res.status(404).json({ error: 'NotFound', message: 'Profile not found.' });
    }
    const { name, relation, birthYear, notes } = req.body || {};
    if (name !== undefined) profile.name = String(name).trim();
    if (relation !== undefined) profile.relation = relation;
    if (birthYear !== undefined) profile.birthYear = birthYear != null ? Number(birthYear) : null;
    if (notes !== undefined) profile.notes = notes;
    await profile.save();
    return res.json(pub(profile));
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const profile = await Profile.findOne({ _id: req.params.id, user: req.user.id });
    if (!profile) {
      return res.status(404).json({ error: 'NotFound', message: 'Profile not found.' });
    }
    await AnalysisHistory.updateMany(
      { user: req.user.id, profileId: profile._id },
      { $set: { profileId: null } }
    );
    await profile.deleteOne();
    return res.json({ message: 'Profile deleted.', id: profile._id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
