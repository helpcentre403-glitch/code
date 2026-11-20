# Junk removal lead-generation website

A fast, mobile-first website for a weekend junk removal business in Dallas-Fort Worth.
Visitors request a quote; the lead is saved to **your** Google Sheet, the customer gets a
confirmation text from **your** Twilio number, and you get a text alert.

**You own everything:** plain HTML/CSS/JS, no website builder, no hosted form service, and no
npm dependencies. The site runs on Cloudflare Pages or Netlify and can move to any host.

> Before launch, work through [CHECKLIST.md](CHECKLIST.md). Every placeholder is shown on the
> site highlighted in pink, and `npm run build` prints how many are left on each page.

---

## 1. Run it on your computer (one command)

You need [Node.js](https://nodejs.org) version 20 or newer.

```bash
npm run dev
```

Then open http://localhost:8788.

In local mode **no real texts are sent and nothing goes to Google**:
- leads are saved to `data/leads.jsonl`, and photos to `data/uploads/`
- texts are written to `data/sms-outbox.jsonl` and printed in the terminal instead of being sent

To test against your real Google Sheet and Twilio from your computer, copy `.env.example` to
`.env`, fill it in, and set `LEAD_STORE=sheets` and `SMS_MODE=live`.

### Run the tests

```bash
npm test
```

This runs unit tests, then an end-to-end test. The end-to-end test:
1. fills in and submits the form in a real (headless) browser, checking the Meta Pixel events
2. checks server-side validation, spam protection, and STOP/START handling
3. runs the production Google Sheets, Drive, and Twilio code against a local imitation of those APIs

Part 1 needs Playwright (`npm i -D playwright && npx playwright install chromium`). It is skipped if
Playwright is not installed. Part 3 proves the code sends correctly shaped requests. It does
**not** prove your real accounts are set up correctly, so do one real test submission after
deploying (see section 7).

---

## 2. Where things live

| What | Where |
|---|---|
| Business name, phone, hours, cities, prices, accent color, base URL | `site.config.mjs` |
| Page content | `src/pages/*.html` |
| Header, footer, form, page layout | `src/partials/*.html` |
| Styles / browser script | `src/assets/css/styles.css`, `src/assets/js/main.js` |
| Photos and the social share image | `src/assets/img/` |
| Form handling (validation, saving, texting) | `lib/` |
| Cloudflare adapters | `functions/api/` |
| Netlify adapters | `netlify/functions/` |
| Build output (do not edit; regenerated) | `dist/` |

`npm run build` turns `src/` and `site.config.mjs` into the finished site in `dist/`. It also
generates `sitemap.xml`, `robots.txt`, canonical URLs, Open Graph tags, and the LocalBusiness
structured data, all from the one base URL in the config.

---

## 3. Environment variables (secrets)

Secrets never go in the code or the browser. Set them in your host's dashboard (or in `.env` for
local use). `.env.example` lists every variable with placeholder values. `.env` is git-ignored.

| Variable | Needed for | Example / notes |
|---|---|---|
| `SITE_URL` | build | `https://yourdomain.com`. Overrides `baseUrl` in the config |
| `META_PIXEL_ID` | build | digits only; empty = pixel off |
| `LEAD_STORE` | functions | `sheets` (default) or `webhook` |
| `GOOGLE_SHEET_ID` | sheets | the long ID in the sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | sheets | from the service account JSON (`client_email`) |
| `GOOGLE_PRIVATE_KEY` | sheets | from the JSON (`private_key`), keeping the `\n` sequences |
| `GOOGLE_DRIVE_FOLDER_ID` | photos (optional) | folder in a **Shared Drive**, see 4c |
| `LEAD_WEBHOOK_URL`, `LEAD_WEBHOOK_SECRET` | webhook store | see 4d |
| `SMS_MODE` | functions | `live` (default) or `log` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | texting | Twilio Console home page |
| `TWILIO_FROM_NUMBER` *or* `TWILIO_MESSAGING_SERVICE_SID` | texting | your Twilio number in `+1...` format, or a Messaging Service |
| `TWILIO_WEBHOOK_URL` | STOP handling | `https://yourdomain.com/api/sms-inbound`, exactly as entered in Twilio |
| `OWNER_ALERT_PHONE` | owner alerts | your cell, `+1...` |

`SITE_URL` and `META_PIXEL_ID` are read **at build time**. After you change them, redeploy.

---

## 4. Google Sheets setup (default lead destination)

All leads go into a Google Sheet in your own Google account.

