'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');
const { createDistanceService } = require('../lib/distance');
const { defaultSettings } = require('../lib/defaults');

// Monday 2026-12-07, 12:00 noon in Dallas (CST = UTC-6).
const FIXED_NOW = new Date('2026-12-07T18:00:00Z');

// Fake driving distances (miles) keyed by a word in the address.
const STUB = {
  carrollton: { miles: 3.2, city: 'Carrollton' },
  addison: { miles: 6.1, city: 'Addison' },
  nine: { miles: 9.4, city: 'Farmers Branch' },
  tenish: { miles: 9.6, city: 'Farmers Branch' },
  plano: { miles: 14.8, city: 'Plano' },
  irving: { miles: 16.2, city: 'Irving' },
  garland: { miles: 20.4, city: 'Garland' },
  justover: { miles: 20.6, city: 'Lewisville' },
  denton: { miles: 24.9, city: 'Denton' },
  fortworth: { miles: 38.0, city: 'Fort Worth' },
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sae-test-'));
}

/** Owner's real rates plus test values for the two amounts still TODO (long carry, tree price). */
function pricedSettings() {
  const s = defaultSettings();
  s.rates.junk.extras.longCarry.price = { min: 30, max: 30, plus: false };
  s.rates.trees.treePrice = { small: { min: 60, max: 60, plus: false }, medium: { min: 80, max: 80, plus: false }, large: { min: 100, max: 100, plus: false } };
  return s;
}

async function startServer({ settings, ai = null, sms = null, now = () => FIXED_NOW, adminPassword = 'test-pass' } = {}) {
  const dataDir = tmpDir();
  if (settings) fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(settings));
  const app = createApp({
    dataDir, ai, sms, now, adminPassword,
    distance: createDistanceService({ provider: 'stub', stubTable: STUB }),
    log: { error: () => {} },
    estimateRateLimit: 1000,
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = `Basic ${Buffer.from(`admin:${adminPassword}`).toString('base64')}`;
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text };
  };
  return {
    base, dataDir, server,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    admin: (method, p, b) => call(method, p, b, { Authorization: auth }),
    close: () => new Promise((r) => server.close(r)),
  };
}

const contact = { name: 'Test Customer', phone: '(214) 555-0100', email: '' };

module.exports = { FIXED_NOW, STUB, startServer, pricedSettings, contact, tmpDir };
