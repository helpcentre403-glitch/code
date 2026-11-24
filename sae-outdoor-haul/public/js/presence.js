/* "Active now" heartbeat for the admin analytics panel. Sends only the page path, every 30 seconds while the tab is visible. */
(function () {
  'use strict';
  var path = location.pathname;
  function beat() {
    if (document.visibilityState !== 'visible') return;
    try {
      var body = JSON.stringify({ path: path });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/heartbeat', new Blob([body], { type: 'application/json' }));
      else fetch('/api/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (e) { /* ignore */ }
  }
  beat();
  setInterval(beat, 30000);
})();
