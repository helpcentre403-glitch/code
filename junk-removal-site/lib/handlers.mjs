// Platform-neutral request handlers (Web standard Request/Response).
// Thin adapters in functions/ (Cloudflare) and netlify/functions/ (Netlify) call these.
import config from "../site.config.mjs";
import { validateLead, normalizeUsPhone } from "./validate.mjs";
import { sendSms, verifyTwilioSignature, classifyKeyword } from "./twilio.mjs";
import { createStore, centralTime } from "./stores.mjs";

const THANK_YOU = "/thank-you";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function redirect(location) {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}
function htmlPage(title, bodyHtml, status) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><link rel="stylesheet" href="/assets/css/styles.css"></head><body><main class="container section"><h1>${esc(title)}</h1>${bodyHtml}</main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export function confirmationText(lead) {
  return `Hi ${lead.name}, thanks for your request with ${config.business.name}. We'll text you to confirm your ${lead.weekendSmsPhrase} pickup. Reply STOP to opt out.`;
}

export function ownerAlertText(rec, env) {
  const lines = [
    `New quote request ${rec.leadId}`,
    `Name: ${rec.name}`,
    `Mobile: ${rec.phone}`,
    `ZIP: ${rec.zip}`,
    `Job: ${rec.jobTypeLabel}`,
    `Weekend: ${rec.weekendLabel}`,
    `Photos: ${rec.photoCount}`,
  ];
  if (env.GOOGLE_SHEET_ID && (env.LEAD_STORE || "sheets") === "sheets") {
    lines.push(`Sheet: https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID}`);
  }
  if (rec.saveFailed) lines.push("WARNING: lead was NOT saved to the sheet. Save this text.");
  return lines.join("\n");
}

