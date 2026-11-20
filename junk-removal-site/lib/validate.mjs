// Server-side validation. Mirrors the client rules in src/assets/js/main.js.
import config from "../site.config.mjs";

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif",
];

/** Normalize a US phone number to E.164 (+1XXXXXXXXXX). Returns null if invalid. */
export function normalizeUsPhone(input) {
  if (typeof input !== "string") return null;
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  // NANP: area code and exchange cannot start with 0 or 1.
  if (/^[01]/.test(digits) || /^[01]/.test(digits.slice(3))) return null;
  return "+1" + digits;
}

function clean(v, max = 200) {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}

/**
 * Validate a FormData from the quote form.
 * Returns { ok, errors: {field: message}, lead, photos, spam }.
 */
export function validateLead(form, now = Date.now()) {
  const errors = {};
  const name = clean(form.get("name"), 100);
  const phoneRaw = clean(form.get("phone"), 40);
  const zip = clean(form.get("zip"), 10);
  const jobType = clean(form.get("job_type"), 40);
  const weekend = clean(form.get("preferred_weekend"), 40);
  const consent = form.get("sms_consent");

  if (!name) errors.name = "Please enter your name.";
  else if (name.length < 2) errors.name = "Please enter your full name.";

  const phone = normalizeUsPhone(phoneRaw);
  if (!phoneRaw) errors.phone = "Please enter your mobile number.";
  else if (!phone) errors.phone = "Please enter a valid 10-digit US mobile number.";

  if (!zip) errors.zip = "Please enter your ZIP code.";
  else if (!/^\d{5}(-\d{4})?$/.test(zip)) errors.zip = "Please enter a 5-digit ZIP code.";

  const job = config.jobTypes.find((j) => j.value === jobType);
  if (!job) errors.job_type = "Please choose a job type.";

  const wk = config.weekends.find((w) => w.value === weekend);
  if (!wk) errors.preferred_weekend = "Please choose a preferred weekend.";

  if (consent !== "yes") errors.sms_consent = "Please check the box so we can text you your quote.";

  // Photos (optional)
  const files = form.getAll("photos").filter((f) => f && typeof f === "object" && f.size > 0);
  if (files.length > config.upload.maxFiles) {
    errors.photos = `Please attach up to ${config.upload.maxFiles} photos.`;
  } else {
    for (const f of files) {
      if (f.size > config.upload.maxBytesEach) {
        errors.photos = `Each photo must be 10 MB or smaller ("${clean(f.name, 60)}" is too big).`;
        break;
      }
      if (f.type && !ALLOWED_IMAGE_TYPES.includes(f.type)) {
        errors.photos = "Photos must be image files (JPG, PNG, WEBP or HEIC).";
        break;
      }
    }
  }

  // Spam checks
  let spam = null;
  if (clean(form.get("company_website"))) spam = "honeypot";
  else {
    const started = Number(form.get("form_started_at"));
    if (!started) spam = "no_timestamp"; // no JavaScript, or a bot
    else {
      const elapsed = (now - started) / 1000;
      if (elapsed < config.minSecondsToSubmit) spam = "too_fast";
      else if (elapsed > 60 * 60 * 24) spam = "stale_form"; // page left open > 24h; still a lead
    }
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    spam,
    photos: files,
    lead: {
      name,
      phone,
      phoneRaw,
      zip,
      jobType: job?.value || "",
      jobTypeLabel: job?.label || "",
      weekend: wk?.value || "",
      weekendLabel: wk?.label || "",
      smsConsent: consent === "yes",
      consentText: config.consentText,
      pageUrl: clean(form.get("page_url"), 300),
    },
  };
}
