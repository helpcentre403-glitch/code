# Junk removal lead-generation website

A fast, mobile-first website for a weekend junk removal business in Dallas-Fort Worth.
Visitors request a quote, and the request is saved to **your** Google Sheet. Google can email
you each time a new lead arrives. You then text or call the customer from your own phone.

**You own everything:** plain HTML/CSS/JS, no website builder, no hosted form service, no texting
service, and no npm dependencies. The site runs on Cloudflare Pages or Netlify and can move to any host.

> Before launch, work through [CHECKLIST.md](CHECKLIST.md). Every placeholder is highlighted in
> yellow on the site, and `npm run build` prints how many are left on each page.

## 0. New to this? Start here

There are three stages. Do them in order.

**Stage 1: Look at the site (nothing to install).**
A private preview link was made for you in the chat. Open it in your browser or on your phone.
The form in the preview does not save anything; it is only for looking.

**Stage 2: Put it on the internet for free (about 30 minutes, no coding).**
1. Make a free account at https://github.com. This is where your website's files live, in your name.
2. Get the files: this project is in the `junk-removal-site` folder of the repository it was built
   in. Download it (green **Code** button > **Download ZIP**) and unzip it. Then on GitHub click
   **+** > **New repository**, name it e.g. `my-junk-site`, create it, click **uploading an existing
   file**, and drag in everything **inside** the `junk-removal-site` folder. Click **Commit changes**.
3. Make a free account at https://dash.cloudflare.com.
4. In Cloudflare, go to **Workers & Pages** > **Create** > **Pages** > **Connect to Git**, pick your repository.
5. Set **Build command** to `npm run build` and **Build output directory** to `dist`. Click **Save and Deploy**.
6. After a minute or two, Cloudflare gives you a free address like `my-junk-site.pages.dev`.
   That is your live website. Open it on your phone.

At this point the site works, but the form cannot save leads until Stage 3 is done.
Until then, people can still tap **Call** and **Text us**.

