'use strict';
/**
 * Builds a single self-contained HTML preview of the site (all pages, real pricing and
 * calendar code) that runs entirely in the browser. Used to share a clickable preview
 * before the real server is hosted. Data entered in the preview stays in that browser.
 *
 *   node scripts/build-preview.js [output.html]
 *
 * Differences from the live site (shown in a banner on the preview):
 *  - No real driving distance: Carrollton addresses are free, other addresses use a
 *    test distance the viewer sets in the banner.
 *  - Leads, bookings, and admin edits are saved only in the viewer's browser.
 *  - Admin has no password.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const out = process.argv[2] || path.join(root, 'preview', 'sae-preview.html');

// ---- Browser-safe modules (CommonJS, bundled with a tiny loader) ----
const MODULES = ['defaults', 'calendar', 'pricing', 'distance', 'pages', 'api'];
const modSrc = MODULES.map((m) => `__def(${JSON.stringify(m)}, function (module, exports, require) {\n${read(`lib/${m}.js`)}\n});`).join('\n');

// ---- Page templates ----
const views = {};
for (const f of ['index', 'prices', 'thank-you', 'privacy', 'terms', 'admin']) views[`${f}.html`] = read(`views/${f}.html`);
for (const f of fs.readdirSync(path.join(root, 'views/partials'))) views[`partials/${f}`] = read(`views/partials/${f}`);

// Inline images as data URIs
const img = (f) => `data:image/svg+xml;base64,${Buffer.from(read(`public/img/${f}`)).toString('base64')}`;
for (const k of Object.keys(views)) {
  views[k] = views[k].replace(/\/assets\/img\/([\w-]+\.svg)/g, (_, f) => img(f));
}

// ---- Page scripts, turned into re-runnable boot functions ----
const prices = read('public/js/prices.js')
  .replace("window.location.href = '/thank-you?type=quote'", "location.hash = 'thank-you'")
  .replace("window.location.href = '/thank-you?type=booked'", "location.hash = 'thank-you'");
const admin = read('public/js/admin.js').replace("confirm('Cancel this booking?')", 'true');

const css = read('public/css/styles.css');

const html = `<title>SAE Outdoor and Haul</title>
<style>
${css}
/* ---- Preview-only additions ---- */
:root { color-scheme: light; }
body { background: var(--paper); color: var(--ink); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 30; background: var(--paper); }
.site-header { top: env(safe-area-inset-top, 0px); }
.jump { top: calc(64px + env(safe-area-inset-top, 0px)); }
.preview-bar { background: #fff8d6; color: var(--ink); border-bottom: 2px solid #e0c35c; font-size: .9rem; }
.preview-bar .wrap { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding-top: 8px; padding-bottom: 8px; }
.preview-bar strong { font-weight: 900; }
.preview-bar label { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
.preview-bar input { width: 72px !important; min-height: 36px !important; padding: 4px 8px !important; }
.preview-bar a, .preview-bar button { font-weight: 800; color: var(--accent); background: none; border: 0; padding: 4px 0; font: inherit; text-decoration: underline; cursor: pointer; }
.preview-bar details { flex-basis: 100%; }
.preview-bar summary { cursor: pointer; font-weight: 700; }
.preview-bar p { margin: 6px 0 0; }
</style>

<div class="preview-bar" role="note">
  <div class="wrap">
    <strong>Website preview</strong>
    <label for="pv-miles">Test driving distance <input id="pv-miles" type="number" min="0" max="60" step="0.5" value="12"> mi</label>
    <a href="#admin">Owner admin</a>
    <button type="button" id="pv-reset">Reset preview data</button>
    <details>
      <summary>What's different in this preview</summary>
      <p>This is a working copy of the site for review. Prices, hours, and the calendar use the real site code and your rates. The live site measures real driving distance with Google Maps. Here, the Inside/Outside of Carrollton buttons set the fee, and the test distance above stands in for the mileage (over 20 miles gets the contact-us message). On the live site, each booking also emails the owner (and texts, if a text service is added); this preview cannot send email or texts. Quotes, bookings, and admin changes are saved only in this browser. On the live site, the admin page needs your password and tap-to-call and tap-to-text open your phone app; inside this preview those links may not open.</p>
    </details>
  </div>
</div>
<div id="app"></div>

<script>
(function () {
  'use strict';
  // ---------- tiny CommonJS loader ----------
  var __defs = {}, __cache = {};
  function __def(name, fn) { __defs[name] = fn; }
  function __req(name) {
    var key = name.replace(/^\\.\\/(lib\\/)?/, '').replace(/\\.js$/, '');
    if (__cache[key]) return __cache[key].exports;
    if (!__defs[key]) return {}; // Node-only modules are never used in the preview
    var module = { exports: {} };
    __cache[key] = module;
    __defs[key](module, module.exports, __req);
    return module.exports;
  }
${modSrc}

  var defaultsMod = __req('defaults');
  var pages = __req('pages');
  var api = __req('api');
  var distanceMod = __req('distance');
  var VIEWS = ${JSON.stringify(views).replace(/</g, '\\u003c')};

  // ---------- browser store (same interface as lib/store.js) ----------
  var KEY = 'sae-site-preview-v3';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify({ settings: settings, leads: leads })); } catch (e) { /* memory only */ } }
  var saved = load();
  var settings = (saved && saved.settings) || defaultsMod.defaultSettings();
  var leads = (saved && saved.leads) || [];
  function uid() { try { return crypto.randomUUID(); } catch (e) { return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2); } }
  var store = {
    getSettings: function () { return settings; },
    saveSettings: function (next) { settings = next; persist(); return settings; },
    listLeads: function () { return leads; },
    getLead: function (id) { return leads.find(function (l) { return l.id === id; }) || null; },
    addLead: function (lead) { var full = Object.assign({ id: uid(), createdAt: new Date().toISOString(), status: 'new' }, lead); leads.push(full); persist(); return full; },
    updateLead: function (id, patch) {
      var i = leads.findIndex(function (l) { return l.id === id; });
      if (i < 0) return null;
      leads[i] = Object.assign({}, leads[i], patch, { updatedAt: new Date().toISOString() }); persist(); return leads[i];
    },
  };

  // ---------- preview distance ----------
  var milesInput = document.getElementById('pv-miles');
  var distance = {
    measure: function (origin, dest) {
      var m = Number(milesInput.value);
      if (!isFinite(m) || m < 0) m = 12;
      return Promise.resolve({ miles: m, city: null, formattedAddress: dest });
    },
  };

  var A = api.createApi({ store: store, distance: distance, log: { error: function () {} }, defaults: defaultsMod.defaultSettings });

  // ---------- fetch shim: /api/* handled in the browser ----------
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, init) {
    url = String(url);
    if (url.indexOf('/api/') !== 0) return realFetch(url, init);
    var method = ((init && init.method) || 'GET').toUpperCase();
    var body = init && init.body ? JSON.parse(init.body) : undefined;
    var p = url.split('?')[0];
    var m;
    var r;
    try {
      if (p === '/api/config') r = A.config();
      else if (p === '/api/availability') r = A.availability();
      else if (p === '/api/estimate') r = A.estimate(body);
      else if ((m = p.match(/^\\/api\\/leads\\/([^/]+)\\/text$/))) r = A.textQuote(decodeURIComponent(m[1]));
      else if ((m = p.match(/^\\/api\\/leads\\/([^/]+)\\/book$/))) r = A.book(decodeURIComponent(m[1]));
      else if (p === '/api/admin/settings') r = method === 'PUT' ? A.putSettings(body) : A.getSettings();
      else if (p === '/api/admin/calendar') r = method === 'POST' ? A.calendarAction(body) : A.calendar({});
      else if (p === '/api/admin/leads') r = A.leads();
      else if ((m = p.match(/^\\/api\\/admin\\/leads\\/([^/]+)$/))) r = A.patchLead(decodeURIComponent(m[1]), body);
      else r = { status: 404, json: { status: 'error', message: 'Not found' } };
    } catch (e) {
      r = { status: 500, json: { status: 'error', message: e.message } };
    }
    return Promise.resolve(r).then(function (res) {
      return new Response(JSON.stringify(res.json), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    });
  };

  // ---------- page scripts ----------
  function bootPrices() {
${prices}
  }
  function bootAdmin() {
${admin}
  }

  // ---------- router (#home, #prices, #thank-you, #privacy, #terms, #admin) ----------
  var ROUTES = { home: 'index', prices: 'prices', 'thank-you': 'thank-you', privacy: 'privacy', terms: 'terms', admin: 'admin' };
  var SECTION_PAGE = { services: 'home', faq: 'home', where: 'home', contact: 'home', junk: 'prices', landscaping: 'prices', trees: 'prices',
    leads: 'admin', calendar: 'admin', hours: 'admin', rates: 'admin', business: 'admin', main: null };
  var LINKS = { '/': '#home', '/prices': '#prices', '/thank-you': '#thank-you', '/privacy': '#privacy', '/terms': '#terms', '/admin': '#admin' };
  var app = document.getElementById('app');
  var current = null;

  function renderPage(route) {
    var html = pages.renderTemplate(function (f) { return VIEWS[f]; }, ROUTES[route], settings);
    var bodyTag = html.match(/<body([^>]*)>/);
    var inner = html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.lastIndexOf('</body>'));
    inner = inner.replace(/<script[\\s\\S]*?<\\/script>/g, '');
    inner = inner.replace(/href="(\\/[a-z-]*)(#[a-z-]+)?"/g, function (all, p, h) {
      if (h) return 'href="' + h + '"';
      return LINKS[p] ? 'href="' + LINKS[p] + '"' : all;
    });
    app.className = bodyTag && /class="admin"/.test(bodyTag[1]) ? 'admin' : '';
    document.body.removeAttribute('data-ready');
    app.innerHTML = inner;
    current = route;
    if (route === 'prices') bootPrices();
    if (route === 'admin') bootAdmin();
  }

  function go() {
    var h = (location.hash || '').slice(1);
    var route = ROUTES[h] ? h : (SECTION_PAGE[h] || (h === 'main' ? current : null) || 'home');
    if (route !== current || ROUTES[h]) renderPage(route);
    var target = !ROUTES[h] && h ? document.getElementById(h) : null;
    if (target) {
      var scroll = function () { target.scrollIntoView({ block: 'start' }); };
      scroll(); setTimeout(scroll, 120);
    } else if (ROUTES[h] || !h) {
      window.scrollTo(0, 0);
    }
  }
  window.addEventListener('hashchange', go);

  document.getElementById('pv-reset').addEventListener('click', function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    settings = defaultsMod.defaultSettings(); leads = [];
    current = null; go();
  });
  go();
})();
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
