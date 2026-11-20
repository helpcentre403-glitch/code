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
      + '<input id="' + id + '-address" name="address" autocomplete="street-address" maxlength="300" placeholder="123 Main St, Carrollton, TX 75006">'
      + '<p class="hint">We use this to measure the driving distance fee. Homes in Carrollton pay no travel fee.</p>'
      + '<p class="field-error" data-error="address"></p></fieldset>'
      + '<fieldset class="step"><legend><span class="num">' + (n + 2) + '</span> Your contact info</legend>'
      + '<label class="label" for="' + id + '-name">Name</label>'
      + '<input id="' + id + '-name" name="name" autocomplete="name" maxlength="100">'
      + '<p class="field-error" data-error="contact.name"></p>'
      + '<label class="label" for="' + id + '-phone">Mobile phone (we text you to confirm)</label>'
      + '<input id="' + id + '-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20">'
      + '<p class="field-error" data-error="contact.phone"></p>'
      + '<label class="label" for="' + id + '-email">Email <span class="opt">Optional</span></label>'
      + '<input id="' + id + '-email" name="email" type="email" autocomplete="email" maxlength="200">'
      + '<p class="field-error" data-error="contact.email"></p></fieldset>'
      + '<button type="submit" class="btn btn-accent btn-big btn-block" data-submit>Generate Estimate</button>'
      + '<p class="hint center" data-submit-hint></p>';
    renderCalendar(form);
  }

  // Every open date is listed with all of its open times visible. One tap picks date + time.
  var DAYS_SHOWN = 7;
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
    var list = el('div', { class: 'day-list', role: 'radiogroup', 'aria-label': 'Date and time' });
    var chosen = el('p', { class: 'chosen-slot', 'aria-live': 'polite' });
    availability.forEach(function (d, i) {
      var head = el('div', { class: 'day-head' }, [
        el('strong', { text: d.isToday ? 'Today, ' + (d.label.split(', ')[1] || d.label) : d.label }),
      ]);
      if (d.isToday && isJunk) head.appendChild(el('span', { class: 'day-note', text: 'Same-day adds ' + config.junk.extras.sameDay }));
      var grid = el('div', { class: 'slot-grid' });
      d.slots.forEach(function (s) {
        var sb = el('button', { type: 'button', class: 'slot', role: 'radio', 'aria-checked': 'false', 'data-date': d.date, 'data-time': s.time, text: s.label,
          'aria-label': d.label + ' at ' + s.label });
        sb.addEventListener('click', function () {
          dateInput.value = d.date; timeInput.value = s.time;
          list.querySelectorAll('.slot').forEach(function (x) { x.setAttribute('aria-checked', String(x === sb)); });
          chosen.textContent = 'Selected: ' + d.label + ' at ' + s.label;
        });
        grid.appendChild(sb);
      });
      var row = el('div', { class: 'day-row', 'data-date': d.date }, [head, grid]);
      if (i >= DAYS_SHOWN) row.hidden = true;
      list.appendChild(row);
    });
    host.appendChild(list);
    if (availability.length > DAYS_SHOWN) {
      var more = el('button', { type: 'button', class: 'btn btn-light btn-small show-more', text: 'Show more dates (' + (availability.length - DAYS_SHOWN) + ')' });
      more.addEventListener('click', function () {
        list.querySelectorAll('.day-row[hidden]').forEach(function (r) { r.hidden = false; });
        more.remove();
      });
      host.appendChild(more);
    }
    host.appendChild(chosen);
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
    var body = {
      service: service, answers: a,
      contact: { name: form.querySelector('input[name="name"]').value, phone: form.querySelector('input[name="phone"]').value, email: form.querySelector('input[name="email"]').value },
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
      if (r.status === 'ok') return renderEstimate(result, r);
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
        sec.appendChild(el('div', { class: 'bd-line ' + l.status }, [el('span', { text: l.label }), el('span', { text: l.display || '' })]));
      });
      table.appendChild(sec);
    });
    table.appendChild(el('div', { class: 'bd-total' }, [el('span', { text: 'Estimated total' }), el('span', { text: e.totalDisplay })]));
    box.appendChild(table);
    e.notes.forEach(function (n) { box.appendChild(el('p', { class: 'hint', text: n })); });
    box.appendChild(el('p', { class: 'disclaimer', text: r.disclaimer }));
    var textBtn = el('button', { type: 'button', class: 'btn btn-light', text: 'Text Me This Quote' });
    var bookBtn = el('button', { type: 'button', class: 'btn btn-accent', text: 'Book This Date' });
    var msg = el('p', { class: 'hint', 'aria-live': 'polite' });
    textBtn.addEventListener('click', function () {
      textBtn.disabled = true;
      api('/api/leads/' + encodeURIComponent(r.leadId) + '/text', {}).then(function (x) {
        if (x.status === 'ok') window.location.href = '/thank-you?type=quote';
        else { textBtn.disabled = false; msg.textContent = x.message || 'Could not send. Please call or text us.'; }
      });
    });
    bookBtn.addEventListener('click', function () {
      bookBtn.disabled = true;
      api('/api/leads/' + encodeURIComponent(r.leadId) + '/book', {}).then(function (x) {
        if (x.status === 'ok') window.location.href = '/thank-you?type=booked';
        else { bookBtn.disabled = false; msg.textContent = x.message; refreshAvailability(); }
      });
    });
    box.appendChild(el('div', { class: 'btn-row' }, [textBtn, bookBtn]));
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
