/* Meta Pixel. Loaded only when a Pixel ID is set in /admin (Business details).
   Events: PageView (every page), Lead (estimate shown), Schedule (Book This Date), Contact (tap to call/text). */
(function () {
  'use strict';
  var me = document.currentScript;
  var id = me && me.getAttribute('data-pixel-id');
  if (!id || !/^\d{5,20}$/.test(id)) return;

  // Meta's standard loader, written as a file because the site's security policy blocks inline scripts.
  (function (f, b, e, v) {
    if (f.fbq) return;
    var n = f.fbq = function () { if (n.callMethod) n.callMethod.apply(n, arguments); else n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    var t = b.createElement(e); t.async = true; t.src = v;
    var s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  window.fbq('init', id);
  window.fbq('track', 'PageView');

  // Used by the estimate forms. Never sends names, phone numbers, emails, or addresses.
  window.saeTrack = function (event, params) {
    try { window.fbq('track', event, params || {}); } catch (e) { /* ignore */ }
  };

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="tel:"], a[href^="sms:"]');
    if (a) window.saeTrack('Contact', { method: a.getAttribute('href').slice(0, 3) === 'tel' ? 'call' : 'text' });
  });
})();
