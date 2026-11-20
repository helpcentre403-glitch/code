// LOCAL DEVELOPMENT ONLY: stores leads and opt-outs as files in ./data/
// so you can test without Google credentials. Not used in production.
import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { leadRow, LEAD_COLUMNS, optedOutFromRows, centralTime } from "../lib/stores.mjs";

export function localStore(dir) {
  mkdirSync(join(dir, "uploads"), { recursive: true });
  const leadsFile = join(dir, "leads.jsonl");
  const optFile = join(dir, "optouts.jsonl");
  const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    name: "local",
    async savePhotos(files, leadId) {
      const out = [];
      for (let i = 0; i < files.length; i++) {
        const ext = (files[i].name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 5);
        const p = join(dir, "uploads", `${leadId}-${i + 1}.${ext}`);
        writeFileSync(p, Buffer.from(await files[i].arrayBuffer()));
        out.push(p);
      }
      return out;
    },
    async saveLead(rec) {
      const row = Object.fromEntries(LEAD_COLUMNS.map((c, i) => [c, leadRow(rec)[i]]));
      appendFileSync(leadsFile, JSON.stringify(row) + "\n");
      return rec.leadId;
    },
    async updateLeadStatus(ref, rec) {
      const rows = readJsonl(leadsFile).map((r) => (r["Lead ID"] === ref
        ? { ...r, "Confirmation text": rec.confirmationStatus, "Owner alert": rec.ownerAlertStatus } : r));
      writeFileSync(leadsFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    },
    async isOptedOut(phone) {
      return optedOutFromRows(readJsonl(optFile).map((r) => [r.time, r.phone, r.status, r.source]), phone);
    },
    async recordOptStatus(phone, status, source) {
      appendFileSync(optFile, JSON.stringify({ time: centralTime(), phone, status, source }) + "\n");
    },
  };
}
