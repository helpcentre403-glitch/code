// A small local stand-in for Google (OAuth, Sheets, Drive) and Twilio, used only
// by the test suite to exercise the production code paths without real accounts.
// It implements the request/response shapes from the public API docs; passing
// here does NOT prove the real services are configured correctly.
import { createServer } from "node:http";
import { createVerify } from "node:crypto";

export function startMock({ port, publicKey, twilioSid, twilioToken, optedOutNumbers = [] }) {
  const state = { sheets: { Leads: [], OptOuts: [] }, drive: [], sms: [], tokenRequests: 0 };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, `http://localhost:${port}`);
    const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    const authed = () => req.headers.authorization === "Bearer mock-access-token";

    // Google OAuth token: verify the RS256 JWT with the service account public key
    if (url.pathname === "/token" && req.method === "POST") {
      const p = new URLSearchParams(body.toString());
      const [h, c, s] = (p.get("assertion") || "").split(".");
      const ok = p.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer" &&
        createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s || "", "base64url"));
      state.tokenRequests++;
      return ok ? send(200, { access_token: "mock-access-token", expires_in: 3599, token_type: "Bearer" })
        : send(400, { error: "invalid_grant" });
    }

    // Sheets values API
    let m = /^\/v4\/spreadsheets\/[^/]+\/values\/([^:]+)(:append)?$/.exec(url.pathname);
    if (m) {
      if (!authed()) return send(401, { error: "unauthenticated" });
      const range = decodeURIComponent(m[1]);
      const tab = range.split("!")[0];
      const rows = state.sheets[tab];
      if (!rows) return send(400, { error: `Unable to parse range: ${range}` });
      if (m[2] && req.method === "POST") {
        const { values } = JSON.parse(body);
        rows.push(...values);
        const n = rows.length + 1; // row 1 = header
        return send(200, { updates: { updatedRange: `${tab}!A${n}:N${n}`, updatedRows: values.length } });
      }
      if (req.method === "PUT") {
        const { values } = JSON.parse(body);
        const r = /!([A-Z])(\d+):([A-Z])\d+/.exec(range);
        if (r && Number(r[2]) > 1) {
          const row = rows[Number(r[2]) - 2];
          const start = r[1].charCodeAt(0) - 65;
          values[0].forEach((v, i) => { row[start + i] = v; });
        }
        return send(200, { updatedRange: range });
      }
      if (req.method === "GET") return send(200, { range, values: rows });
    }

    // Drive multipart upload
    if (url.pathname === "/upload/drive/v3/files" && req.method === "POST") {
      if (!authed()) return send(401, { error: "unauthenticated" });
      const id = "file" + (state.drive.length + 1);
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/s.exec(body.toString("latin1"))[1]);
      state.drive.push({ id, name: meta.name, parents: meta.parents, bytes: body.length });
      return send(200, { id, webViewLink: `https://drive.google.com/file/d/${id}/view` });
    }

    // Twilio Messages
    m = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/.exec(url.pathname);
    if (m && req.method === "POST") {
      const expected = "Basic " + Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
      if (req.headers.authorization !== expected || m[1] !== twilioSid) return send(401, { code: 20003, message: "Authenticate" });
      const p = Object.fromEntries(new URLSearchParams(body.toString()));
      if (optedOutNumbers.includes(p.To)) return send(400, { code: 21610, message: "Attempt to send to unsubscribed recipient" });
      state.sms.push(p);
      return send(201, { sid: "SM" + String(state.sms.length).padStart(32, "0"), status: "queued" });
    }
    send(404, { error: "not found", path: url.pathname });
  });
  return new Promise((r) => server.listen(port, () => r({ server, state })));
}
