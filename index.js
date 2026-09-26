require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const textRoutes = require('./routes/text');
const dictionaryRoutes = require('./routes/dictionary');
const userRoutes = require('./routes/user');
const adminRoutes = require('./routes/admin');
const dailyRoutes = require('./routes/daily');
const notificationsRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Frontend için güvenli Firebase Config Rotası
app.get('/api/config/firebase', (req, res) => {
  res.json({
    apiKey: process.env.apiKey || process.env.FIREBASE_API_KEY,
    authDomain: process.env.authDomain,
    projectId: process.env.projectId,
    storageBucket: process.env.storageBucket,
    messagingSenderId: process.env.messagingSenderId,
    appId: process.env.appId,
    measurementId: process.env.measurementId
  });
});

// Basic health check route
app.get('/health', (req, res) => {
  res.json({ success: true, status: 'Server is running', time: new Date() });
});

// Routes
app.use('/api/text', textRoutes);
app.use('/api/dictionary', dictionaryRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/daily', dailyRoutes);
app.use('/api/notifications', notificationsRoutes);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Sunucuda beklenmeyen bir hata oluştu!' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Export the Express API
module.exports = app;
