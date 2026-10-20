// Admin gate: run AFTER middleware/auth. Loads the user and requires role==='admin'.
const User = require('../models/User');

const admin = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
    }
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized', message: 'User not found.' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden', message: 'Admin access required.' });
    }
    req.adminUser = user;
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = admin;
