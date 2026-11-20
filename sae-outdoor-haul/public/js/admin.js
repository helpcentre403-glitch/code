/* Owner admin panel. Edits one settings object (rates, hours, business) and the calendar. */
(function () {
  'use strict';
  var S = null; // working copy of settings
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var statusEl = document.querySelector('[data-status]');

  function say(msg, bad) { statusEl.textContent = msg; statusEl.className = 'admin-status' + (bad ? ' bad' : ' good'); }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); });
  }
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'checked' || k === 'disabled') n[k] = !!attrs[k];
      else if (k === 'value') n.value = attrs[k] == null ? '' : attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function num(v) { return v === '' || v == null ? null : Number(v); }

  // ---------- Leads ----------
  var LABELS = { junk: 'Junk Removal', landscaping: 'Landscaping', trees: 'Christmas Trees' };
  function loadLeads() {
    return api('GET', '/api/admin/leads').then(function (r) {
      var host = document.querySelector('[data-leads]');
      host.innerHTML = '';
      if (!r.leads.length) { host.appendChild(h('p', { class: 'hint', text: 'No leads yet.' })); return; }
      r.leads.forEach(function (l) {
        var total = l.estimate ? fmt(l.estimate.total) : '-';
        var b = l.booking ? l.booking.date + ' ' + l.booking.time + ' (' + l.booking.status + ')' : '-';
        var status = h('select', { 'aria-label': 'Lead status', onchange: function () { patch(l.id, { status: status.value }); } },
          ['new', 'contacted', 'booked', 'done', 'lost', 'out_of_area', 'needs_follow_up'].map(function (s) { return h('option', { value: s, text: s }); }));
        status.value = l.status;
        var notes = h('textarea', { rows: 2, placeholder: 'Crew notes', value: l.crewNotes || '' });
        var saveNotes = h('button', { class: 'btn btn-small btn-light', type: 'button', text: 'Save notes', onclick: function () { patch(l.id, { crewNotes: notes.value }); } });
        var cancel = l.booking && l.booking.status === 'booked'
          ? h('button', { class: 'btn btn-small btn-light', type: 'button', text: 'Cancel booking (frees the slot)', onclick: function () { if (confirm('Cancel this booking?')) patch(l.id, { cancelBooking: true, status: 'contacted' }).then(loadAll); } })
          : null;
        var det = h('details', { class: 'lead' }, [
          h('summary', {}, [
            h('strong', { text: (l.contact && l.contact.name) || '(no name)' }), ' · ', LABELS[l.service] || l.service, ' · ', total, ' · ', h('span', { class: 'pill ' + l.status, text: l.status }),
          ]),
          h('dl', {}, [
            row('Created', new Date(l.createdAt).toLocaleString()),
            row('Phone', l.contact && l.contact.phone ? h('a', { href: 'tel:+1' + l.contact.phone, text: l.contact.phone }) : '-'),
            row('Text quote requested', l.textRequested ? (l.textSent ? 'Yes (sent automatically)' : 'Yes - text them by hand') : 'No'),
            row('Email', (l.contact && l.contact.email) || '-'),
            row('Address', (l.answers && l.answers.address) || '-'),
            row('Distance', l.distance ? l.distance.miles + ' mi' + (l.distance.city ? ' (' + l.distance.city + ')' : '') + (l.distance.free ? ' - free city' : '') : '-'),
            row('Date / time', b),
            row('Same-day', l.sameDay ? 'Yes' : 'No'),
            row('Summary', l.summary || '-'),
            row('AI questions', l.aiQuestions && l.aiQuestions.length ? l.aiQuestions.join(' | ') : '-'),
          ]),
          h('pre', { class: 'answers', text: JSON.stringify(l.answers, null, 2) }),
          l.estimate ? h('pre', { class: 'answers', text: breakdownText(l.estimate) }) : null,
          h('div', { class: 'inline' }, [status, cancel]),
          notes, saveNotes,
        ]);
        host.appendChild(det);
      });
    });
  }
  function row(k, v) { return h('div', {}, [h('dt', { text: k }), h('dd', {}, [typeof v === 'string' ? v : v])]); }
  function fmt(p) {
    if (!p || p.min == null) return 'TBC';
    return '$' + p.min + (p.max !== p.min ? ' to $' + p.max : '') + (p.plus ? '+' : '');
  }
  function breakdownText(e) {
    return e.sections.map(function (s) {
      return s.title + ': ' + fmt(s.subtotal) + '\n' + s.lines.map(function (l) { return '  - ' + l.label + ': ' + (l.status === 'ok' ? fmt(l.price) : l.status); }).join('\n');
    }).join('\n') + '\nTOTAL: ' + fmt(e.total);
  }
  function patch(id, body) { return api('PATCH', '/api/admin/leads/' + id, body).then(function () { say('Lead updated.'); }).catch(function (e) { say(e.message || 'Update failed', true); }); }

  // ---------- Calendar ----------
  function loadCalendar() {
    return api('GET', '/api/admin/calendar').then(function (r) {
      var host = document.querySelector('[data-admin-calendar]');
      host.innerHTML = '';
      r.days.forEach(function (d) {
        var head = h('div', { class: 'cal-head' }, [
          h('strong', { text: d.label }), d.holiday ? h('span', { class: 'pill', text: 'holiday' }) : null,
          d.special ? h('span', { class: 'pill', text: 'special hours ' + d.special.open + '-' + d.special.close }) : null,
          d.special ? h('button', { class: 'link-btn', type: 'button', text: 'clear special hours', onclick: function () { calAction('clearSpecialHours', d.date); } }) : null,
          h('button', { class: 'btn btn-small btn-light', type: 'button', text: d.blocked ? 'Unblock day' : 'Block whole day',
            onclick: function () { calAction(d.blocked ? 'unblockDate' : 'blockDate', d.date); } }),
        ]);
        var slots = h('div', { class: 'cal-slots' }, d.slots.length ? d.slots.map(function (s) {
          var clickable = s.status === 'open' || s.status === 'blocked';
          return h('button', { type: 'button', class: 'slot-status ' + s.status + (s.extra ? ' extra' : ''), disabled: !clickable,
            title: s.status + (s.extra ? ' (extra time)' : ''), text: s.label,
            'data-date': d.date, 'data-time': s.time,
            onclick: function () { calAction(s.status === 'open' ? 'blockSlot' : 'openSlot', d.date, s.time); } });
        }) : [h('span', { class: 'hint', text: 'Closed' })]);
        host.appendChild(h('div', { class: 'cal-day' + (d.blocked ? ' blocked' : '') }, [head, slots]));
      });
    });
  }
  function calAction(action, date, time) {
    return api('POST', '/api/admin/calendar', { action: action, date: date, time: time })
      .then(function () { say('Calendar updated.'); return loadAll(); })
      .catch(function (e) { say(e.message || 'Calendar update failed', true); });
  }
  document.querySelector('[data-add-extra]').addEventListener('click', function () {
    var d = document.querySelector('[data-extra-date]').value;
    var t = document.querySelector('[data-extra-time]').value;
    if (!d || !t) return say('Pick a date and a time first.', true);
    calAction('openSlot', d, t.slice(0, 5));
  });
  document.querySelector('[data-add-special]').addEventListener('click', function () {
    var d = document.querySelector('[data-special-date]').value;
    var o = document.querySelector('[data-special-open]').value.slice(0, 5);
    var c = document.querySelector('[data-special-close]').value.slice(0, 5);
    if (!d || !o || !c) return say('Pick a date, opening time, and closing time.', true);
    api('POST', '/api/admin/calendar', { action: 'setSpecialHours', date: d, open: o, close: c })
      .then(function () { say('Special hours saved.'); return loadAll(); })
      .catch(function (e) { say(e.message || 'Could not save special hours', true); });
  });
  document.querySelector('[data-add-holiday]').addEventListener('click', function () {
    var d = document.querySelector('[data-holiday-date]').value;
    if (!d) return say('Pick a date first.', true);
    calAction('addHoliday', d);
  });

  // ---------- Hours ----------
  function renderHours() {
    var host = document.querySelector('[data-hours]');
    host.innerHTML = '';
    var order = [1, 2, 3, 4, 5, 6, 0];
    order.forEach(function (d) {
      var cur = S.schedule.hours[d];
      var open = h('input', { type: 'time', value: cur ? cur.open : '17:00', 'aria-label': DAYS[d] + ' open', disabled: !cur });
      var close = h('input', { type: 'time', value: cur ? cur.close : '21:00', 'aria-label': DAYS[d] + ' close', disabled: !cur });
      var closed = h('input', { type: 'checkbox', checked: !cur });
      function sync() {
        open.disabled = close.disabled = closed.checked;
        S.schedule.hours[d] = closed.checked ? null : { open: open.value, close: close.value };
      }
      [open, close, closed].forEach(function (i) { i.addEventListener('change', sync); });
      host.appendChild(h('div', { class: 'hours-row', 'data-day': d }, [h('span', { text: DAYS[d] }), open, ' to ', close, h('label', {}, [closed, ' Closed'])]));
    });
    var hh = S.schedule.holidayHours;
    var ho = h('input', { type: 'time', value: hh.open, 'aria-label': 'Holiday open', onchange: function () { hh.open = ho.value; } });
    var hc = h('input', { type: 'time', value: hh.close, 'aria-label': 'Holiday close', onchange: function () { hh.close = hc.value; } });
    host.appendChild(h('div', { class: 'hours-row', 'data-day': 'holiday' }, [h('span', { text: 'Holidays' }), ho, ' to ', hc]));

    var list = document.querySelector('[data-holidays]');
    list.innerHTML = '';
    S.schedule.holidays.forEach(function (d) {
      list.appendChild(h('li', {}, [d + ' ', h('button', { type: 'button', class: 'link-btn', text: 'remove', onclick: function () { calAction('removeHoliday', d); } })]));
    });
    if (!S.schedule.holidays.length) list.appendChild(h('li', { class: 'todo', text: 'TODO: no holiday dates set' }));
    document.querySelectorAll('[data-sched]').forEach(function (i) {
      var k = i.getAttribute('data-sched');
      i.value = S.schedule[k];
      i.onchange = function () { S.schedule[k] = parseInt(i.value, 10); };
    });
  }

  // ---------- Rates ----------
  function priceRow(obj, labelText) {
    var p = obj.price;
    var min = h('input', { type: 'number', min: 0, step: 1, value: p.min, 'aria-label': labelText + ' low', onchange: function () { p.min = num(min.value); if (max.value === '') { p.max = p.min; max.value = p.min == null ? '' : p.min; } } });
    var max = h('input', { type: 'number', min: 0, step: 1, value: p.max, 'aria-label': labelText + ' high', onchange: function () { p.max = num(max.value); } });
    var plus = h('input', { type: 'checkbox', checked: p.plus, onchange: function () { p.plus = plus.checked; } });
    return h('div', { class: 'rate-row' + (p.min == null ? ' unset' : '') }, [h('span', { text: labelText }), min, h('span', { text: 'to' }), max, h('label', {}, [plus, '+'])]);
  }
  function group(title, obj) {
    return h('fieldset', { class: 'rate-group' }, [h('legend', { text: title })].concat(Object.keys(obj).map(function (k) { return priceRow(obj[k], obj[k].label); })));
  }
  function renderRates() {
    var r = S.rates;
    var host = document.querySelector('[data-rates]');
    host.innerHTML = '';
    var dist = h('fieldset', { class: 'rate-group' }, [h('legend', { text: 'Distance fees (driving miles from base, rounded to nearest mile)' })]);
    r.distance.bands.forEach(function (b) {
      var miles = h('input', { type: 'number', min: 0, value: b.maxMiles, 'aria-label': b.label + ' max miles', onchange: function () { b.maxMiles = Number(miles.value); } });
      var fee = h('input', { type: 'number', min: 0, value: b.fee, 'aria-label': b.label + ' fee', onchange: function () { b.fee = num(fee.value); } });
      dist.appendChild(h('div', { class: 'rate-row' + (b.fee == null ? ' unset' : '') }, [h('span', { text: b.label }), h('span', { text: 'up to' }), miles, h('span', { text: 'mi  fee $' }), fee]));
    });
    var maxMi = h('input', { type: 'number', min: 1, value: r.distance.maxServiceMiles, 'aria-label': 'Max service miles', onchange: function () { r.distance.maxServiceMiles = Number(maxMi.value); } });
    dist.appendChild(h('div', { class: 'rate-row' }, [h('span', { text: 'No online estimate over (miles)' }), maxMi]));
    dist.appendChild(h('p', { class: 'hint', text: 'Addresses in these cities pay no distance fee: ' + S.business.freeCities.join(', ') + ' (edit under Business details).' }));
    host.appendChild(dist);

    var minC = h('input', { type: 'number', min: 0, value: r.junk.minimumCharge, 'aria-label': 'Minimum service charge', onchange: function () { r.junk.minimumCharge = num(minC.value); } });
    host.appendChild(h('fieldset', { class: 'rate-group' }, [h('legend', { text: 'Junk removal' }), h('div', { class: 'rate-row' }, [h('span', { text: 'Minimum service charge per job' }), minC])]));
    host.appendChild(group('Junk: trailer loads (base price)', r.junk.loads));
    host.appendChild(group('Junk: single items (starting price)', r.junk.items));
    host.appendChild(group('Junk: cleanouts (starting price)', r.junk.cleanouts));
    host.appendChild(group('Junk: extra charges', r.junk.extras));
    host.appendChild(group('Landscaping: back yard (per visit)', r.landscaping.back));
    host.appendChild(group('Landscaping: front yard (per visit)', r.landscaping.front));
    host.appendChild(group('Landscaping: front and back (per visit)', r.landscaping.both));

    var trees = h('fieldset', { class: 'rate-group' }, [h('legend', { text: 'Christmas trees' })]);
    Object.keys(r.trees.sizes).forEach(function (size) {
      trees.appendChild(priceRow({ price: r.trees.treePrice[size] }, r.trees.sizes[size].label + ' tree price (estimate)'));
      Object.keys(r.trees.services).forEach(function (svc) {
        var f = h('input', { type: 'number', min: 0, value: r.trees.serviceFees[size][svc], 'aria-label': size + ' ' + svc + ' fee', onchange: function () { r.trees.serviceFees[size][svc] = Number(f.value); } });
        trees.appendChild(h('div', { class: 'rate-row' }, [h('span', { text: '  ' + r.trees.services[svc] + ' fee $' }), f]));
      });
    });
    host.appendChild(trees);
  }

  // ---------- Business ----------
  function renderBusiness() {
    var b = S.business; var c = S.content;
    var host = document.querySelector('[data-business]');
    host.innerHTML = '';
    function field(label, get, set, opts) {
      var i = h(opts && opts.area ? 'textarea' : 'input', { value: get(), rows: 2, onchange: function () { set(i.value); } });
      host.appendChild(h('label', { class: 'biz-field' }, [label, i]));
    }
    field('Business name', function () { return b.name; }, function (v) { b.name = v.trim(); });
    field('Phone (10 digits)', function () { return b.phone; }, function (v) { b.phone = v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); });
    field('Text line (10 digits)', function () { return b.textNumber; }, function (v) { b.textNumber = v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); });
    field('Email (blank = TODO)', function () { return b.email || ''; }, function (v) { b.email = v.trim() || null; });
    field('Base address (distances are measured from here)', function () { return b.baseAddress; }, function (v) { b.baseAddress = v.trim(); });
    field('Free-distance cities (comma separated)', function () { return b.freeCities.join(', '); }, function (v) { b.freeCities = v.split(',').map(function (x) { return x.trim(); }).filter(Boolean); });
    field('Service-area cities (comma separated)', function () { return b.serviceAreaCities.join(', '); }, function (v) { b.serviceAreaCities = v.split(',').map(function (x) { return x.trim(); }).filter(Boolean); });
    field("FAQ: What don't you take? (blank = TODO)", function () { return c.dontTake || ''; }, function (v) { c.dontTake = v.trim() || null; }, { area: true });
    field('FAQ: Do I need to be home? (blank = TODO)', function () { return c.needToBeHome || ''; }, function (v) { c.needToBeHome = v.trim() || null; }, { area: true });
    field('Holiday hours note (shown under Hours on the home page)', function () { return c.holidayNote || ''; }, function (v) { c.holidayNote = v.trim() || null; }, { area: true });
    field('FAQ: How do I pay? (blank = TODO)', function () { return c.paymentMethods || ''; }, function (v) { c.paymentMethods = v.trim() || null; }, { area: true });
  }

  function save() {
    return api('PUT', '/api/admin/settings', S)
      .then(function (r) { S = r.settings; say('Saved. The live site now uses these settings.'); renderAll(); return loadCalendar(); })
      .catch(function (e) { say((e.problems || [e.message || 'Save failed']).join(' '), true); });
  }
  document.querySelectorAll('[data-save]').forEach(function (b) { b.addEventListener('click', save); });

  function renderAll() { renderHours(); renderRates(); renderBusiness(); }
  function loadAll() {
    return api('GET', '/api/admin/settings').then(function (s) { S = s; renderAll(); return Promise.all([loadCalendar(), loadLeads()]); })
      .then(function () { document.body.setAttribute('data-ready', 'true'); })
      .catch(function () { say('Could not load admin data.', true); });
  }
  loadAll();
})();
