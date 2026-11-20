# Launch checklist

Every placeholder that needs real content before launch. Placeholders show on the site
highlighted in yellow. Run `npm run build`: it prints how many are left on each page and
warns about config placeholders. **Do not launch until it reports none.**

## A. Business details: `site.config.mjs`
- [ ] `business.name`: [BUSINESS NAME]
- [ ] `business.phone`: [PHONE] (Call buttons use it as a tap-to-call link)
- [ ] `business.textNumber`: [TEXT NUMBER] (Text buttons use an `sms:` link).
- [ ] `business.email`: [EMAIL]
- [ ] `business.hoursText`: [HOURS] (weekends only)
- [ ] `business.hours.Saturday` / `.Sunday` `opens`/`closes` in 24-hour `HH:MM` (used for Google structured data; skipped until set)
- [ ] `business.licensedInsured`: set `true` **only** if licensed and insured. Otherwise leave it as is; nothing is shown.
- [ ] `business.googleReviewsUrl`: [GOOGLE REVIEW LINK]
- [ ] `baseUrl`: your real domain (or set `SITE_URL` in the host's environment variables)
- [ ] `notAccepted`: confirm or replace the 3 items marked [CONFIRM: ...] (refrigerants, tires, hazardous materials)
- [ ] `pricing.startingAt`: [STARTING PRICE]
- [ ] `pricing.policyText`: [PRICING TEXT], or "Quote confirmed before pickup." if that is the policy (shown on the homepage and in the Terms)
- [ ] `accentColor` / `accentOnDark`: forest green by default; keep or change

## B. Homepage: `src/pages/index.html`
- [ ] Before and after photos: 2 pairs. Replace `placeholder-before.svg` / `placeholder-after.svg` with real, compressed photos (JPG or WEBP, about 1200px wide, under 200 KB). No stock photos.
- [ ] Alt text for each photo (4 × "TODO: describe the ... photo")
- [ ] 2 × [BEFORE AND AFTER CAPTION: job type and city]
- [ ] 3 × [REVIEW QUOTE] + 3 × [FIRST NAME, CITY]: real reviews only, with the customer's permission
- [ ] "What we take": confirm or edit the 6 [CONFIRM: ...] items
- [ ] Pricing: confirm [CONFIRM: items with extra disposal fees ...]. Also check that the 3 general price factors (space in truck, heavy/bulky items, access) are true for you.
- [ ] FAQ: write all 10 answers (each says "TODO: answer")
- [ ] About: owner photo (`placeholder-owner.svg`), its alt text (owner's name), and [OWNER STORY]
- [ ] Hero copy: confirm "Send a few details, get your quote by text, and pick a weekend pickup time."
- [ ] "How it works" steps: confirm wording

## C. Services page: `src/pages/services.html`
- [ ] 5 service photos (`placeholder-service.svg`) and their 5 alt texts
- [ ] 5 [CONFIRM: ...] detail lines (single items, a few items, truck size, estate cleanout scope, yard waste accepted)
- [ ] Confirm the one-line description of each service

## D. Legal: `src/pages/privacy.html`, `src/pages/terms.html`
- [ ] **TODO: have a lawyer review** both pages
- [ ] Privacy: [DATE], [CONFIRM: any other tools], [CONFIRM LIST] of service providers, [RETENTION PERIOD], [MAILING ADDRESS OR CITY, TX]
- [ ] Terms: [DATE], 4 × [CONFIRM: ...] (final price, prohibited items in a load, customer responsibilities, governing law), [LIABILITY TERMS]
- [ ] Remove the yellow "TODO: have a lawyer review" banner once reviewed
- [ ] Confirm the form's fine print ("Msg & data rates may apply. Reply STOP to opt out.") with your lawyer

## E. Images and branding: `src/assets/img/`
- [ ] `og-image.png`: replace with a 1200×630 image (your truck, team, or a real job) for link previews on Facebook/text messages
- [ ] `favicon.svg`: optional; replace with your logo

## F. Accounts and environment variables (see README sections 3 to 6)
- [ ] Domain bought in **your** name, with registrar login in your control
- [ ] Hosting account (Cloudflare or Netlify) in your name, repo connected
- [ ] Google Cloud project + service account; sheet created with a `Leads` tab and header row, shared with the service account
- [ ] Google Sheet email notifications turned on (README section 4)
- [ ] (Optional) Shared Drive folder for photos → `GOOGLE_DRIVE_FOLDER_ID`
- [ ] Meta Pixel ID → `META_PIXEL_ID`, then redeploy
- [ ] All variables from `.env.example` set in the host dashboard (secrets marked as encrypted)

## G. Before going live
- [ ] `npm run build` reports no placeholders and no warnings
- [ ] `npm test` passes
- [ ] Live test (README section 7): submit the form, see the row in the sheet, get the notification email
- [ ] Meta Events Manager "Test events" shows PageView, Lead, Contact, ViewContent
- [ ] Submit `https://yourdomain.com/sitemap.xml` in Google Search Console
- [ ] Check the site on a real phone: tap Call, tap Text, submit with a photo
