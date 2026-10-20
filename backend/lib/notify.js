// Notification creation + socket emit helper. Socket instance is registered
// by server.js via setIo(); in tests / CLI contexts it simply no-ops the emit.
const Notification = require('../models/Notification');

let ioInstance = null;

const setIo = (io) => {
  ioInstance = io;
};
const getIo = () => ioInstance;

const createNotification = async ({ user, type, message, analysisId = null }) => {
  const notification = await Notification.create({ user, type, message, analysisId });
  if (ioInstance) {
    try {
      ioInstance.to(`user:${user.toString()}`).emit('notification', {
        id: notification._id,
        type: notification.type,
        message: notification.message,
        analysisId: notification.analysisId,
        read: notification.read,
        createdAt: notification.createdAt,
      });
    } catch (e) {
      // Socket emit must never break the REST flow.
      console.error('Socket emit failed:', e.message);
    }
  }
  return notification;
};

module.exports = { setIo, getIo, createNotification };
