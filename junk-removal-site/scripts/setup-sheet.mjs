// One-time: creates the "Leads" tab (if missing) and writes the header row.
// Usage: fill in .env, then `npm run setup:sheet`
import { loadEnv } from "../dev/load-env.mjs";
import { sheetsListTabs, sheetsAddTab, sheetsUpdate } from "../lib/google.mjs";
import { LEAD_COLUMNS, LEADS_TAB } from "../lib/stores.mjs";

loadEnv();
const env = process.env;
try {
  const tabs = await sheetsListTabs(env);
  for (const t of [LEADS_TAB]) {
    if (!tabs.includes(t)) { await sheetsAddTab(env, t); console.log(`Created tab "${t}"`); }
  }
  await sheetsUpdate(env, `${LEADS_TAB}!A1:M1`, LEAD_COLUMNS);
  console.log("Header row written. The sheet is ready.");
} catch (e) {
  console.error("Setup failed:", e.message);
  console.error("Check GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and that the sheet is shared with the service account as Editor.");
  process.exit(1);
}
