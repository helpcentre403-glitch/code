// Google APIs via a service account, using only Web standard APIs
// (fetch + Web Crypto). Works in Cloudflare Workers, Netlify Functions and Node 20+.

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
].join(" ");

let cachedToken = null; // { token, exp, key }

function b64url(bytes) {
  let s = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64urlStr = (str) => b64url(new TextEncoder().encode(str));

function pemToDer(pem) {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function googleUrls(env) {
  // Overridable only so the test suite can point at a local mock server.
  return {
    token: env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
    sheets: env.GOOGLE_SHEETS_API || "https://sheets.googleapis.com",
    driveUpload: env.GOOGLE_DRIVE_UPLOAD_API || "https://www.googleapis.com",
  };
}

export async function createSignedJwt(env, nowSec = Math.floor(Date.now() / 1000)) {
  const urls = googleUrls(env);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: SCOPES,
    aud: urls.token,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(env.GOOGLE_PRIVATE_KEY || ""),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

export async function getAccessToken(env) {
  const cacheKey = env.GOOGLE_SERVICE_ACCOUNT_EMAIL + "|" + googleUrls(env).token;
  if (cachedToken && cachedToken.key === cacheKey && cachedToken.exp > Date.now() + 60_000) {
    return cachedToken.token;
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Google service account is not configured (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY).");
  }
  const assertion = await createSignedJwt(env);
  const res = await fetch(googleUrls(env).token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token request failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000, key: cacheKey };
  return cachedToken.token;
}

async function gfetch(env, url, init = {}) {
  const token = await getAccessToken(env);
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Google API ${res.status} on ${url.split("?")[0]}: ${text.slice(0, 300)}`);
  return data;
}

const sheetBase = (env) =>
  `${googleUrls(env).sheets}/v4/spreadsheets/${encodeURIComponent(env.GOOGLE_SHEET_ID || "")}`;

export async function sheetsAppend(env, range, row) {
  const url = `${sheetBase(env)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  // RAW: values are stored exactly as typed, never evaluated as formulas.
  const data = await gfetch(env, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
  return data.updates?.updatedRange || null;
}

export async function sheetsUpdate(env, range, row) {
  const url = `${sheetBase(env)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  return gfetch(env, url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  });
}

export async function sheetsGet(env, range) {
  const data = await gfetch(env, `${sheetBase(env)}/values/${encodeURIComponent(range)}`);
  return data.values || [];
}

export async function sheetsListTabs(env) {
  const data = await gfetch(env, `${sheetBase(env)}?fields=sheets.properties.title`);
  return (data.sheets || []).map((s) => s.properties.title);
}

export async function sheetsAddTab(env, title) {
  return gfetch(env, `${sheetBase(env)}:batchUpdate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
}

/** Upload one file to a Google Drive folder. Returns a link to view it. */
export async function driveUpload(env, file, name) {
  const boundary = "lead" + crypto.randomUUID().replace(/-/g, "");
  const meta = JSON.stringify({ name, parents: [env.GOOGLE_DRIVE_FOLDER_ID] });
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0);
  body.set(bytes, head.length);
  body.set(tail, head.length + bytes.length);
  const url = `${googleUrls(env).driveUpload}/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`;
  const data = await gfetch(env, url, {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
}
