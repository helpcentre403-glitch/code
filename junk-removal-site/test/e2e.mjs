// End-to-end test. Run with `npm test` (or `node test/e2e.mjs`).
//  Part 1: real browser fills and submits the form on the local dev server (needs Playwright; skipped if missing)
//  Part 2: HTTP checks: server validation, no-JS submit, spam checks
//  Part 3: production code path (Google Sheets + Drive) against a local mock of those APIs
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { generateKeyPairSync } from "node:crypto";
import { handleLead } from "../lib/handlers.mjs";
import { startMock } from "./mock-google.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8790;
const BASE = `http://localhost:${PORT}`;
const TEST_PIXEL = "1234567890";
const dataDir = mkdtempSync(join(tmpdir(), "jr-e2e-"));
let failures = 0;
const check = (cond, label, extra = "") => { console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${extra ? "  " + extra : ""}`); if (!cond) failures++; };
const h = (t) => console.log(`\n=== ${t} ===`);
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const leads = () => readJsonl(join(dataDir, "leads.jsonl"));

// Build with a fake pixel ID so pixel events can be checked (requests to Meta are blocked in the test).
execFileSync("node", ["build.mjs"], { cwd: root, env: { ...process.env, META_PIXEL_ID: TEST_PIXEL }, stdio: "ignore" });

const server = spawn("node", ["dev/server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), LOCAL_DATA_DIR: dataDir, LEAD_STORE: "local" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverLog = [];
server.stdout.on("data", (d) => serverLog.push(d.toString()));
server.stderr.on("data", (d) => serverLog.push(d.toString()));
for (let i = 0; i < 50; i++) { try { await fetch(BASE + "/"); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

function leadForm(o = {}) {
  const f = new FormData();
  const d = { name: "Test Customer", phone: "(214) 555-0123", zip: "75024", job_type: "few_items", preferred_weekend: "this_sunday",
    sms_consent: "yes", company_website: "", form_started_at: String(Date.now() - 15_000), page_url: "/", ...o };
  for (const [k, v] of Object.entries(d)) if (v !== undefined) f.append(k, v);
  return f;
}
const postLead = (form, json = true) => fetch(BASE + "/api/lead", { method: "POST", body: form, redirect: "manual", headers: json ? { accept: "application/json" } : {} });

try {
  // ------------------------------------------------------------------ Part 1
  h("Part 1: browser test (mobile emulation)");
  let pw = null;
  try { pw = createRequire(import.meta.url)("playwright"); } catch { console.log("  SKIP  Playwright not installed (npm i -D playwright to enable)"); }
  if (pw) {
    const browser = await pw.chromium.launch();
    const device = pw.devices["Pixel 7"] || { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true };
    const ctx = await browser.newContext({ ...device, reducedMotion: "reduce" });
    await ctx.route("https://connect.facebook.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await ctx.route("https://www.facebook.com/**", (r) => r.fulfill({ status: 204, body: "" }));
    const page = await ctx.newPage();
    const pixelQueue = () => page.evaluate(() => (window.fbq && window.fbq.queue ? window.fbq.queue.map((a) => Array.from(a)) : []));
    const events = (q) => q.filter((a) => a[0] === "track").map((a) => a[1]);

    // A large photo (~2400x1800 JPEG) to exercise in-browser resizing
    const shot = await browser.newPage({ viewport: { width: 2400, height: 1800 } });
    await shot.setContent('<body style="margin:0;background:linear-gradient(45deg,#c33,#3c3,#33c,#cc3)"><div style="font:200px sans-serif;padding:200px">junk pile</div></body>');
    const photo = await shot.screenshot({ type: "jpeg", quality: 95 });
    await shot.close();

    await page.goto(BASE + "/");
    check(events(await pixelQueue()).includes("PageView"), "Meta Pixel PageView queued on homepage");
    const stickyBefore = await page.locator(".site-header").boundingBox();
    await page.mouse.wheel(0, 3000); await page.waitForTimeout(300);
    const stickyAfter = await page.evaluate(() => document.querySelector(".site-header").getBoundingClientRect().top);
    check(stickyBefore && stickyAfter === 0, "header stays visible after scrolling");

    await page.click("#quote-form button[type=submit]");
    const errs = await page.$$eval("#quote-form .error", (els) => els.filter((e) => e.textContent).map((e) => `${e.dataset.for}: ${e.textContent}`));
    console.log("  Client-side errors on empty submit:\n    " + errs.join("\n    "));
    check(errs.length === 6, "client validation shows 6 required-field errors");
    check(await page.evaluate(() => document.activeElement.id) === "f-name", "focus moves to first invalid field");

    await page.fill("#f-name", "Test Customer");
    await page.fill("#f-phone", "(214) 555-0123");
    await page.fill("#f-zip", "75024");
    await page.selectOption("#f-job", "truck_load");
    await page.selectOption("#f-weekend", "this_saturday");
    await page.setInputFiles("#f-photos", { name: "garage.jpg", mimeType: "image/jpeg", buffer: photo });
    await page.check("#f-consent");
    await page.waitForTimeout(3100); // honor the time-to-submit check
    await Promise.all([page.waitForURL("**/thank-you"), page.click("#quote-form button[type=submit]")]);
    await page.waitForLoadState("load");
    await page.waitForFunction(() => window.fbq && window.fbq.queue.some((a) => a[1] === "Lead"), null, { timeout: 3000 }).catch(() => {});
    check(new URL(page.url()).pathname === "/thank-you", "redirected to /thank-you", page.url());
    check((await page.textContent("h1")).includes("Got it. We'll text you to confirm your pickup time."), "thank-you headline shown");
    const leadEvt = (await pixelQueue()).find((a) => a[1] === "Lead");
    check(!!leadEvt, "Meta Pixel Lead event fired after successful submit", leadEvt ? `eventID=${leadEvt[3]?.eventID}` : "");

    await page.evaluate(() => window.addEventListener("click", (e) => e.preventDefault())); // don't actually open the dialer
    await page.click(".site-header a[data-method=call]");
    await page.click(".site-header a[data-method=text]");
    const contacts = (await pixelQueue()).filter((a) => a[1] === "Contact").map((a) => a[2].method);
    check(contacts.join(",") === "call,text", "Contact events fired on Call and Text taps", contacts.join(","));

    await page.reload();
    check(!(await pixelQueue()).some((a) => a[1] === "Lead"), "Lead does not fire again on thank-you reload");

    await page.goto(BASE + "/services");
    check(events(await pixelQueue()).includes("ViewContent"), "ViewContent fired on services page");

    const l = leads()[0];
    const up = readdirSync(join(dataDir, "uploads"));
    check(l && l.Name === "Test Customer" && l.Mobile === "+12145550123" && l["Job type"] === "Truck load", "lead saved from browser submit");
    check(up.length === 1, "photo stored", up[0] ? `${(photo.length / 1024).toFixed(0)} KB selected -> ${(statSync(join(dataDir, "uploads", up[0])).size / 1024).toFixed(0)} KB uploaded after in-browser resize` : "");

    if (process.env.SCREENSHOT_DIR) {
      const p2 = await ctx.newPage();
      await p2.goto(BASE + "/"); await p2.screenshot({ path: join(process.env.SCREENSHOT_DIR, "home-mobile.png"), fullPage: true });
      await p2.goto(BASE + "/services"); await p2.screenshot({ path: join(process.env.SCREENSHOT_DIR, "services-mobile.png"), fullPage: true });
      const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await desk.goto(BASE + "/"); await desk.screenshot({ path: join(process.env.SCREENSHOT_DIR, "home-desktop.png"), fullPage: true });
    }
    await browser.close();
  }

  // ------------------------------------------------------------------ Part 2
  h("Part 2: server checks over HTTP");
  let r = await postLead(leadForm({ name: "", phone: "555-12", zip: "abc", job_type: "boat", preferred_weekend: "", sms_consent: undefined }));
  const body = await r.json();
  console.log("  Server response to bad data:", r.status, JSON.stringify(body));
  check(r.status === 422 && Object.keys(body.errors).length === 6, "server rejects invalid submission with field errors (422)");

  const big = leadForm(); big.append("photos", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" }));
  r = await postLead(big);
  check(r.status === 422 && (await r.json()).errors.photos, "server rejects photo over 10 MB");

  const before = leads().length;
  r = await postLead(leadForm({ company_website: "http://buy-stuff.example" }));
  check(r.status === 200 && (await r.json()).ok && leads().length === before, "honeypot: bot sees success, nothing saved");

  r = await postLead(leadForm({ name: "Speedy Bot", phone: "2145550177", form_started_at: String(Date.now() - 200) }));
  const fast = leads().at(-1);
  check(r.status === 200 && fast["Spam flag"] === "too_fast" && fast.Status === "Check: possible spam", "too-fast submit saved but marked as possible spam");

  r = await postLead(leadForm({ name: "No Script", phone: "972-555-0142", form_started_at: undefined }), false);
  check(r.status === 303 && r.headers.get("location") === "/thank-you", "no-JavaScript submit gets 303 redirect to /thank-you");
  check(leads().at(-1).Name === "No Script", "no-JavaScript submit saved");

  r = await fetch(BASE + "/api/sms-inbound", { method: "POST" });
  check(r.status === 404, "old texting endpoint is gone (404)");

  h("Local data after the run (what the owner would see)");
  for (const x of leads()) console.log("   ", JSON.stringify({ id: x["Lead ID"], status: x.Status, name: x.Name, mobile: x.Mobile, zip: x.ZIP, job: x["Job type"], weekend: x["Preferred weekend"], photos: x.Photos ? 1 : 0, okToText: x["OK to text"], spam: x["Spam flag"] }));

  // ------------------------------------------------------------------ Part 3
  h("Part 3: production path (Google Sheets + Drive) against a local mock of Google's APIs");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const MOCK = 8791;
  const { server: mock, state } = await startMock({ port: MOCK, publicKey });
  const env = {
    LEAD_STORE: "sheets",
    GOOGLE_SHEET_ID: "sheet123", GOOGLE_SERVICE_ACCOUNT_EMAIL: "lead-writer@test.iam.gserviceaccount.com",
    GOOGLE_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n"),
    GOOGLE_DRIVE_FOLDER_ID: "folder123",
    GOOGLE_TOKEN_URL: `http://localhost:${MOCK}/token`, GOOGLE_SHEETS_API: `http://localhost:${MOCK}`, GOOGLE_DRIVE_UPLOAD_API: `http://localhost:${MOCK}`,
  };
  const quiet = { info() {}, warn() {}, error: console.error };
  const req = (f) => new Request("https://example.com/api/lead", { method: "POST", body: f, headers: { accept: "application/json" } });

  const f = leadForm({ name: "Sheet Test", phone: "(469) 555-0134", zip: "75019", job_type: "estate_cleanout", preferred_weekend: "next_weekend" });
  f.append("photos", new File([new Uint8Array(2048)], "attic.jpg", { type: "image/jpeg" }));
  r = await handleLead(req(f), env, { log: quiet });
  const out = await r.json();
  const row = state.sheets.Leads[0];
  check(out.ok && out.redirect === "/thank-you", "handler returned success + redirect", JSON.stringify(out));
  check(state.tokenRequests >= 1, "service-account JWT accepted by mock token endpoint (signature verified)");
  check(row && row[2] === "New" && row[3] === "Sheet Test" && row[4] === "+14695550134" && row[6] === "Estate or full cleanout", "lead row appended to Leads tab");
  check(state.drive.length === 1 && state.drive[0].parents[0] === "folder123" && row[8].includes("drive.google.com"), "photo uploaded to Drive folder, link in sheet");
  console.log("  Sheet row:", JSON.stringify(row));

  const bad = { ...env, GOOGLE_SHEET_ID: "" };
  r = await handleLead(req(leadForm()), bad, { log: { info() {}, warn() {}, error() {} } });
  const badOut = await r.json();
  check(r.status === 500 && /call/.test(badOut.errors.form), "if the sheet is misconfigured, visitor is told to call or text", badOut.errors.form);
  mock.close();
} finally {
  server.kill();
  execFileSync("node", ["build.mjs"], { cwd: root, stdio: "ignore" }); // rebuild without the test pixel ID
}

console.log(`\n${failures ? `FAILED: ${failures} check(s)` : "ALL CHECKS PASSED"}  (test data in ${dataDir})`);
if (failures) { console.log("\nServer log:\n" + serverLog.join("")); process.exit(1); }
