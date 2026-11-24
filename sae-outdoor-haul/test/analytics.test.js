'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAnalytics, classifySource } = require('../lib/analytics');

const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120';
const PHONE = 'Mozilla/5.0 (iPhone) Safari/604.1';
const NOW = new Date('2026-11-24T18:00:00Z');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'an-')); }

test('classifySource: utm first, then referrer, internal moves ignored', () => {
  const own = 'saeoutdoor.example';
  assert.equal(classifySource({ utm: 'facebook', referrer: '', ownHost: own }), 'Facebook');
  assert.equal(classifySource({ utm: 'ig', referrer: '', ownHost: own }), 'Instagram');
  assert.equal(classifySource({ referrer: 'https://l.facebook.com/l.php?u=x', ownHost: own }), 'Facebook');
  assert.equal(classifySource({ referrer: 'https://www.instagram.com/', ownHost: own }), 'Instagram');
  assert.equal(classifySource({ referrer: 'https://www.google.com/', ownHost: own }), 'Google');
  assert.equal(classifySource({ referrer: '', ownHost: own }), 'Direct');
  assert.equal(classifySource({ referrer: 'https://saeoutdoor.example/prices', ownHost: own }), null);
});

test('recordView counts views and unique visitors per day; bots are skipped', () => {
  const a = createAnalytics({ dataDir: tmp(), now: () => NOW });
  const hit = (ua, extra = {}) => a.recordView({ path: '/', ip: '1.2.3.4', userAgent: ua, referrer: '', ownHost: 'x.test', ...extra });
  hit(DESKTOP);
  hit(DESKTOP);
  hit(PHONE);
  hit('Mozilla/5.0 (compatible; facebookexternalhit/1.1)');
  hit(DESKTOP, { path: '/admin' });
  const s = a.summary({ days: 7 });
  assert.equal(s.today.views, 3);
  assert.equal(s.today.visitors, 2);
  assert.equal(s.sources[0].name, 'Direct');
  assert.equal(s.pages[0].name, '/');
});

test('active now counts visitors seen in the last 3 minutes; heartbeat marks presence', () => {
  let t = NOW;
  const a = createAnalytics({ dataDir: tmp(), now: () => t });
  a.heartbeat({ path: '/prices', ip: '5.5.5.5', userAgent: PHONE });
  assert.equal(a.summary().activeNow, 1);
  t = new Date(NOW.getTime() + 4 * 60 * 1000);
  assert.equal(a.summary().activeNow, 0);
});

test('stored data has no IP addresses or full user agents', () => {
  const dir = tmp();
  const a = createAnalytics({ dataDir: dir, now: () => NOW });
  a.recordView({ path: '/', ip: '9.9.9.9', userAgent: DESKTOP, referrer: '', ownHost: 'x.test' });
  const raw = fs.readFileSync(path.join(dir, 'analytics.json'), 'utf8');
  assert.ok(!raw.includes('9.9.9.9'));
  assert.ok(!raw.includes('Chrome/120'));
});

test('a 30-day window reports sources and daily totals', () => {
  const a = createAnalytics({ dataDir: tmp(), now: () => NOW });
  a.recordView({ path: '/prices', query: { utm_source: 'facebook' }, ip: '1', userAgent: DESKTOP, ownHost: 'x.test' });
  const s = a.summary({ days: 30 });
  assert.equal(s.daily.length, 30);
  assert.equal(s.sources[0].name, 'Facebook');
  assert.equal(s.range.views, 1);
});
