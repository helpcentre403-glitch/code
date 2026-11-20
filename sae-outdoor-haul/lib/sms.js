'use strict';
/**
 * "Text Me This Quote". Sends through Twilio when TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
 * TWILIO_FROM are set. Without them, the request is saved on the lead so the crew can text
 * the customer by hand (the customer is told "we'll text it to you").
 * TODO (launch): US business texting from a 10-digit number generally needs A2P 10DLC
 * registration with your SMS provider before messages are delivered reliably.
 */
function createSms({ accountSid, authToken, from, fetchImpl = globalThis.fetch } = {}) {
  if (!accountSid || !authToken || !from) return null;
  return {
    async send(to, body) {
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: `+1${to}`, From: from, Body: body }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
      return true;
    },
  };
}
module.exports = { createSms };
