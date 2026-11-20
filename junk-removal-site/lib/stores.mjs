// Lead destinations the owner controls.
//   LEAD_STORE=sheets  (default) Google Sheet in the owner's Google account
//   LEAD_STORE=webhook POST JSON to an endpoint the owner runs (e.g. their own database API)
// A third store, "local" (JSON files on disk), exists only for local development
// and lives in dev/local-store.mjs so serverless bundles never import Node's fs.
import { sheetsAppend, driveUpload } from "./google.mjs";

export const LEAD_COLUMNS = [
  "Received (Central)", "Lead ID", "Status", "Name", "Mobile", "ZIP", "Job type", "Preferred weekend",
  "Photos", "OK to text", "Consent text", "Spam flag", "Page",
];
export const LEADS_TAB = "Leads";

export function centralTime(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "short",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${p.timeZoneName}`;
}

// "Status" starts as "New" (or "Check: possible spam") so the owner can track
// each lead by editing that cell: Quoted, Booked, Done, etc.
export function leadRow(rec) {
  return [
    rec.receivedAt, rec.leadId, rec.spam === "too_fast" ? "Check: possible spam" : "New",
    rec.name, rec.phone, rec.zip, rec.jobTypeLabel, rec.weekendLabel,
    rec.photoLinks.join("\n"), rec.smsConsent ? "yes" : "no", rec.consentText, rec.spam || "", rec.pageUrl,
  ];
}

export function sheetsStore(env) {
  for (const k of ["GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"]) {
    if (!env[k]) throw new Error(`LEAD_STORE=sheets but ${k} is not set`);
  }
  return {
    name: "sheets",
    async savePhotos(files, leadId) {
      if (!files.length) return [];
      if (!env.GOOGLE_DRIVE_FOLDER_ID) {
        return [`${files.length} photo(s) received but not stored: GOOGLE_DRIVE_FOLDER_ID is not set`];
      }
      const links = [];
      for (let i = 0; i < files.length; i++) {
        const ext = (files[i].name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5);
        links.push(await driveUpload(env, files[i], `${leadId}-${i + 1}.${ext}`));
      }
      return links;
    },
    async saveLead(rec) {
      return sheetsAppend(env, `${LEADS_TAB}!A:M`, leadRow(rec));
    },
  };
}

export function webhookStore(env) {
  if (!env.LEAD_WEBHOOK_URL) throw new Error("LEAD_STORE=webhook but LEAD_WEBHOOK_URL is not set");
  const post = async (payload) => {
    const res = await fetch(env.LEAD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lead-secret": env.LEAD_WEBHOOK_SECRET || "" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Lead webhook returned ${res.status}`);
    return res.json().catch(() => ({}));
  };
  return {
    name: "webhook",
    async savePhotos(files, leadId) {
      const links = [];
      for (let i = 0; i < files.length; i++) {
        const bytes = new Uint8Array(await files[i].arrayBuffer());
        let bin = "";
        for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
        const r = await post({ type: "photo", leadId, index: i + 1, contentType: files[i].type, dataBase64: btoa(bin) });
        links.push(r.url || `photo ${i + 1} sent to webhook`);
      }
      return links;
    },
    async saveLead(rec) { await post({ type: "lead", lead: rec, columns: LEAD_COLUMNS, row: leadRow(rec) }); return rec.leadId; },
  };
}

export function createStore(env) {
  const kind = (env.LEAD_STORE || "sheets").toLowerCase();
  if (kind === "sheets") return sheetsStore(env);
  if (kind === "webhook") return webhookStore(env);
  throw new Error(`Unknown LEAD_STORE "${kind}" (use "sheets" or "webhook")`);
}
