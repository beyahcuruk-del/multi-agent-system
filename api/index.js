/**
 * Vercel Serverless Entry — Trading Terminal
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const MiMoClient = require('../services/mimoClient');
const createTradingRoutes = require('../routes/tradingRoutes');
const createAuthRoutes = require('../routes/auth');

const apiKey = process.env.MIMO_API_KEY;
const baseUrl = process.env.MIMO_BASE_URL || 'https://token-plan-sgp.xiaomimimo.com/v1';

if (!apiKey) console.error('MIMO_API_KEY not set');

const mimoClient = new MiMoClient({ apiKey, baseUrl });
const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/auth', createAuthRoutes());
app.use('/', createTradingRoutes(mimoClient));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
