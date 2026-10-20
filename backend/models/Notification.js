const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['analysis_completed', 'reminder_due', 'review_update'],
      required: true,
    },
    message: { type: String, required: true },
    analysisId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AnalysisHistory',
      default: null,
    },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
