/* Prices page: builds the three estimate forms and talks to /api. No framework. */
(function () {
  'use strict';

  var config = null;
  var availability = [];

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json().then(function (j) { j.httpStatus = r.status; return j; }); });
  }

  // ---------- Trailer picture (standard enclosed cargo trailer, side cut-away) ----------
  var FILL = { minimum: 0.1, quarter: 0.25, half: 0.5, threeQuarter: 0.75, full: 1, overFull: 1 };
  function trailerSvg(key) {
    var f = FILL[key] || 0;
    var boxX = 14, boxY = 10, boxW = 150, boxH = 62;
    var fillW = Math.round(boxW * f);
    var heap = key === 'overFull'
      ? '<path class="t-fill" d="M' + boxX + ' ' + boxY + ' Q ' + (boxX + boxW / 2) + ' -6 ' + (boxX + boxW) + ' ' + boxY + ' Z"/>' : '';
    return '<svg viewBox="0 0 200 100" class="trailer-svg" aria-hidden="true">'
      + '<rect class="t-body" x="' + boxX + '" y="' + boxY + '" width="' + boxW + '" height="' + boxH + '" rx="6"/>'
      + (fillW ? '<rect class="t-fill" x="' + boxX + '" y="' + boxY + '" width="' + fillW + '" height="' + boxH + '" rx="6"/>' : '')
      + heap
      + '<rect class="t-outline" x="' + boxX + '" y="' + boxY + '" width="' + boxW + '" height="' + boxH + '" rx="6"/>'
      + '<path class="t-hitch" d="M164 64 L192 70"/><circle class="t-ball" cx="193" cy="70" r="3"/>'
      + '<circle class="t-wheel" cx="72" cy="80" r="12"/><circle class="t-wheel" cx="104" cy="80" r="12"/>'
      + '<circle class="t-hub" cx="72" cy="80" r="4"/><circle class="t-hub" cx="104" cy="80" r="4"/>'
      + '</svg>';
  }

  // ---------- Shared: calendar + address + contact + submit ----------
  function buildCommon(form) {
    var host = form.querySelector('[data-common]');
    var n = Number(host.getAttribute('data-step-start'));
    var id = form.getAttribute('data-service');
    host.innerHTML = ''
      + '<fieldset class="step"><legend><span class="num">' + n + '</span> When?</legend>'
      + '<p class="hint">Only open dates and times are shown.</p>'
      + '<div class="calendar" data-calendar></div>'
      + '<input type="hidden" name="date"><input type="hidden" name="time">'
      + '<p class="field-error" data-error="date"></p></fieldset>'
      + '<fieldset class="step"><legend><span class="num">' + (n + 1) + '</span> Address</legend>'
      + '<label class="label" for="' + id + '-address">Service address (street, city, ZIP)</label>'
      + '<div class="addr-wrap">'
      + '<input id="' + id + '-address" name="address" autocomplete="street-address" maxlength="300" placeholder="Start typing your street address" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + '-addr-list">'
      + '<ul class="addr-list" id="' + id + '-addr-list" role="listbox" hidden></ul>'
      + '</div>'
      + '<p class="field-error" data-error="address"></p>'
      + '<p class="label">Is this address inside or outside ' + config.freeCity + '?</p>'
      + '<div class="chip-group zone-group" role="radiogroup" aria-label="Inside or outside ' + config.freeCity + '">'
      + '<label class="chip"><input type="radio" name="cityZone" value="inside"><span>Inside of ' + config.freeCity + ' <small>no distance fee</small></span></label>'
      + '<label class="chip"><input type="radio" name="cityZone" value="outside"><span>Outside of ' + config.freeCity + ' <small>' + (config.outsideFee ? config.outsideFee + ' distance fee' : 'distance fee') + '</small></span></label>'
      + '</div>'
      + '<p class="hint">We serve up to ' + config.maxServiceMiles + ' driving miles away and check the address on the map.</p>'
      + '<p class="field-error" data-error="cityZone"></p></fieldset>'
      + '<fieldset class="step"><legend><span class="num">' + (n + 2) + '</span> Your contact info</legend>'
      + '<label class="label" for="' + id + '-name">Full name <span class="req">Required</span></label>'
      + '<input id="' + id + '-name" name="name" autocomplete="name" maxlength="100" required aria-required="true" placeholder="First and last name">'
      + '<p class="field-error" data-error="contact.name"></p>'
      + '<label class="label" for="' + id + '-phone">Mobile phone <span class="opt">Optional</span></label>'
      + '<input id="' + id + '-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20">'
      + '<p class="field-error" data-error="contact.phone"></p>'
      + '<label class="consent" for="' + id + '-sms"><input id="' + id + '-sms" type="checkbox" name="smsConsent">'
      + '<span>Text me my booking confirmation, estimate receipt, and appointment updates from ' + config.business.name + '. '
      + 'Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. Not required to book. '
      + 'See our <a href="/privacy" target="_blank">Privacy Policy</a> and <a href="/terms#sms" target="_blank">Terms of Service</a>.</span></label>'
      + '<label class="label" for="' + id + '-email">Email <span class="req">Required</span></label>'
      + '<p class="hint">We email your booking confirmation and estimate to this address.</p>'
      + '<input id="' + id + '-email" name="email" type="email" autocomplete="email" maxlength="200" required aria-required="true" placeholder="you@example.com">'
      + '<p class="field-error" data-error="contact.email"></p></fieldset>'
      + '<button type="submit" class="btn btn-accent btn-big btn-block" data-submit>Generate Estimate</button>'
      + '<p class="hint center" data-submit-hint></p>';
    renderCalendar(form);
    wireAddress(form);
  }

  // Address suggestions while typing. Picking one fills a clean address and the Inside/Outside choice.
  var squeeze = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/([a-z])\1+/g, '$1').trim(); };
  function wireAddress(form) {
    var input = form.querySelector('input[name="address"]');
    var list = form.querySelector('.addr-list');
    var timer = null; var lastQ = ''; var items = []; var active = -1;
    function close() { list.hidden = true; list.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); active = -1; }
    function choose(s) {
      input.value = s.label;
      close();
      if (s.city && config.freeCity) {
        var inside = squeeze(s.city) === squeeze(config.freeCity);
        var radio = form.querySelector('input[name="cityZone"][value="' + (inside ? 'inside' : 'outside') + '"]');
        if (radio) radio.checked = true;
      }
    }
    function highlight(i) {
      active = i;
      list.querySelectorAll('li').forEach(function (li, k) { li.setAttribute('aria-selected', String(k === i)); });
    }
    function show(provider, suggestions) {
      items = suggestions; list.innerHTML = ''; active = -1;
      if (!suggestions.length) { close(); return; }
      suggestions.forEach(function (s, i) {
        var li = el('li', { role: 'option', id: input.id + '-opt-' + i, 'aria-selected': 'false', text: s.label });
        li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(s); });
        list.appendChild(li);
      });
      list.appendChild(el('li', { class: 'addr-credit', 'aria-hidden': 'true', text: provider === 'google' ? 'Powered by Google' : 'Map data \u00a9 OpenStreetMap contributors' }));
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 4) { close(); return; }
      timer = setTimeout(function () {
        lastQ = q;
        api('/api/address-suggest?q=' + encodeURIComponent(q)).then(function (r) {
          if (q !== lastQ || input.value.trim() !== q) return; // a newer search is on its way
          show(r.provider, r.suggestions || []);
        }).catch(close);
      }, 300);
    });
    input.addEventListener('keydown', function (e) {
      if (list.hidden || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
      else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
  }

  // Sideways-scrolling date row; the first open date is picked automatically so its times show right away.
  function renderCalendar(form) {
    var host = form.querySelector('[data-calendar]');
    var dateInput = form.querySelector('input[name="date"]');
    var timeInput = form.querySelector('input[name="time"]');
    var isJunk = form.getAttribute('data-service') === 'junk';
    host.innerHTML = '';
    dateInput.value = ''; timeInput.value = '';
    if (!availability.length) {
      host.appendChild(el('p', { class: 'alert', text: 'No open times right now. Please call or text us.' }));
      return;
    }
    var dates = el('div', { class: 'date-strip', role: 'radiogroup', 'aria-label': 'Date' });
    var dayTitle = el('p', { class: 'day-title' });
    var slots = el('div', { class: 'slot-grid', role: 'radiogroup', 'aria-label': 'Time' });
    var chosen = el('p', { class: 'chosen-slot', 'aria-live': 'polite' });
    availability.forEach(function (d) {
      var b = el('button', { type: 'button', class: 'date-chip' + (d.full ? ' full' : ''), 'data-date': d.date, role: 'radio', 'aria-checked': 'false', 'aria-disabled': d.full ? 'true' : 'false' }, [
        el('span', { class: 'dow', text: d.isToday ? 'Today' : d.label.split(',')[0] }),
        el('span', { class: 'dm', text: d.label.split(', ')[1] || d.label }),
        el('span', { class: 'count', text: d.full ? 'Full' : d.slots.length + (d.slots.length === 1 ? ' time' : ' times') }),
      ]);
      b.addEventListener('click', function () { pickDate(d); });
      dates.appendChild(b);
    });
    function pickDate(d) {
      if (dateInput.value !== d.date) { timeInput.value = ''; chosen.textContent = ''; }
      dateInput.value = d.date;
      dates.querySelectorAll('.date-chip').forEach(function (c) { c.setAttribute('aria-checked', String(c.getAttribute('data-date') === d.date)); });
      dayTitle.textContent = d.full ? d.label + ' is fully booked. Please pick another day.' : 'Open times on ' + d.label + ':';
      slots.innerHTML = '';
      // Open and booked times together, in time order; booked ones are scratched out and can't be picked.
      var all = d.slots.map(function (s) { return { time: s.time, label: s.label, booked: false }; })
        .concat((d.booked || []).map(function (s) { return { time: s.time, label: s.label, booked: true }; }))
        .sort(function (x, y) { return x.time < y.time ? -1 : 1; });
      all.forEach(function (s) {
        if (s.booked) {
          slots.appendChild(el('button', { type: 'button', class: 'slot taken', disabled: true, 'data-time': s.time, 'aria-label': s.label + ', booked' }, [
            el('s', { text: s.label }), el('small', { text: 'Booked' }),
          ]));
          return;
        }
        var sb = el('button', { type: 'button', class: 'slot', role: 'radio', 'aria-checked': 'false', 'data-time': s.time, text: s.label });
        sb.addEventListener('click', function () {
          dateInput.value = d.date; timeInput.value = s.time;
          slots.querySelectorAll('.slot').forEach(function (x) { x.setAttribute('aria-checked', String(x === sb)); });
          chosen.textContent = 'Selected: ' + d.label + ' at ' + s.label;
        });
        slots.appendChild(sb);
      });
      if (d.isToday && isJunk) slots.appendChild(el('p', { class: 'hint full', text: 'Same-day service adds ' + config.junk.extras.sameDay + (config.junk.extras.sameDayWas ? ' (was ' + config.junk.extras.sameDayWas + ')' : '') + '.' }));
    }
    host.appendChild(el('p', { class: 'hint', text: 'Swipe for more dates, then tap a time.' }));
    host.appendChild(dates);
    host.appendChild(dayTitle);
    host.appendChild(slots);
    host.appendChild(chosen);
    pickDate(availability.filter(function (d) { return !d.full; })[0] || availability[0]);
  }

  // ---------- Junk ----------
  function buildJunk(form) {
    var j = config.junk;
    var loads = form.querySelector('[data-loads]');
    j.loads.forEach(function (l) {
      var lab = el('label', { class: 'trailer-opt' }, [
        el('input', { type: 'radio', name: 'load', value: l.key }),
        el('span', { class: 'trailer-card', html: trailerSvg(l.key) + '<strong></strong><small></small>' }),
      ]);
      lab.querySelector('strong').textContent = l.label;
      lab.querySelector('small').textContent = l.price;
      loads.appendChild(lab);
    });
    var clear = el('button', { type: 'button', class: 'link-btn', text: 'Clear load choice' });
    clear.addEventListener('click', function () { form.querySelectorAll('input[name="load"]').forEach(function (i) { i.checked = false; }); });
    loads.after(clear);

    form.querySelectorAll('[data-price]').forEach(function (s) {
      var v = j.extras[s.getAttribute('data-price')];
      s.textContent = v === 'To be confirmed' ? '(fee to be confirmed)' : '(adds ' + v + ')';
    });

    var grid = form.querySelector('[data-items]');
    j.items.forEach(function (it) {
      var qty = el('output', { class: 'qty', text: '0', 'data-item': it.key, 'aria-live': 'polite' });
      var minus = el('button', { type: 'button', class: 'step-btn', 'aria-label': 'Remove one ' + it.label, text: '-' });
      var plus = el('button', { type: 'button', class: 'step-btn', 'aria-label': 'Add one ' + it.label, text: '+' });
      function set(v) { qty.textContent = String(Math.max(0, Math.min(20, v))); row.classList.toggle('on', qty.textContent !== '0'); }
      minus.addEventListener('click', function () { set(Number(qty.textContent) - 1); });
      plus.addEventListener('click', function () { set(Number(qty.textContent) + 1); });
      var row = el('div', { class: 'item-row' }, [
        el('div', { class: 'item-name' }, [el('strong', { text: it.label }), el('small', { text: 'from ' + it.price })]),
        el('div', { class: 'stepper' }, [minus, qty, plus]),
      ]);
      grid.appendChild(row);
    });

    var co = form.querySelector('[data-cleanouts]');
    co.appendChild(el('label', { class: 'chip' }, [el('input', { type: 'radio', name: 'cleanout', value: '', checked: true }), el('span', { text: 'None' })]));
    j.cleanouts.forEach(function (c) {
      co.appendChild(el('label', { class: 'chip' }, [
        el('input', { type: 'radio', name: 'cleanout', value: c.key }),
        el('span', {}, [c.label + ' ', el('small', { text: 'from ' + c.price })]),
      ]));
    });
  }
  function junkAnswers(form) {
    var g = function (n) { return form.querySelector('[name="' + n + '"]'); };
    var checked = form.querySelector('input[name="load"]:checked');
    var co = form.querySelector('input[name="cleanout"]:checked');
    return {
      whatToGo: g('whatToGo').value,
      load: checked ? checked.value : null,
      locations: Array.prototype.map.call(form.querySelectorAll('input[name="locations"]:checked'), function (i) { return i.value; }),
      special: g('special').value,
      heavyLifting: g('heavyLifting').checked,
      disassembly: g('disassembly').checked,
      items: Array.prototype.map.call(form.querySelectorAll('[data-item]'), function (o) { return { key: o.getAttribute('data-item'), qty: Number(o.textContent) }; })
        .filter(function (x) { return x.qty > 0; }),
      cleanout: co && co.value ? co.value : null,
    };
  }

  // ---------- Landscaping ----------
  function buildLandscaping(form) {
    var host = form.querySelector('[data-sizes]');
    form.querySelectorAll('input[name="area"]').forEach(function (r) {
      r.addEventListener('change', function () {
        host.innerHTML = '';
        config.landscaping[r.value].forEach(function (s) {
          var size = s.key;
          host.appendChild(el('label', { class: 'size-opt' }, [
            el('input', { type: 'radio', name: 'size', value: size }),
            el('span', {}, [el('strong', { text: s.label }), el('em', { text: s.price + ' per visit' })]),
          ]));
        });
      });
    });
  }
  function landscapingAnswers(form) {
    var a = form.querySelector('input[name="area"]:checked');
    var s = form.querySelector('input[name="size"]:checked');
    return { area: a ? a.value : '', size: s ? s.value : '' };
  }

  // ---------- Trees ----------
  function buildTrees(form) {
    var t = config.trees;
    var slider = form.querySelector('[data-tree-slider]');
    var out = form.querySelector('[data-tree-count]');
    var list = form.querySelector('[data-tree-list]');
    slider.max = String(t.maxTrees);
    var same = t.sizes.every(function (s) { return t.treePrice[s.key] === t.treePrice[t.sizes[0].key]; });
    var prices = same ? t.treePrice[t.sizes[0].key] + ' per tree, any size'
      : t.sizes.map(function (s) { return s.label + ': ' + t.treePrice[s.key]; }).join(' · ');
    form.querySelector('[data-tree-price-note]').textContent = 'Estimated tree price: ' + prices + '. We\'ll let you know exactly how much your tree costs before we bring it.';
    function sync() {
      var n = Number(slider.value);
      out.textContent = String(n);
      slider.setAttribute('aria-valuetext', n + (n === 1 ? ' tree' : ' trees'));
      // Keep existing choices when the count changes.
      var existing = list.querySelectorAll('.tree-card');
      if (n === 0) list.innerHTML = '<p class="hint">Drag the slider to choose how many trees.</p>';
      else {
        if (!existing.length) list.innerHTML = '';
        for (var i = list.querySelectorAll('.tree-card').length; i < n; i += 1) list.appendChild(treeCard(i));
        var cards = list.querySelectorAll('.tree-card');
        for (var k = cards.length - 1; k >= n; k -= 1) cards[k].remove();
      }
      var btn = form.querySelector('[data-submit]');
      var hint = form.querySelector('[data-submit-hint]');
      if (btn) { btn.disabled = n === 0; hint.textContent = n === 0 ? 'Choose at least 1 tree to get an estimate.' : ''; }
    }
    function treeCard(i) {
      var card = el('div', { class: 'tree-card' }, [el('h4', { text: 'Tree ' + (i + 1) })]);
      var sizes = el('div', { class: 'chip-group', role: 'radiogroup', 'aria-label': 'Tree ' + (i + 1) + ' size' });
      t.sizes.forEach(function (s) {
        sizes.appendChild(el('label', { class: 'chip' }, [el('input', { type: 'radio', name: 'tree' + i + 'size', value: s.key }), el('span', { text: s.label })]));
      });
      var svcs = el('div', { class: 'chip-group', role: 'radiogroup', 'aria-label': 'Tree ' + (i + 1) + ' service' });
      t.services.forEach(function (s) {
        svcs.appendChild(el('label', { class: 'chip' }, [el('input', { type: 'radio', name: 'tree' + i + 'service', value: s.key }), el('span', { text: s.label })]));
      });
      var fee = el('p', { class: 'hint', 'data-fee': i });
      function updateFee() {
        var sz = card.querySelector('input[name="tree' + i + 'size"]:checked');
        var sv = card.querySelector('input[name="tree' + i + 'service"]:checked');
        fee.textContent = sz && sv ? 'You pay: tree (estimated ' + t.treePrice[sz.value] + ') + service fee ($' + t.serviceFees[sz.value][sv.value] + ')' : '';
      }
      card.addEventListener('change', updateFee);
      card.appendChild(el('p', { class: 'label', text: 'Size' })); card.appendChild(sizes);
      card.appendChild(el('p', { class: 'label', text: 'Service' })); card.appendChild(svcs);
      card.appendChild(fee);
      card.appendChild(el('p', { class: 'field-error', 'data-error': 'trees.' + i }));
      return card;
    }
    slider.addEventListener('input', sync);
    form._syncTrees = sync;
  }
  function treesAnswers(form) {
    var n = Number(form.querySelector('[data-tree-slider]').value);
    var trees = [];
    for (var i = 0; i < n; i += 1) {
      var sz = form.querySelector('input[name="tree' + i + 'size"]:checked');
      var sv = form.querySelector('input[name="tree' + i + 'service"]:checked');
      trees.push({ size: sz ? sz.value : '', service: sv ? sv.value : '' });
    }
    return { count: n, trees: trees };
  }

  // ---------- Submit + results ----------
  var collectors = { junk: junkAnswers, landscaping: landscapingAnswers, trees: treesAnswers };

  function clearErrors(form) {
    form.querySelectorAll('.field-error').forEach(function (e) { e.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); });
  }
  function showErrors(form, questions) {
    var first = null;
    questions.forEach(function (q) {
      var parts = q.field.split('.');
      var target = form.querySelector('[data-error="' + q.field + '"]')
        || form.querySelector('[data-error="' + parts.slice(0, 2).join('.') + '"]')
        || form.querySelector('[data-error="' + parts[0] + '"]');
      if (target) {
        target.textContent = target.textContent ? target.textContent + ' ' + q.message : q.message;
        first = first || target;
      }
    });
    if (first) {
      var fs = first.closest('fieldset');
      var focusable = fs && fs.querySelector('input:not([type=hidden]), textarea, button');
      (fs || first).scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (focusable) focusable.focus({ preventScroll: true });
    }
  }

  function submit(form, extra) {
    var service = form.getAttribute('data-service');
    var result = document.querySelector('[data-result="' + service + '"]');
    var btn = form.querySelector('[data-submit]');
    var a = collectors[service](form);
    a.date = form.querySelector('input[name="date"]').value;
    a.time = form.querySelector('input[name="time"]').value;
    a.address = form.querySelector('input[name="address"]').value;
    var zone = form.querySelector('input[name="cityZone"]:checked');
    a.cityZone = zone ? zone.value : '';
    var body = {
      service: service, answers: a,
      contact: { name: form.querySelector('input[name="name"]').value, phone: form.querySelector('input[name="phone"]').value, email: form.querySelector('input[name="email"]').value,
        smsConsent: form.querySelector('input[name="smsConsent"]').checked },
    };
    if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    clearErrors(form);
    result.innerHTML = '';
    btn.disabled = true; btn.textContent = 'Checking your answers...';
    api('/api/estimate', body).then(function (r) {
      btn.disabled = false; btn.textContent = 'Generate Estimate';
      if (r.status === 'needs_info' && r.aiQuestions) return renderAiQuestions(form, result, r.questions);
      if (r.status === 'needs_info') {
        if (r.questions.some(function (q) { return q.field === 'date'; })) refreshAvailability();
        return showErrors(form, r.questions);
      }
      if (r.status === 'out_of_area' || r.status === 'distance_unavailable' || r.status === 'error') return renderMessage(result, r.message);
      if (r.status === 'ok') {
        if (window.saeTrack) window.saeTrack('Lead', { content_name: service, value: r.estimate.total.min, currency: 'USD' });
        return renderEstimate(result, r);
      }
      renderMessage(result, 'Something went wrong. Please call or text us.');
    }).catch(function () {
      btn.disabled = false; btn.textContent = 'Generate Estimate';
      renderMessage(result, 'We could not reach the server. Check your connection, or call or text us.');
    });
  }

  function contactButtons() {
    var b = config.business;
    return el('div', { class: 'btn-row' }, [
      el('a', { class: 'btn btn-accent', href: 'tel:+1' + b.phone, text: 'Call us' }),
      el('a', { class: 'btn btn-light', href: 'sms:+1' + b.textNumber, text: 'Text Us' }),
    ]);
  }
  function renderMessage(result, msg) {
    result.innerHTML = '';
    result.appendChild(el('div', { class: 'estimate notice' }, [el('p', { text: msg }), contactButtons()]));
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderAiQuestions(form, result, questions) {
    var box = el('div', { class: 'estimate notice' }, [
      el('h3', { text: 'A quick question before we price this' }),
      el('ul', {}, questions.map(function (q) { return el('li', { text: q.message }); })),
      el('p', { class: 'hint', text: 'Update your answers above and click Generate Estimate again, or continue with your answers as they are.' }),
    ]);
    var go = el('button', { type: 'button', class: 'btn btn-light', text: 'Continue with my answers' });
    go.addEventListener('click', function () { submit(form, { aiAcknowledged: true }); });
    box.appendChild(go);
    result.innerHTML = ''; result.appendChild(box);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderEstimate(result, r) {
    var e = r.estimate;
    var box = el('div', { class: 'estimate' }, [
      el('p', { class: 'eyebrow', text: 'Your estimate' }),
      el('p', { class: 'total', text: e.totalDisplay }),
      el('p', { class: 'summary', text: r.summary }),
      el('p', { class: 'when', text: 'Requested time: ' + r.dateLabel }),
    ]);
    var table = el('div', { class: 'breakdown' });
    e.sections.forEach(function (s) {
      var sec = el('div', { class: 'bd-section' }, [el('div', { class: 'bd-head' }, [el('span', { text: s.title }), el('span', { text: s.lines.length ? s.subtotalDisplay : 'None' })])]);
      s.lines.forEach(function (l) {
        sec.appendChild(el('div', { class: 'bd-line ' + l.status }, [el('span', { text: l.label }),
          el('span', {}, [l.wasDisplay ? el('s', { class: 'was', text: l.wasDisplay + ' ' }) : null, el('span', { text: l.display || '' })])]));
      });
      table.appendChild(sec);
    });
    if (e.promo) {
      table.appendChild(el('div', { class: 'bd-line' }, [el('span', { text: 'Before ' + e.promo.label + ' (' + e.promo.percent + '% off)' }), el('span', { text: e.promo.beforeDisplay })]));
      table.appendChild(el('div', { class: 'bd-line bd-save' }, [el('span', { text: e.promo.label + ': you save' }), el('span', { text: '-' + e.promo.savedDisplay })]));
    }
    table.appendChild(el('div', { class: 'bd-total' }, [el('span', { text: 'Estimated total' }), el('span', { text: e.totalDisplay })]));
    box.appendChild(table);
    e.notes.forEach(function (n) { box.appendChild(el('p', { class: 'hint', text: n })); });
    box.appendChild(el('p', { class: 'disclaimer', text: r.disclaimer }));
    // One button: book, then the customer gets their confirmation (text when a text service is set up).
    var bookBtn = el('button', { type: 'button', class: 'btn btn-accent btn-big btn-block book-btn' }, [
      el('span', { text: 'Book This Date' }),
      el('small', { text: config.autoText && r.smsConsent
        ? "We'll text and email your confirmation automatically"
        : "We'll email your confirmation and text you to confirm" }),
    ]);
    var msg = el('p', { class: 'hint', 'aria-live': 'polite' });
    bookBtn.addEventListener('click', function () {
      bookBtn.disabled = true;
      api('/api/leads/' + encodeURIComponent(r.leadId) + '/book', {}).then(function (x) {
        if (x.status === 'ok' && window.saeTrack) window.saeTrack('Schedule', { value: r.estimate.total.min, currency: 'USD' });
        var thanks = '/thank-you?type=booked&email=1';
        if (x.status === 'ok') setTimeout(function () { window.location.href = thanks; }, window.saeTrack ? 300 : 0);
        else { bookBtn.disabled = false; msg.textContent = x.message; refreshAvailability(); }
      });
    });
    box.appendChild(el('div', { class: 'btn-row' }, [bookBtn]));
    box.appendChild(msg);
    result.innerHTML = ''; result.appendChild(box);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function refreshAvailability() {
    return api('/api/availability').then(function (r) {
      availability = r.days || [];
      document.querySelectorAll('.quote-form').forEach(renderCalendar);
    });
  }

  // ---------- Boot ----------
  Promise.all([api('/api/config'), api('/api/availability')]).then(function (res) {
    config = res[0]; availability = res[1].days || [];
    document.querySelectorAll('.quote-form').forEach(function (form) {
      var s = form.getAttribute('data-service');
      if (s === 'junk') buildJunk(form);
      if (s === 'landscaping') buildLandscaping(form);
      if (s === 'trees') buildTrees(form);
      buildCommon(form);
      if (form._syncTrees) form._syncTrees();
      form.addEventListener('submit', function (ev) { ev.preventDefault(); submit(form); });
    });
    document.body.setAttribute('data-ready', 'true');
  }).catch(function () {
    document.querySelectorAll('.quote-form').forEach(function (f) {
      f.innerHTML = '<p class="alert">The estimate form could not load. Please call or text us.</p>';
    });
  });
})();
