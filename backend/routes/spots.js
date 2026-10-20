// Body-map spots CRUD — auth required, own records only.
const express = require('express');
const auth = require('../middleware/auth');
const BodySpot = require('../models/BodySpot');

const router = express.Router();
router.use(auth);

const pub = (s) => ({
  id: s._id,
  profileId: s.profileId || null,
  side: s.side,
  x: s.x,
  y: s.y,
  label: s.label || '',
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const validCoords = (x, y) =>
  typeof x === 'number' && typeof y === 'number' && x >= 0 && x <= 100 && y >= 0 && y <= 100;

router.post('/', async (req, res, next) => {
  try {
    const { profileId, side, x, y, label } = req.body || {};
    if (!['front', 'back'].includes(side)) {
      return res.status(400).json({ error: 'BadRequest', message: 'side must be "front" or "back".' });
    }
    const xn = Number(x);
    const yn = Number(y);
    if (!validCoords(xn, yn)) {
      return res.status(400).json({ error: 'BadRequest', message: 'x and y must be numbers between 0 and 100.' });
    }
    const spot = await BodySpot.create({
      user: req.user.id,
      profileId: profileId || null,
      side,
      x: xn,
      y: yn,
      label: label || '',
    });
    return res.status(201).json(pub(spot));
  } catch (err) {
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const filter = { user: req.user.id };
    if (req.query.profileId) filter.profileId = req.query.profileId;
    if (req.query.side) filter.side = req.query.side;
    const items = await BodySpot.find(filter).sort({ createdAt: -1 });
    return res.json(items.map(pub));
  } catch (err) {
    return next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const spot = await BodySpot.findOne({ _id: req.params.id, user: req.user.id });
    if (!spot) {
      return res.status(404).json({ error: 'NotFound', message: 'Spot not found.' });
    }
    const { profileId, side, x, y, label } = req.body || {};
    if (side !== undefined) {
      if (!['front', 'back'].includes(side)) {
        return res.status(400).json({ error: 'BadRequest', message: 'side must be "front" or "back".' });
      }
      spot.side = side;
    }
    if (x !== undefined) spot.x = Number(x);
    if (y !== undefined) spot.y = Number(y);
    if (!validCoords(spot.x, spot.y)) {
      return res.status(400).json({ error: 'BadRequest', message: 'x and y must be numbers between 0 and 100.' });
    }
    if (profileId !== undefined) spot.profileId = profileId || null;
    if (label !== undefined) spot.label = label;
    await spot.save();
    return res.json(pub(spot));
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const spot = await BodySpot.findOne({ _id: req.params.id, user: req.user.id });
    if (!spot) {
      return res.status(404).json({ error: 'NotFound', message: 'Spot not found.' });
    }
    await spot.deleteOne();
    return res.json({ message: 'Spot deleted.', id: spot._id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
