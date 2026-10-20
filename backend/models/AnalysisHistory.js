// Stored record of one ML analysis run for a user.
// "predictions" is the raw per-class probability list returned by the ML service
// (stored as plain JSON, never fabricated here).
const mongoose = require('mongoose');

const analysisHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    topClass: {
      type: String,
      required: true,
      trim: true,
    },
    predictions: {
      type: [mongoose.Schema.Types.Mixed],
      required: true,
      default: [],
    },
    riskTier: {
      type: String,
      required: true,
      enum: ['low', 'medium', 'high', 'unknown'],
      default: 'unknown',
    },
    imageUrl: { type: String, default: null },
    gradcamUrl: { type: String, default: null },
    quality: { type: mongoose.Schema.Types.Mixed, default: null },
    lesionCoverage: { type: Number, default: null },
    modelUsed: {
      type: String,
      enum: ['mobilenet', 'efficientnet', 'both', 'ensemble'],
      default: 'mobilenet',
    },
    altPredictions: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    altTopClass: { type: String, default: null },
    feedback: {
      type: String,
      enum: ['right', 'wrong', null],
      default: null,
    },
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      default: null,
    },
    spotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BodySpot',
      default: null,
    },
    shareToken: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },
    // v2.1 extras: ML uncertainty / OOD / ensemble detail blob
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    segUrl: { type: String, default: null },
    intake: { type: mongoose.Schema.Types.Mixed, default: null },
    reviewStatus: {
      type: String,
      enum: ['none', 'requested', 'reviewed'],
      default: 'none',
    },
    reviewComment: { type: String, default: null },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true } // gives createdAt / updatedAt
);

module.exports = mongoose.model('AnalysisHistory', analysisHistorySchema);
