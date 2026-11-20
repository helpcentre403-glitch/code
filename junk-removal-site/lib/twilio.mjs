// Twilio SMS via the REST API (no SDK). Uses the owner's own Twilio account.

export function twilioApiBase(env) {
  // Overridable only so the test suite can point at a local mock server.
  return env.TWILIO_API_BASE || "https://api.twilio.com";
}

/**
 * Send one SMS. Returns { status: "sent" | "logged" | "opted_out" | "failed" | "not_configured", sid?, error? }.
 * SMS_MODE=log prints the message instead of sending (local development).
 */
export async function sendSms(env, to, body, { log = console } = {}) {
  if ((env.SMS_MODE || "live") === "log") {
    log.info?.(`[sms:log] to=${to}\n${body}`);
    if (env.__onLoggedSms) await env.__onLoggedSms({ to, body });
    return { status: "logged" };
  }
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token } = env;
  const from = env.TWILIO_FROM_NUMBER;
  const svc = env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || (!from && !svc)) return { status: "not_configured", error: "Twilio env vars missing" };

  const params = new URLSearchParams({ To: to, Body: body });
  if (svc) params.set("MessagingServiceSid", svc);
  else params.set("From", from);

  try {
    const res = await fetch(`${twilioApiBase(env)}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: "Basic " + btoa(`${sid}:${token}`),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { status: "sent", sid: data.sid };
    // 21610: recipient has replied STOP (Twilio blocks the send).
    if (data.code === 21610) return { status: "opted_out", error: data.message };
    return { status: "failed", error: `${res.status} ${data.code || ""} ${data.message || ""}`.trim() };
  } catch (e) {
    return { status: "failed", error: String(e?.message || e) };
  }
}

/**
 * Verify X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)).
 */
export async function computeTwilioSignature(authToken, url, params) {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const k of keys) data += k + params[k];
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}

export async function verifyTwilioSignature(authToken, url, params, signature) {
  if (!authToken || !signature) return false;
  const expected = await computeTwilioSignature(authToken, url, params);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// Twilio's default opt-out / opt-in keywords (case-insensitive, whole message).
export const STOP_WORDS = ["STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"];
export const START_WORDS = ["START", "UNSTOP", "YES"];

export function classifyKeyword(body, optOutType) {
  if (optOutType === "STOP") return "STOP";
  if (optOutType === "START") return "START";
  const t = String(body || "").trim().toUpperCase().replace(/[.!]+$/, "");
  if (STOP_WORDS.includes(t)) return "STOP";
  if (START_WORDS.includes(t)) return "START";
  return null;
}
