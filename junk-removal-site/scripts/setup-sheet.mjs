// One-time: creates the "Leads" and "OptOuts" tabs (if missing) and writes header rows.
// Usage: fill in .env, then `npm run setup:sheet`
import { loadEnv } from "../dev/load-env.mjs";
import { sheetsListTabs, sheetsAddTab, sheetsUpdate } from "../lib/google.mjs";
import { LEAD_COLUMNS, OPTOUT_COLUMNS, LEADS_TAB, OPTOUTS_TAB } from "../lib/stores.mjs";

loadEnv();
const env = process.env;
try {
  const tabs = await sheetsListTabs(env);
  for (const t of [LEADS_TAB, OPTOUTS_TAB]) {
    if (!tabs.includes(t)) { await sheetsAddTab(env, t); console.log(`Created tab "${t}"`); }
  }
  await sheetsUpdate(env, `${LEADS_TAB}!A1:N1`, LEAD_COLUMNS);
  await sheetsUpdate(env, `${OPTOUTS_TAB}!A1:D1`, OPTOUT_COLUMNS);
  console.log("Header rows written. The sheet is ready.");
} catch (e) {
  console.error("Setup failed:", e.message);
  console.error("Check GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and that the sheet is shared with the service account as Editor.");
  process.exit(1);
}
