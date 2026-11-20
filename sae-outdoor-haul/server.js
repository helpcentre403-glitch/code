'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const { createStore } = require('./lib/store');
const { createApi } = require('./lib/api');
const { DISCLAIMER, pageTokens, renderTemplate, validateSettings } = require('./lib/pages');
const { createDistanceService } = require('./lib/distance');
const { createAi } = require('./lib/ai');
const { createSms } = require('./lib/sms');
const { createMailer } = require('./lib/mailer');
const { createAddressSuggester } = require('./lib/address');
const { defaultSettings } = require('./lib/defaults');

const VIEWS = path.join(__dirname, 'views');
const readView = (f) => fs.readFileSync(path.join(VIEWS, f), 'utf8');
const render = (name, settings) => renderTemplate(readView, name, settings);

function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) return res.status(429).json({ status: 'error', message: 'Too many requests. Please wait a few minutes, or call or text us.' });
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10000) hits.clear();
    return next();
  };
}

function createApp(opts = {}) {
  const log = opts.log || console;
  const store = opts.store || createStore(opts.dataDir || path.join(__dirname, 'data'));
  const distance = opts.distance || createDistanceService({
    provider: process.env.DISTANCE_PROVIDER || undefined,
    googleKey: process.env.GOOGLE_MAPS_API_KEY,
    stubTable: process.env.DISTANCE_STUB ? JSON.parse(process.env.DISTANCE_STUB) : undefined,
    log,
  });
  const ai = opts.ai !== undefined ? opts.ai : createAi({ apiKey: process.env.ANTHROPIC_API_KEY });
  const sms = opts.sms !== undefined ? opts.sms : createSms({
    accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM,
  });
  const adminPassword = opts.adminPassword !== undefined ? opts.adminPassword : process.env.ADMIN_PASSWORD;
  const now = opts.now || (() => new Date());

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      // Meta Pixel needs its script host and its reporting host.
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://www.facebook.com; style-src 'self'; script-src 'self' https://connect.facebook.net; connect-src 'self' https://www.facebook.com https://connect.facebook.net; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '50kb' }));
  app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

  const mailer = opts.mailer !== undefined ? opts.mailer : createMailer(process.env);
  const api = createApi({
    store, distance, ai, sms, mailer, now, log, defaults: defaultSettings,
    notifyPhone: process.env.OWNER_NOTIFY_PHONE || null, notifyEmail: process.env.OWNER_NOTIFY_EMAIL || null, textEmail: process.env.OWNER_TEXT_EMAIL || null,
  });
  const send = (res, r) => res.status(r.status).json(r.json);

  // ---------- Admin auth (HTTP Basic, user "admin") ----------
  const failedLogins = new Map(); // ip -> [timestamps]
  function requireAdmin(req, res, next) {
    if (!adminPassword) return res.status(503).send('Admin is disabled. Set the ADMIN_PASSWORD environment variable.');
    const t = Date.now();
    const fails = (failedLogins.get(req.ip) || []).filter((x) => t - x < 15 * 60 * 1000);
    if (fails.length >= 10) return res.status(429).send('Too many failed logins. Try again in 15 minutes.');
    const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
    const [user, ...rest] = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':') : [];
    const pass = rest.join(':');
    const a = crypto.createHash('sha256').update(String(pass)).digest();
    const b = crypto.createHash('sha256').update(String(adminPassword)).digest();
    if (user === 'admin' && crypto.timingSafeEqual(a, b)) return next();
    if (req.headers.authorization) { fails.push(t); failedLogins.set(req.ip, fails); }
    res.set('WWW-Authenticate', 'Basic realm="Admin", charset="UTF-8"');
    return res.status(401).send('Login required');
  }

  // ---------- Pages ----------
  const page = (name) => (req, res) => res.type('html').send(render(name, store.getSettings()));
  app.get('/', page('index'));
  app.get('/prices', page('prices'));
  app.get('/thank-you', page('thank-you'));
  app.get('/privacy', page('privacy'));
  app.get('/terms', page('terms'));
  app.get('/admin', requireAdmin, (req, res) => { res.set('Cache-Control', 'no-store'); page('admin')(req, res); });

  // ---------- Public API ----------
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  app.get('/api/config', (req, res) => send(res, api.config()));
  app.get('/api/availability', noStore, (req, res) => send(res, api.availability()));
  const addresses = opts.addressSuggester || createAddressSuggester({ googleKey: process.env.GOOGLE_MAPS_API_KEY, log });
  app.get('/api/address-suggest', rateLimiter({ windowMs: 10 * 60 * 1000, max: 300 }), async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(addresses.lookup ? await addresses.lookup(req.query.q) : { provider: addresses.provider, suggestions: await addresses.suggest(req.query.q) });
    } catch (e) { next(e); }
  });
  app.post('/api/estimate', rateLimiter({ windowMs: 15 * 60 * 1000, max: opts.estimateRateLimit || 40 }), async (req, res, next) => {
    try { send(res, await api.estimate(req.body)); } catch (e) { next(e); }
  });
  app.post('/api/leads/:id/text', async (req, res, next) => {
    try { send(res, await api.textQuote(req.params.id)); } catch (e) { next(e); }
  });
  app.post('/api/leads/:id/book', async (req, res, next) => {
    try { send(res, await api.book(req.params.id)); } catch (e) { next(e); }
  });

  // ---------- Admin API ----------
  app.use('/api/admin', requireAdmin, noStore);
  app.get('/api/admin/settings', (req, res) => send(res, api.getSettings()));
  app.put('/api/admin/settings', (req, res) => send(res, api.putSettings(req.body)));
  app.get('/api/admin/defaults', (req, res) => send(res, api.defaults()));
  app.get('/api/admin/calendar', (req, res) => send(res, api.calendar(req.query)));
  app.post('/api/admin/calendar', (req, res) => send(res, api.calendarAction(req.body)));
  app.get('/api/admin/leads', (req, res) => send(res, api.leads()));
  app.post('/api/admin/test-email', async (req, res, next) => {
    try { send(res, await api.testEmail()); } catch (e) { next(e); }
  });
  app.patch('/api/admin/leads/:id', (req, res) => send(res, api.patchLead(req.params.id, req.body)));

  app.use((err, req, res, _next) => {
    log.error(err);
    if (err.type === 'entity.parse.failed') return res.status(400).json({ status: 'error', message: 'Bad request.' });
    return res.status(500).json({ status: 'error', message: 'Something went wrong. Please call or text us.' });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const app = createApp({ dataDir: process.env.DATA_DIR || undefined });
  app.listen(port, () => console.log(`SAE Outdoor and Haul site running on http://localhost:${port}`));
}

module.exports = { createApp, validateSettings, pageTokens, DISCLAIMER };
