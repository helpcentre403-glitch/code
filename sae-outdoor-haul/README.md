# SAE Outdoor and Haul: lead-generation website

A mobile-first site for a Dallas-Fort Worth business offering junk removal, landscaping, and Christmas tree delivery and installation. Customers fill out a form, get an instant price range, and request or book a time. Each request is saved as a lead for the crew.

**Before launch, work through [CHECKLIST.md](CHECKLIST.md).**

## Run it

```bash
npm install
```

```bash
ADMIN_PASSWORD='choose-a-long-password' npm start
```

Open http://localhost:3000. The admin panel is at http://localhost:3000/admin (user `admin`, password from `ADMIN_PASSWORD`).

## Pages
| URL | What it is |
|---|---|
| `/` | Home: hero, services, FAQ, where we are, contact, footer |
| `/prices` | Three estimate forms (junk removal, landscaping, Christmas trees), each with its own calendar, address, and Generate Estimate button |
| `/thank-you` | "Got it. We'll text you to confirm." with the phone and text line |
| `/privacy`, `/terms` | Templates marked "TODO: have a lawyer review" |
| `/admin` | Owner only: leads, calendar (block/open dates and times), hours, holidays, rates table, business details |

## How an estimate works
1. The server checks the answers. Anything missing or unclear (a blank "What needs to go?", no address, 0 trees) is returned as a question next to that field. The server does not guess.
2. The selected time slot is re-checked against the calendar.
3. Driving distance from the base address is measured. Addresses in a free city (Carrollton) pay $0. Over 20 miles returns a "contact us" message instead of an estimate.
4. `lib/pricing.js` calculates every line from the rates table: base, extras, distance fee, and same-day fee. A rate the owner has not set shows as "To be confirmed" and is left out of the total.
5. Optional AI step (`lib/ai.js`, only when `ANTHROPIC_API_KEY` is set): Claude may ask the customer one clarifying question and writes a short summary. It never sets prices. If its summary contains a dollar amount that is not in the calculated estimate, the summary is discarded and a template is used. If the AI call fails, the template is used too.
6. The lead is saved with all answers. "Text Me This Quote" and "Book This Date" both lead to the thank-you page. Booking takes the slot off the public calendar.

## Configuration (environment variables)
| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Required for /admin |
| `PORT` | Default 3000 |
| `DATA_DIR` | Where `settings.json` and `leads.json` live (default `./data`). Use persistent storage. |
| `GOOGLE_MAPS_API_KEY` | Driving distance via Google Distance Matrix (recommended) |
| `DISTANCE_PROVIDER` | `google`, `osrm` (free OpenStreetMap services, for testing), or `stub` |
| `DISTANCE_STUB` | JSON table for `stub`, e.g. `{"plano":{"miles":14,"city":"Plano"}}` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Text service. Needed for the owner's booking texts and for automatic "Text Me This Quote" |
| `OWNER_NOTIFY_PHONE` | Where booking texts go (10 digits). Defaults to the business phone in admin, (469) 686-4690 |
| `ANTHROPIC_API_KEY` | Optional AI answer check and summary (`ANTHROPIC_MODEL` overrides the model; default `claude-opus-5-5`, with server-side refusal fallback turned on) |
| `TRUST_PROXY` | Set to `1` behind a proxy so rate limiting sees real client IPs |

All rates, fees, hours, holidays, blocked dates, and the base address live in one settings object (`data/settings.json`), which is edited from /admin. Defaults are in `lib/defaults.js`.

## Tests
```bash
npm test
```
```bash
npm run test:e2e
```
`npm test` runs the unit and API tests. `npm run test:e2e` runs the browser tests at phone size (390x844) with Playwright and Chromium. The tests use a fixed "now" (Monday, Dec 7, 2026, noon Dallas time) and a fake distance table. They cover:

- every distance band boundary, the Carrollton free rule, and the over-20-miles message
- each form from start to finish, through booking and the thank-you page
- the calendar hours (weekday evenings, weekends, holidays, the Dec 20 to Jan 6 season, Christmas Eve and Christmas Day, same-day notice, Dallas time zone)
- admin edits to hours, blocked dates and slots, extra opened slots, and rates
- double-booking protection
- AI fallbacks
- no sideways scrolling on phones

## Files
```
server.js          Express app: pages, public API, admin API
lib/defaults.js    Default settings and rates table (null = TODO)
lib/pricing.js     Validation and estimate math
lib/calendar.js    Time slots, blocks, holidays, bookings (America/Chicago)
lib/distance.js    Driving distance providers
lib/ai.js          Optional Claude review and summary, with a price guard
lib/sms.js         Optional Twilio sender
lib/store.js       JSON file storage
views/             HTML pages and shared header/footer
public/            CSS, browser JS, placeholder images (labeled TODO)
test/              Unit, API, and browser tests
```
