/* Site script: quote form (validation, photo compression, submit), pixel events. No secrets here. */
(function () {
  "use strict";
  var formEl = document.getElementById("quote-form");
  var MAX_FILES = Number(formEl && formEl.getAttribute("data-max-files")) || 5;
  var MAX_BYTES = Number(formEl && formEl.getAttribute("data-max-bytes")) || 10 * 1024 * 1024;
  var MAX_DIM = 1600; // photos are resized in the browser before upload
  var LEAD_FLAG = "jr_lead_submitted";

  function track(event, params, opts) {
    try { if (typeof window.fbq === "function") window.fbq("track", event, params || {}, opts || {}); } catch (e) {}
  }

  // "Contact" when someone taps Call or Text
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a.js-contact");
    if (a) track("Contact", { method: a.getAttribute("data-method") || "" });
  });

  // "Lead" on the thank-you page, only right after a successful submit
  if (document.body.getAttribute("data-page") === "thank-you") {
    try {
      var leadId = sessionStorage.getItem(LEAD_FLAG);
      if (leadId) {
        sessionStorage.removeItem(LEAD_FLAG);
        var fire = function () { track("Lead", {}, { eventID: leadId }); };
        // pixel.js is deferred too; wait for it.
        if (document.readyState === "complete") fire(); else window.addEventListener("load", fire);
      }
    } catch (e) {}
  }

  var form = document.getElementById("quote-form");
  if (!form) return;

  form.elements.form_started_at.value = String(Date.now());
  form.elements.page_url.value = location.pathname + location.search;

  var summary = document.getElementById("form-summary");
  var button = form.querySelector("button[type=submit]");

  function phoneOk(v) {
    var d = v.replace(/\D/g, "");
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    return d.length === 10 && /^[2-9]\d{2}[2-9]/.test(d);
  }

  function validate() {
    var f = form.elements, errors = {};
    var name = f.name.value.trim();
    if (!name) errors.name = "Please enter your name.";
    else if (name.length < 2) errors.name = "Please enter your full name.";
    var phone = f.phone.value.trim();
    if (!phone) errors.phone = "Please enter your mobile number.";
    else if (!phoneOk(phone)) errors.phone = "Please enter a valid 10-digit US mobile number.";
    var zip = f.zip.value.trim();
    if (!zip) errors.zip = "Please enter your ZIP code.";
    else if (!/^\d{5}(-\d{4})?$/.test(zip)) errors.zip = "Please enter a 5-digit ZIP code.";
    if (!f.job_type.value) errors.job_type = "Please choose a job type.";
    if (!f.preferred_weekend.value) errors.preferred_weekend = "Please choose a preferred weekend.";
    if (!f.sms_consent.checked) errors.sms_consent = "Please check the box so we can text you your quote.";
    var files = f.photos.files || [];
    if (files.length > MAX_FILES) errors.photos = "Please attach up to " + MAX_FILES + " photos.";
    for (var i = 0; i < files.length && !errors.photos; i++) {
      if (files[i].size > MAX_BYTES) errors.photos = "Each photo must be 10 MB or smaller (\"" + files[i].name + "\" is too big).";
      else if (files[i].type && files[i].type.indexOf("image/") !== 0) errors.photos = "Photos must be image files (JPG, PNG, WEBP or HEIC).";
    }
    return errors;
  }

  function fieldEl(name) { return form.elements[name]; }

  function showErrors(errors) {
    var keys = Object.keys(errors);
    form.querySelectorAll(".error").forEach(function (p) {
      var name = p.getAttribute("data-for");
      p.textContent = errors[name] || "";
      var el = fieldEl(name);
      if (el && el.setAttribute) {
        if (errors[name]) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
      }
    });
    if (!keys.length) { summary.hidden = true; summary.textContent = ""; return; }
    summary.textContent = errors.form || (keys.length === 1 ? "Please fix the highlighted field." : "Please fix the " + keys.length + " highlighted fields.");
    summary.hidden = false;
    var first = keys.filter(function (k) { return k !== "form"; })[0];
    var el = first && fieldEl(first);
    if (el && el.focus) el.focus(); else summary.focus();
  }

  // Clear a field's error as soon as it is fixed. Uses "input" (fires while typing),
  // not "change" (fires on blur): clearing on blur shifts the layout at the moment
  // the user taps the next control, so the tap can land on the wrong element.
  form.addEventListener("input", function (e) {
    var name = e.target.name;
    if (!name) return;
    var errs = validate();
    var p = form.querySelector('.error[data-for="' + name + '"]');
    if (p && !errs[name]) { p.textContent = ""; e.target.removeAttribute("aria-invalid"); }
  });

  function compress(file) {
    return new Promise(function (resolve) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || !window.createImageBitmap) return resolve(file);
      createImageBitmap(file).then(function (bmp) {
        var scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
        var c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale);
        c.height = Math.round(bmp.height * scale);
        c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
        c.toBlob(function (blob) {
          if (!blob || blob.size >= file.size) return resolve(file);
          resolve(new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
        }, "image/jpeg", 0.82);
      }).catch(function () { resolve(file); });
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var errors = validate();
    showErrors(errors);
    if (Object.keys(errors).length) return;

    button.disabled = true;
    var label = button.textContent;
    button.textContent = "Sending...";

    var data = new FormData(form);
    var files = Array.prototype.slice.call(form.elements.photos.files || []);
    data.delete("photos");

    Promise.all(files.map(compress)).then(function (small) {
      small.forEach(function (f) { data.append("photos", f, f.name); });
      return fetch(form.action, { method: "POST", body: data, headers: { Accept: "application/json" } });
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, errors: { form: "Something went wrong. Please call or text us." } }; });
    }).then(function (out) {
      if (out.ok) {
        try { sessionStorage.setItem(LEAD_FLAG, out.leadId || "1"); } catch (err) {}
        location.href = out.redirect || "/thank-you";
        return;
      }
      showErrors(out.errors || { form: "Something went wrong. Please call or text us." });
      button.disabled = false;
      button.textContent = label;
    }).catch(function () {
      showErrors({ form: "Could not send. Check your connection and try again, or call or text us." });
      button.disabled = false;
      button.textContent = label;
    });
  });
})();
