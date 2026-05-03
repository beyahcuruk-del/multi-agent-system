/**
 * Vercel Serverless Function Entry Point
 * Wraps the Express app for serverless deployment.
 */

require('dotenv').config();

const express = require('express');
const MiMoClient = require('../services/mimoClient');
const createRoutes = require('../routes/taskRoutes');

const apiKey = process.env.MIMO_API_KEY;
const baseUrl = process.env.MIMO_BASE_URL || 'https://token-plan-sgp.xiaomimimo.com/v1';

const mimoClient = new MiMoClient({ apiKey, baseUrl });
const app = express();

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use('/', createRoutes(mimoClient));

app.use((req, res) => {
  res.status(404).json({ error: `Unknown route: ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
