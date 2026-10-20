// MongoDB connection via Mongoose.
// Throws on failure so the process exits loudly instead of running half-alive.
const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
  }

  await mongoose.connect(uri);
  console.log('MongoDB connected:', mongoose.connection.host);
};

module.exports = connectDB;