**a. Create a service account (a "robot" Google user that can write to your sheet)**
1. Go to https://console.cloud.google.com and create a project (any name).
2. In "APIs & Services" > "Library", enable **Google Sheets API**. If you want photo uploads,
   also enable **Google Drive API**.
3. In "IAM & Admin" > "Service Accounts", click **Create service account** and name it, e.g.
   `lead-writer`. No roles are needed.
4. Open it, go to **Keys** > **Add key** > **Create new key** > **JSON**. A file downloads.
   Treat it like a password and never commit it.
5. From that file, copy `client_email` into `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key`
   into `GOOGLE_PRIVATE_KEY`.

**b. Create the sheet**
1. Create a new Google Sheet. Copy the ID from its URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit` and use it as `GOOGLE_SHEET_ID`.
2. Click **Share** and add the service account email as an **Editor**.
3. On your computer, with `.env` filled in, run `npm run setup:sheet`. This creates two tabs,
   **Leads** and **OptOuts**, with header rows.

Each lead row records: time (Central), lead ID, name, mobile, ZIP, job type, preferred weekend,
photo links, SMS consent and the exact consent wording, whether the confirmation text and owner
alert were sent, any spam flag, and the page. Values are stored as plain text, never as formulas.

**c. Photos (optional)**
Photos are uploaded to a Google Drive folder, and their links go into the sheet. Google service
accounts have no storage of their own, so the folder must be inside a **Shared Drive** (available
on Google Workspace plans). Add the service account to the Shared Drive as a Content manager and
put the folder ID (from its URL) in `GOOGLE_DRIVE_FOLDER_ID`. Without it, the sheet notes that
photos were received but not stored. In that case, ask the customer to text you the photos.

**d. Alternative: your own database (`LEAD_STORE=webhook`)**
If you would rather keep leads in a database, set `LEAD_STORE=webhook` and point `LEAD_WEBHOOK_URL`
at an endpoint you run, such as a small API on your server in front of Postgres or SQLite. The function
POSTs JSON with the header `x-lead-secret: <LEAD_WEBHOOK_SECRET>`. Check that header, then handle
these payloads by `type`:
- `lead`: `{lead, columns, row}`. Insert it.
- `lead_status`: `{leadId, confirmation, ownerAlert}`. Update it.
- `photo`: `{leadId, index, contentType, dataBase64}`. Store it and return `{"url": "..."}`.
- `opt_check`: `{phone}`. Return `{"optedOut": true|false}`.
- `opt_status`: `{phone, status: "STOP"|"START", source, time}`. Insert it.

Return HTTP 200. The interface is in `lib/stores.mjs` if you want to add another destination.

---

## 5. Twilio setup (texting)

1. Create a Twilio account at https://www.twilio.com and buy a local DFW phone number with SMS.
2. **Register for US texting (required).** US carriers block business texts from regular
   (10-digit) numbers unless the brand and campaign are registered ("A2P 10DLC") in the Twilio
   Console under Messaging > Regulatory Compliance. A toll-free number needs toll-free verification
   instead. Approval can take days or weeks, so start early. Reviewers usually check that your
   website shows the opt-in wording and has a privacy policy covering texting. Both are on this
   site, but the policy needs your real details first.
3. Copy the Account SID and Auth Token into `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`, and the
   number into `TWILIO_FROM_NUMBER` (or use a Messaging Service and set
   `TWILIO_MESSAGING_SERVICE_SID`).
4. **STOP handling:** in the Twilio Console, open your number (or Messaging Service). Under
   "A message comes in", set **Webhook**, `HTTP POST`, URL `https://yourdomain.com/api/sms-inbound`.
   Put the exact same URL in `TWILIO_WEBHOOK_URL`. The site checks Twilio's signature on every
   request and rejects anything that does not come from your Twilio account.

How opt-outs work:
- Twilio's built-in opt-out handling also blocks texts to anyone who replied STOP and sends them
  the standard confirmation. That is Twilio's default behavior on US numbers.
- In addition, the webhook writes every STOP / START reply to the **OptOuts** tab. Before sending a
  confirmation text, the site checks that tab and skips anyone whose latest status is STOP. If Twilio
  itself rejects a send because the person opted out (error 21610), that is recorded too.
- Any other text a customer sends to the Twilio number is forwarded to `OWNER_ALERT_PHONE`, so if
  you advertise the Twilio number as your text line, you won't miss messages. To reply, text the
  customer from the number they texted. Replying to the forwarded message reaches the Twilio number,
  not the customer.

The confirmation text sent to customers:

