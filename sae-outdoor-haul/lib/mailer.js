'use strict';
/**
 * Owner email alerts (new bookings, "text me this quote" requests).
 *
 * Gmail (simplest): set GMAIL_USER and GMAIL_APP_PASSWORD. The app password is created in the
 * Google Account after turning on 2-Step Verification (Security > App passwords).
 * Any other email provider: set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and MAIL_FROM).
 * Without either, no email is sent; bookings still appear in /admin.
 */
function createMailer(env = process.env, { transport } = {}) {
  let options = null;
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    options = { host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD } };
  } else if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT) || 587;
    options = { host: env.SMTP_HOST, port, secure: port === 465, auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined };
  }
  if (!options && !transport) return null;
  const from = env.MAIL_FROM || env.GMAIL_USER || env.SMTP_USER;
  const t = transport || require('nodemailer').createTransport({ ...options, connectionTimeout: 10000, socketTimeout: 15000 });
  return {
    async send(to, subject, text) {
      // Strip line breaks from the subject so customer text can't add email headers.
      await t.sendMail({ from, to, subject: String(subject).replace(/[\r\n]+/g, ' ').slice(0, 200), text });
      return true;
    },
  };
}

module.exports = { createMailer };