**Stage 3: Make the form save leads to your Google Sheet.**
Follow section 4 below (about 20 minutes, mostly clicking in Google's website), then add the
values in Cloudflare under your project > **Settings** > **Variables and Secrets**, and redeploy.
Then follow "Get an email for every new lead" in section 4.

Later: buy a domain name (e.g. at Cloudflare, under **Domain Registration**) in your own name and
connect it under your Pages project > **Custom domains**.

Every time you change a file on GitHub, Cloudflare rebuilds the live site automatically.
To change your business details, edit `site.config.mjs` on GitHub (pencil icon) and commit.

---

## 1. Run it on your computer (one command)

You need [Node.js](https://nodejs.org) version 20 or newer.

```bash
npm run dev
```

Then open http://localhost:8788.

In local mode **nothing goes to Google**: leads are saved to `data/leads.jsonl`, and photos to
`data/uploads/`. To test against your real Google Sheet from your computer, copy `.env.example`
to `.env`, fill it in, and set `LEAD_STORE=sheets`.

### Run the tests

```bash
npm test
```

This runs unit tests, then an end-to-end test. The end-to-end test:
1. fills in and submits the form in a real (headless) browser, checking the Meta Pixel events
2. checks server-side validation and spam protection
3. runs the production Google Sheets and Drive code against a local imitation of Google's APIs

Part 1 needs Playwright (`npm i -D playwright && npx playwright install chromium`). It is skipped if
Playwright is not installed. Part 3 proves the code sends correctly shaped requests. It does
**not** prove your real Google account is set up correctly, so do one real test submission after
deploying (see section 7).

---

## 2. Where things live

| What | Where |
|---|---|
| Business name, phone, hours, cities, prices, colors, base URL | `site.config.mjs` |
| Page content | `src/pages/*.html` |
| Header, footer, form, page layout | `src/partials/*.html` |
| Styles / browser script | `src/assets/css/styles.css`, `src/assets/js/main.js` |
| Photos and the social share image | `src/assets/img/` |
| Form handling (validation, saving) | `lib/` |
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
3. Rename the first tab (bottom left) to exactly `Leads`, and type these headers into row 1,
   one per column from A to M: Received (Central), Lead ID, Status, Name, Mobile, ZIP, Job type,
   Preferred weekend, Photos, OK to text, Consent text, Spam flag, Page.
   (If you can run Node on your computer, `npm run setup:sheet` does this step for you.)

Each lead row records: time (Central), lead ID, a **Status** cell that starts as "New" (change it
to Quoted, Booked, Done as you go), name, mobile, ZIP, job type, preferred weekend, photo links,
texting consent and the exact consent wording, any spam flag, and the page. Values are stored as
plain text, never as formulas.

**Get an email for every new lead.** In the Google Sheet, open **Tools** > **Notification
settings** > **Edit notifications**, choose **Any changes are made** and **Email - right away**,
and save. Google then emails your Google account when a row is added. This is a built-in Google
Sheets feature; menu names may vary slightly as Google updates Sheets. Install the Google Sheets
app on your phone to see leads on the go.

**c. Photos (optional)**
Photos are uploaded to a Google Drive folder, and their links go into the sheet. Google service
accounts have no storage of their own, so the folder must be inside a **Shared Drive** (available
on Google Workspace plans). Add the service account to the Shared Drive as a Content manager and
put the folder ID (from its URL) in `GOOGLE_DRIVE_FOLDER_ID`. Without it, the sheet notes that
photos were received but not stored. In that case, ask the customer to text you the photos.
If you don't have Google Workspace, skip this; everything else works.

**d. Alternative: your own database (`LEAD_STORE=webhook`)**
If you would rather keep leads in a database, set `LEAD_STORE=webhook` and point `LEAD_WEBHOOK_URL`
at an endpoint you run, such as a small API on your server in front of Postgres or SQLite. The function
POSTs JSON with the header `x-lead-secret: <LEAD_WEBHOOK_SECRET>`. Check that header, then handle
these payloads by `type`:
- `lead`: `{lead, columns, row}`. Insert it.
- `photo`: `{leadId, index, contentType, dataBase64}`. Store it and return `{"url": "..."}`.

Return HTTP 200. The interface is in `lib/stores.mjs` if you want to add another destination.

---

## 5. Texting customers

The site does not send any texts by itself. When a lead comes in, text or call the customer from
your own business phone. The form's consent box records that they agreed to texts about their quote
and booking. If someone replies STOP, stop texting them and write "STOP" in their row's Status cell.

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

### Option A: Cloudflare Pages (recommended; Stage 2 above is the click-by-click version)
Recommended because uploads up to 100 MB per request are accepted on all plans (Netlify functions
have a ~6 MB request limit, see below).
1. Push this folder to a GitHub or GitLab repo you own.
2. Cloudflare dashboard > **Workers & Pages** > **Create** > **Pages** > connect the repo.
3. Build command: `npm run build`. Build output directory: `dist`. If this project is in a
   subfolder of the repo, set **Root directory** to that folder.
4. **Settings > Variables and Secrets**: add the variables from section 3. Mark tokens and keys
   as encrypted secrets.
5. Deploy. The `functions/` folder becomes the form endpoint `/api/lead` automatically.
6. **Custom domains**: add your domain.
7. On the free plan, Workers have a small CPU-time limit per request. Waiting on Google
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
endpoint in `lib/handlers.mjs` (`handleLead`) takes a standard web `Request`
and return a `Response`, so they can run on any platform that supports that (Deno, Bun, Node 20+,
other serverless hosts). `dev/server.mjs` shows how to wire them up in plain Node.

### After every deploy: one real test
1. Submit the form on the live site with your own cell number.
2. Confirm that a row appears in the **Leads** tab and that the notification email arrives.

---

## 8. How the form works

1. Browser checks every field and shows errors next to each one. Photos are resized in the browser.
2. `POST /api/lead` re-checks everything on the server (never trust the browser).
3. Spam protection:
   - A hidden "honeypot" field: bots that fill it in see a success page, and nothing is saved.
   - A time check: submits within 3 seconds of page load are saved with spam flag `too_fast`, and no
     the Status column says "Check: possible spam".
   - Submits with no timestamp (JavaScript off) are saved with flag `no_timestamp` and handled
     normally. No CAPTCHA is used.
4. Photos are saved, then the lead is saved as a new row.
5. The browser goes to `/thank-you`, where the Pixel `Lead` event fires. Without JavaScript, the
   server answers with a 303 redirect to `/thank-you`.

If saving fails (for example, a wrong sheet ID), the visitor is asked to call or text you instead,
and the full lead is written to the function log (Cloudflare: your project > **Functions** > logs).

There is no rate limiting beyond the spam checks. If you get floods of spam, Cloudflare's free
rate-limiting rules or Turnstile can be added later.