> Hi {name}, thanks for your request with {business name}. We'll text you to confirm your {Saturday | Sunday | next-weekend | weekend} pickup. Reply STOP to opt out.

The weekend wording comes from `weekends[].smsPhrase` in `site.config.mjs`.

---

## 6. Meta Pixel setup

1. In Meta Events Manager, create (or open) a dataset/pixel and copy its numeric ID.
2. Set `META_PIXEL_ID` in your host's environment variables (or `metaPixelId` in
   `site.config.mjs`) and redeploy. The build writes it into `assets/js/pixel.js`. With no ID,
   no Meta code loads at all.

Events sent:
| Event | When |
|---|---|
| `PageView` | every page |
| `Lead` | on the thank-you page, only right after a successful form submit (with the lead ID as `eventID`); not on refresh |
| `Contact` | tapping any Call or Text link (`method: call` / `text`) |
| `ViewContent` | services page |

Check that they arrive with Meta's "Test events" tool or the Meta Pixel Helper browser extension.

---

## 7. Deploy

Both hosts read their settings from files in this repo (`wrangler.toml`, `netlify.toml`, `src/_headers`).

### Option A: Cloudflare Pages (recommended)
Recommended because uploads up to 100 MB per request are accepted on all plans (Netlify functions
have a ~6 MB request limit, see below).
1. Push this folder to a GitHub or GitLab repo you own.
2. Cloudflare dashboard > **Workers & Pages** > **Create** > **Pages** > connect the repo.
3. Build command: `npm run build`. Build output directory: `dist`. If this project is in a
   subfolder of the repo, set **Root directory** to that folder.
4. **Settings > Variables and Secrets**: add the variables from section 3. Mark tokens and keys
   as encrypted secrets.
5. Deploy. The `functions/` folder becomes `/api/lead` and `/api/sms-inbound` automatically.
6. **Custom domains**: add your domain.
7. On the free plan, Workers have a small CPU-time limit per request. Waiting on Google and Twilio
   does not count toward it, but I have not measured this code against it. Check the function logs
   after your first real leads.

### Option B: Netlify
1. Push to a repo you own. Netlify > **Add new site** > **Import an existing project**.
2. `netlify.toml` sets the build (`npm run build`, publish `dist`, functions in `netlify/functions`).
   If this project is in a subfolder, set **Base directory** to that folder.
3. **Site configuration > Environment variables**: add the variables from section 3.
4. Deploy, then add your domain under **Domain management**.
5. Netlify functions accept request bodies up to about 6 MB. The form shrinks photos in the browser
   before upload (typically to a few hundred KB each), so this is normally fine. A visitor with
   JavaScript turned off who uploads large originals could exceed it.

### Option C: any other host
`dist/` is a plain static site. It expects clean URLs (`/services` serves `services.html`). The two
endpoints in `lib/handlers.mjs` (`handleLead`, `handleSmsInbound`) take a standard web `Request`
and return a `Response`, so they can run on any platform that supports that (Deno, Bun, Node 20+,
other serverless hosts). `dev/server.mjs` shows how to wire them up in plain Node.

### After every deploy: one real test
1. Submit the form on the live site with your own cell number.
2. Confirm that a row appears in the **Leads** tab, you receive the confirmation text, and the owner
   alert arrives.
3. Reply STOP to the confirmation. A STOP row should appear in **OptOuts**. Reply START to undo it.

---

## 8. How the form works

1. Browser checks every field and shows errors next to each one. Photos are resized in the browser.
2. `POST /api/lead` re-checks everything on the server (never trust the browser).
3. Spam protection:
   - A hidden "honeypot" field: bots that fill it in see a success page, and nothing is saved.
   - A time check: submits within 3 seconds of page load are saved with spam flag `too_fast`, and no
     texts are sent.
   - Submits with no timestamp (JavaScript off) are saved with flag `no_timestamp` and handled
     normally. No CAPTCHA is used.
4. Photos are saved, then the lead is saved.
5. The owner alert and the confirmation text are sent (the confirmation is skipped if the number
   opted out). The sheet row is updated with the result of each.
6. The browser goes to `/thank-you`, where the Pixel `Lead` event fires. Without JavaScript, the
   server answers with a 303 redirect to `/thank-you`.

If saving the lead fails, the owner alert still goes out with the full details, so the lead is not
lost. If both fail, the visitor is asked to call or text.

There is no rate limiting beyond the spam checks. If you get floods of spam, Cloudflare's free
rate-limiting rules or Turnstile can be added later.
