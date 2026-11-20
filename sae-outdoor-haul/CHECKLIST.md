# Launch checklist: SAE Outdoor and Haul

Everything below needs real content or a decision before launch. Most items are edited in **/admin** (no code changes). On the live site, placeholders show as a yellow `[TODO: ...]` tag. In the admin rates table, prices that are not set show "(TODO)".

## 1. Business details (Admin → Business details)
- [ ] **Text line**: currently the same as the phone, (469) 686-4690. Confirm this number can receive texts, or enter the separate text number.
- [ ] **Email**: not set. It shows `[TODO: EMAIL]` on the Contact section, Privacy, and Terms.
- [ ] **Base address**: set to `Carrollton, TX` (the owner said "center of Carrollton"). The map service turns this into one point it chooses; I cannot confirm which point. Enter a specific street address if you want distances measured from an exact spot.
- [ ] **Free distance in Carrollton**: any address whose map-service city is "Carrollton" gets a $0 distance fee. Check a few Carrollton addresses near the city limits (some have Dallas or Farmers Branch mailing addresses) once the Google key is on.
- [ ] **FAQ "What don't you take?"**: `[CONFIRM LIST]`
- [ ] **FAQ "Do I need to be home?"**: `[CONFIRM]`
- [ ] **FAQ "How do I pay?"**: `[CONFIRM PAYMENT METHODS]`

## 2. Rates table (Admin → Rates)
- [ ] Distance fee, 0 to 9 miles: `$[TODO]`
- [ ] Distance fee, 10 to 15 miles: `$[TODO]`
- [ ] Distance fee, 16 to 20 miles: `$[TODO]`
- [ ] Distance fee, 21 to 25 miles: `$[TODO]`
- [ ] Long carry fee: `$[TODO]`
- [ ] Christmas tree price: `$[TREE PRICE]`. There is one box per size (small, medium, large). If one price covers every size, enter it in all three.
- [ ] Review every other amount. All of them came from your brief.

Until an amount is set, the estimate shows that line as **"To be confirmed"** and leaves it out of the total. The site never fills in a number on its own.

## 3. Hours and calendar (Admin → Hours / Calendar)
- [ ] **Holiday dates**: `[OWNER SETS DATES]`. Holidays use the holiday hours (default 10:00 AM to 9:00 PM).
- [ ] Confirm these defaults, which I chose because the brief didn't specify them:
  - Time slots are **1-hour arrival windows**.
  - Customers can book **21 days ahead**.
  - Same-day slots need **2 hours' notice**.
  - **One booking per time slot across all three services** (assumes one crew).

## 4. Pricing rules I had to decide (change in `lib/pricing.js` if wrong)
- [ ] **Distance bands**: driving miles are rounded to the nearest whole mile before choosing a band (9.4 → 0–9 band, 9.6 → 10–15 band, 25.4 → 21–25 band, 25.5 and over → "contact us").
- [ ] **Junk base price**: if the customer picks a trailer load, the base is the load price, and any items or cleanout are saved for the crew but not added. If no load is picked, the base is the items plus the cleanout.
- [ ] **$100 minimum service charge** is applied to the junk **base price** only (not to extras or the distance fee).
- [ ] **Same-day fee** ($40) applies to **junk removal only** and is added automatically when the customer picks today's date.
- [ ] "Elevated (upper floor or stairs)" adds the **Stairs or difficult access** charge. I added two optional checkboxes, "Very heavy items" and "Needs disassembly", so the Heavy lifting and Disassembly charges in your rates table can be selected.
- [ ] Words like tires, paint, chemicals, or batteries add a "we'll confirm before pickup" line. Concrete, dirt, roofing, or bricks add a "weight-based quote" line.
- [ ] **Out-of-area requests** (over 25 miles) are still saved as leads so you can follow up.

## 5. Photos and branding (`public/img/`)
- [ ] `todo-hero.svg`: photo of the crew and trailer
- [ ] `todo-junk.svg`: junk removal photo
- [ ] `todo-landscaping.svg`: landscaping photo
- [ ] `todo-trees.svg`: Christmas tree photo
- [ ] Logo: the header uses the business name and a plain star. Replace it with a real logo if you have one.

## 6. Legal (`views/privacy.html`, `views/terms.html`)
- [ ] **TODO: have a lawyer review** both pages. They are templates, not legal advice.
- [ ] Fill in: last-updated dates, the names of the map, SMS, AI, and hosting providers, the data retention period, cancellation and rescheduling policy, customer responsibilities, liability and insurance, and SMS opt-out wording.

## 7. Services and hosting (environment variables; see README)
- [ ] `ADMIN_PASSWORD`: required, or /admin stays disabled. Use a long password.
- [ ] `GOOGLE_MAPS_API_KEY`: needed for reliable driving distances. The code uses Google's Distance Matrix API. Google has been moving customers to its newer Routes API, so confirm that Distance Matrix can be enabled on your Google Cloud project. Without a key, the site uses free OpenStreetMap servers, which have strict usage limits and are only suitable for testing.
- [ ] Optional: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` to send "Text Me This Quote" automatically. Without them, the request is flagged on the lead and the crew texts the customer by hand. US business texting from a 10-digit number generally requires A2P 10DLC registration with the provider first.
- [ ] Optional: `ANTHROPIC_API_KEY` turns on the AI answer check and summary. Without it, the site uses a fixed template summary. Prices are calculated the same way either way.
- [ ] Host on a server with a **persistent disk** for `DATA_DIR` (leads and settings are saved in JSON files there). Serve over HTTPS. Set `TRUST_PROXY=1` when the app runs behind a proxy or load balancer.
- [ ] Back up `DATA_DIR` regularly.
- [ ] Domain name, and a Google Business Profile listing that points to the site.
