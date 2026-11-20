// Local dev server: serves dist/ and runs the same lead / SMS handlers the
// serverless functions use. Start with `npm run dev`.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync } from "node:fs";
import { loadEnv } from "./load-env.mjs";
import { handleLead, handleSmsInbound } from "../lib/handlers.mjs";
import { localStore } from "./local-store.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();
const env = { ...process.env };
// Safe local defaults: no real texts, leads saved to ./data
env.SMS_MODE ??= "log";
env.LEAD_STORE ??= "local";
const dataDir = env.LOCAL_DATA_DIR || join(root, "data");
mkdirSync(dataDir, { recursive: true });
env.__onLoggedSms = ({ to, body }) =>
  appendFileSync(join(dataDir, "sms-outbox.jsonl"), JSON.stringify({ time: new Date().toISOString(), to, body }) + "\n");
const store = env.LEAD_STORE === "local" ? localStore(dataDir) : undefined; // undefined -> sheets/webhook from env

const PORT = Number(env.PORT || 8788);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".xml": "application/xml", ".txt": "text/plain", ".json": "application/json" };

async function toWebRequest(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 60 * 1024 * 1024) throw new Error("too large"); chunks.push(c); }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  return new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
}

async function sendWeb(res, r) {
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let p = decodeURIComponent(url.pathname);
  if (p.includes("..")) { res.writeHead(400); return res.end(); }
  const candidates = p.endsWith("/") ? [p + "index.html"] : [p, p + ".html"];
  for (const c of candidates) {
    const f = join(root, "dist", c);
    try {
      if ((await stat(f)).isFile()) {
        res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" });
        return res.end(await readFile(f));
      }
    } catch {}
  }
  res.writeHead(404, { "content-type": TYPES[".html"] });
  res.end(await readFile(join(root, "dist", "404.html")));
}

createServer(async (req, res) => {
  try {
    const path = req.url.split("?")[0];
    if (path === "/api/lead") return sendWeb(res, await handleLead(await toWebRequest(req), env, { store }));
    if (path === "/api/sms-inbound") return sendWeb(res, await handleSmsInbound(await toWebRequest(req), env, { store }));
    return serveStatic(req, res);
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end("Server error");
  }
}).listen(PORT, () => {
  console.log(`Site running at http://localhost:${PORT}  (LEAD_STORE=${env.LEAD_STORE}, SMS_MODE=${env.SMS_MODE})`);
  if (env.LEAD_STORE === "local") console.log(`Leads are saved in ${dataDir}/leads.jsonl, texts in ${dataDir}/sms-outbox.jsonl`);
});
