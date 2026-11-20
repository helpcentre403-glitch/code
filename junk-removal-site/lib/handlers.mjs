// Platform-neutral request handler (Web standard Request/Response).
// Thin adapters in functions/ (Cloudflare) and netlify/functions/ (Netlify) call it.
import config from "../site.config.mjs";
import { validateLead } from "./validate.mjs";
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

  const rec = {
    ...v.lead,
    leadId: newLeadId(),
    receivedAt: centralTime(),
    spam: v.spam || "",
    photoLinks: [],
  };

  try {
    const store = opts.store || createStore(env);
    if (v.photos.length) {
      try {
        rec.photoLinks = await store.savePhotos(v.photos, rec.leadId);
      } catch (e) {
        // A photo problem must not lose the lead.
        log.error?.("[lead] photo upload failed:", e.message);
        rec.photoLinks = [`${v.photos.length} photo(s) failed to upload: ${e.message}`.slice(0, 200)];
      }
    }
    await store.saveLead(rec);
  } catch (e) {
    // Full lead goes to the function log so it can be recovered by hand.
    log.error?.("[lead] SAVE FAILED:", e.message, JSON.stringify(rec));
    const msg = `Sorry, we could not send your request. Please call ${config.business.phone} or text ${config.business.textNumber}.`;
    return wantsJson ? json({ ok: false, errors: { form: msg } }, 500) : htmlPage("Sorry, something went wrong", `<p>${esc(msg)}</p>`, 500);
  }

  log.info?.(`[lead] ${rec.leadId} saved spam=${rec.spam || "none"} photos=${v.photos.length}`);
  return success(rec.leadId);
}
