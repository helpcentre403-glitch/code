import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, createVerify } from "node:crypto";
import { normalizeUsPhone, validateLead } from "../lib/validate.mjs";
import { computeTwilioSignature, verifyTwilioSignature, classifyKeyword } from "../lib/twilio.mjs";
import { optedOutFromRows } from "../lib/stores.mjs";
import { createSignedJwt } from "../lib/google.mjs";
import { confirmationText } from "../lib/handlers.mjs";

const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
const good = () => ({ name: "Jane Doe", phone: "(214) 555-0123", zip: "75024", job_type: "truck_load",
  preferred_weekend: "this_saturday", sms_consent: "yes", company_website: "", form_started_at: String(Date.now() - 10_000) });

test("normalizeUsPhone", () => {
  assert.equal(normalizeUsPhone("(214) 555-0123"), "+12145550123");
  assert.equal(normalizeUsPhone("1-214-555-0123"), "+12145550123");
  assert.equal(normalizeUsPhone("555-0123"), null);
  assert.equal(normalizeUsPhone("(114) 555-0123"), null);
});

test("valid lead passes", () => {
  const v = validateLead(fd(good()));
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.spam, null);
  assert.equal(v.lead.phone, "+12145550123");
});

test("every required field is enforced server-side", () => {
  const v = validateLead(fd({}));
  assert.deepEqual(Object.keys(v.errors).sort(), ["job_type", "name", "phone", "preferred_weekend", "sms_consent", "zip"]);
});

test("rejects unknown select values, bad zip, oversize photo, non-image", () => {
  const f = fd({ ...good(), zip: "7502", job_type: "car", preferred_weekend: "monday" });
  f.append("photos", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" }));
  const v = validateLead(f);
  assert.ok(v.errors.zip && v.errors.job_type && v.errors.preferred_weekend && v.errors.photos);
  const f2 = fd(good()); f2.append("photos", new File(["x"], "a.pdf", { type: "application/pdf" }));
  assert.match(validateLead(f2).errors.photos, /image files/);
});

test("spam checks", () => {
  assert.equal(validateLead(fd({ ...good(), company_website: "http://spam" })).spam, "honeypot");
  assert.equal(validateLead(fd({ ...good(), form_started_at: String(Date.now() - 500) })).spam, "too_fast");
  assert.equal(validateLead(fd({ ...good(), form_started_at: "" })).spam, "no_timestamp");
});

test("confirmation text matches the required wording", () => {
  const v = validateLead(fd(good()));
  assert.match(confirmationText(v.lead), /^Hi Jane Doe, thanks for your request with .+\. We'll text you to confirm your Saturday pickup\. Reply STOP to opt out\.$/);
});

test("Twilio signature matches an independent HMAC-SHA1 implementation", async () => {
  const url = "https://example.com/api/sms-inbound";
  const params = { From: "+12145550123", Body: "STOP", To: "+12145550100" };
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", "tok").update(data).digest("base64");
  assert.equal(await computeTwilioSignature("tok", url, params), expected);
  assert.equal(await verifyTwilioSignature("tok", url, params, expected), true);
  assert.equal(await verifyTwilioSignature("tok", url, params, "bad"), false);
});

test("STOP/START keywords", () => {
  for (const w of ["stop", "STOP", " Unsubscribe ", "cancel", "quit", "end", "stopall"]) assert.equal(classifyKeyword(w), "STOP", w);
  assert.equal(classifyKeyword("start"), "START");
  assert.equal(classifyKeyword("please stop by saturday"), null);
  assert.equal(classifyKeyword("whatever", "STOP"), "STOP");
});

test("latest opt status wins", () => {
  const rows = [["t", "+1", "STOP", "s"], ["t", "+2", "STOP", "s"], ["t", "+1", "START", "s"]];
  assert.equal(optedOutFromRows(rows, "+1"), false);
  assert.equal(optedOutFromRows(rows, "+2"), true);
  assert.equal(optedOutFromRows(rows, "+3"), false);
});

test("Google JWT is a valid RS256 signature", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n"); // as stored in env vars
  const jwt = await createSignedJwt({ GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@x.iam.gserviceaccount.com", GOOGLE_PRIVATE_KEY: pem });
  const [h, c, s] = jwt.split(".");
  const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url"));
  assert.equal(ok, true);
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.match(claims.scope, /spreadsheets/);
});
