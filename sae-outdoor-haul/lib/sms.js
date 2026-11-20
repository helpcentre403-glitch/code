'use strict';
/**
 * Text messages through Twilio (booking confirmations to customers who opted in, and optional owner alerts).
 *
 * Needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN, plus one of:
 *  - TWILIO_MESSAGING_SERVICE_SID (recommended): the Messaging Service linked to your approved A2P 10DLC campaign
 *  - TWILIO_FROM: your Twilio phone number, e.g. +14695551234 (must be in that Messaging Service's sender pool)
 * Twilio blocks texts to US numbers until A2P 10DLC registration is approved (error 30034).
 */
function e164(n) {
  const d = String(n || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return String(n || '').trim();
}

function createSms({ accountSid, authToken, from, messagingServiceSid, fetchImpl = globalThis.fetch } = {}) {
  if (!accountSid || !authToken || (!from && !messagingServiceSid)) return null;
  return {
    async send(to, body) {
      const params = new URLSearchParams({ To: e164(to), Body: body });
      if (messagingServiceSid) params.set('MessagingServiceSid', messagingServiceSid);
      else params.set('From', e164(from));
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        let detail = '';
        try { const j = await res.json(); detail = ` (Twilio error ${j.code}: ${j.message})`; } catch { /* no body */ }
        throw new Error(`Twilio HTTP ${res.status}${detail}`);
      }
      return true;
    },
  };
}
module.exports = { createSms, e164 };
