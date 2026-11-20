// LOCAL DEVELOPMENT ONLY: stores leads as files in ./data/ so you can test
// without Google credentials. Not used in production.
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leadRow, LEAD_COLUMNS } from "../lib/stores.mjs";

export function localStore(dir) {
  mkdirSync(join(dir, "uploads"), { recursive: true });
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
      const row = leadRow(rec);
      appendFileSync(join(dir, "leads.jsonl"), JSON.stringify(Object.fromEntries(LEAD_COLUMNS.map((c, i) => [c, row[i]]))) + "\n");
      return rec.leadId;
    },
  };
}