function newLeadId() {
  return "L-" + crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * POST /api/lead
 * opts.store: override the lead store (used by the local dev server)
 */
export async function handleLead(request, env, opts = {}) {
  const log = opts.log || console;
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const wantsJson = (request.headers.get("accept") || "").includes("application/json");

  let form;
  try {
    form = await request.formData();
  } catch {
    return wantsJson ? json({ ok: false, errors: { form: "Could not read the form. Please try again." } }, 400)
      : htmlPage("Something went wrong", "<p>We could not read the form. Please go back and try again.</p>", 400);
  }

  const v = validateLead(form);
  if (!v.ok) {
    if (wantsJson) return json({ ok: false, errors: v.errors }, 422);
    const items = Object.values(v.errors).map((m) => `<li>${esc(m)}</li>`).join("");
    return htmlPage("Please fix a few things", `<ul class="error-list">${items}</ul><p><a class="btn" href="/#quote">Go back to the form</a></p>`, 422);
  }

  const success = (leadId) => (wantsJson ? json({ ok: true, leadId, redirect: THANK_YOU }) : redirect(THANK_YOU));

  // Honeypot: pretend success, store nothing.
  if (v.spam === "honeypot") {
    log.warn?.("[lead] honeypot filled; dropped");
    return success(newLeadId());
  }
  const suspicious = v.spam === "too_fast";

  let store;
  try {
    store = opts.store || createStore(env);
  } catch (e) {
    log.error?.("[lead] store config error:", e.message);
    store = null;
  }

  const rec = {
    ...v.lead,
    leadId: newLeadId(),
    receivedAt: centralTime(),
    spam: v.spam || "",
    photoLinks: [],
    photoCount: v.photos.length,
    confirmationStatus: "",
    ownerAlertStatus: "",
    saveFailed: false,
  };

  // 1. Photos (failure here must not lose the lead)
  if (store && v.photos.length) {
    try {
      rec.photoLinks = await store.savePhotos(v.photos, rec.leadId);
    } catch (e) {
      log.error?.("[lead] photo upload failed:", e.message);
      rec.photoLinks = [`${v.photos.length} photo(s) failed to upload: ${e.message}`.slice(0, 200)];
    }
  }

  // 2. Save the lead
  let ref = null;
  try {
    if (!store) throw new Error("no lead store configured");
    ref = await store.saveLead(rec);
  } catch (e) {
    rec.saveFailed = true;
    log.error?.("[lead] SAVE FAILED:", e.message, JSON.stringify({ ...rec, photoLinks: rec.photoLinks.length }));
  }

  // 3. Owner alert + 4. confirmation text (in parallel). Skipped for suspected bots.
  const ownerTask = (async () => {
    if (suspicious) return "skipped_spam";
    if (!env.OWNER_ALERT_PHONE) return "not_configured";
    const r = await sendSms(env, env.OWNER_ALERT_PHONE, ownerAlertText(rec, env), { log });
    return r.status + (r.error ? `: ${r.error}` : "");
  })();

  const confirmTask = (async () => {
    if (suspicious) return "skipped_spam";
    if (!rec.smsConsent) return "skipped_no_consent";
    try {
      if (store && (await store.isOptedOut(rec.phone))) return "skipped_opted_out";
    } catch (e) {
      log.warn?.("[lead] opt-out check failed (Twilio still blocks STOPped numbers):", e.message);
    }
    const r = await sendSms(env, rec.phone, confirmationText(rec), { log });
    if (r.status === "opted_out" && store) {
      await store.recordOptStatus(rec.phone, "STOP", "twilio_error_21610").catch(() => {});
    }
    return r.status + (r.error ? `: ${r.error}` : "");
  })();

  [rec.ownerAlertStatus, rec.confirmationStatus] = await Promise.all([ownerTask, confirmTask]);

  if (ref && store) {
    try { await store.updateLeadStatus(ref, rec); } catch (e) { log.warn?.("[lead] status update failed:", e.message); }
  }

  log.info?.(`[lead] ${rec.leadId} saved=${!rec.saveFailed} owner=${rec.ownerAlertStatus} confirm=${rec.confirmationStatus} spam=${rec.spam || "none"}`);

  if (rec.saveFailed && !/^(sent|logged)/.test(rec.ownerAlertStatus)) {
    const msg = `Sorry, we could not send your request. Please call ${config.business.phone} or text ${config.business.textNumber}.`;
    return wantsJson ? json({ ok: false, errors: { form: msg } }, 500) : htmlPage("Sorry, something went wrong", `<p>${esc(msg)}</p>`, 500);
  }
  return success(rec.leadId);
}

const TWIML_EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/**
 * POST /api/sms-inbound  (Twilio "A message comes in" webhook)
 * Records STOP / START in the opt-out list; forwards other messages to the owner.
 */
export async function handleSmsInbound(request, env, opts = {}) {
  const log = opts.log || console;
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const text = await request.text();
  const params = Object.fromEntries(new URLSearchParams(text));

  const url = env.TWILIO_WEBHOOK_URL || request.url;
  const ok = await verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, url, params, request.headers.get("x-twilio-signature"));
  if (!ok) {
    log.warn?.("[sms-inbound] bad or missing Twilio signature; rejected");
    return new Response("Forbidden", { status: 403 });
  }

  const from = normalizeUsPhone(params.From || "") || params.From || "";
  const keyword = classifyKeyword(params.Body, params.OptOutType);
  const store = opts.store || createStore(env);

  if (keyword) {
    await store.recordOptStatus(from, keyword, "sms_reply");
    log.info?.(`[sms-inbound] ${from} -> ${keyword}`);
    // Twilio's built-in opt-out handling sends the STOP/START confirmation reply.
  } else if (env.OWNER_ALERT_PHONE && from !== normalizeUsPhone(env.OWNER_ALERT_PHONE)) {
    const r = await sendSms(env, env.OWNER_ALERT_PHONE, `Text from ${from}:\n${String(params.Body || "").slice(0, 1000)}`, { log });
    log.info?.(`[sms-inbound] forwarded message from ${from}: ${r.status}`);
  }
  return new Response(TWIML_EMPTY, { status: 200, headers: { "content-type": "text/xml" } });
}
