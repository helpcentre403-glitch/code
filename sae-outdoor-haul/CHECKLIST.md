# Launch checklist: SAE Outdoor and Haul

Open items are at the top. Everything you confirmed is listed under **Done** at the bottom for reference. Most settings can be changed in **/admin** without touching code.

## Still open

### Content
- [ ] **Christmas tree purchase price**: set to an estimate of **$60+ per tree** (any size), as you asked. Estimates include it with a "+" and tell the customer you'll let them know the exact price. When you know real prices, change them per size in Admin → Rates.
- [ ] **Long carry fee**: not priced yet. It shows as "To be confirmed".
- [ ] **Photos**: four placeholders in `public/img/` are labeled "TODO: REAL PHOTO". Use your own photos, or free stock photos whose license allows business use (for example Unsplash or Pexels). Don't copy images from Google search results; most are copyrighted.
- [ ] **FAQ answers**: I drafted these because you asked me to write them. Check that they match how you actually work:
  - What don't you take? (hazardous materials; tires, paint, and heavy materials handled case by case)
  - Do I need to be home? (not for curbside, lawn, or tree drop-offs; yes for jobs inside)
  - How do I pay? (payment due when the job is done; options confirmed by text). Add your actual payment methods.
- [ ] **Privacy and Terms**: you said a lawyer reviewed them, so the "have a lawyer review" banners are removed. These blanks still need text:
  - Privacy: SMS provider, web host, data retention period, SMS opt-out wording
  - Terms: cancellation and rescheduling policy, customer responsibilities, liability and insurance

### Decisions to confirm
- [ ] **Inside/Outside rule**: the map's city overrides the customer's button (your choice). Check a few addresses near the Carrollton city limits once the Google key is on.
- [ ] **Free Carrollton rule**: an address gets $0 when the map service says its city is Carrollton. Check a few addresses near the city edges once the Google key is on.
- [ ] **Service-area list**: it still names Denton, Frisco, and Lewisville. With the new 20-mile limit, some addresses in those cities, possibly most of Denton, may be over 20 driving miles from central Carrollton. I can't confirm the exact distances. Remove cities you can't reach in Admin → Business details.
- [ ] **Words that trigger notes**: tires, paint, and chemicals add a "we'll confirm before pickup" line; concrete, dirt, and roofing add a "weight-based quote" line. Neither adds a price. These came from your first brief; your new list didn't mention them.
- [ ] **Calendar defaults**: 1-hour arrival windows, booking up to 21 days ahead, 2 hours' notice for same-day jobs, one booking per time slot across all services.
- [ ] **Holiday dates for 2028 and later**: add them in Admin → Hours before late 2027.

### Hosting
- [ ] **Booking emails (set up first)**: the moment a customer taps Book This Date, the site emails Helpcentre403@gmail.com with who booked, their phone and email, the address, the date and time, the job, and the estimate. To turn it on:
  1. In your Google Account, turn on **2-Step Verification**.
  2. In Google Account > Security, create an **App password** for the website.
  3. On the web host, set `GMAIL_USER=Helpcentre403@gmail.com` and `GMAIL_APP_PASSWORD=<the 16-character app password>`. Never put it in the code.
  4. In the Gmail app on your phone, turn on notifications so each booking alerts you.
  Google's menus may be worded differently than this; I can't confirm their current layout.
- [ ] **Admin password**: set `ADMIN_PASSWORD` on the server where the site runs. It is deliberately not saved in the code repository. An 8-digit number is weak for a page on the open internet. The admin page locks a visitor out for 15 minutes after 10 wrong passwords, but a longer password is safer.
- [ ] `GOOGLE_MAPS_API_KEY` for driving distances. The code uses Google's Distance Matrix API. Google has been moving customers to its newer Routes API, so confirm Distance Matrix can be enabled on your Google Cloud project. Without a key, the site uses free OpenStreetMap servers, which are only suitable for testing.
- [ ] **Text service (Twilio)**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. This is what lets the site **text you at (469) 686-4690 every time someone books** (who, when, address, the job, and the estimate). It also sends "Text Me This Quote" to customers automatically. Without it, no texts go out, and bookings only show on your admin page. US business texting generally requires A2P 10DLC registration first. Twilio charges per message; check their current pricing.
- [ ] Optional: `ANTHROPIC_API_KEY` for the AI answer check and summary.
- [ ] Choose a host with a **persistent disk** for `DATA_DIR`, serve the site over HTTPS, set `TRUST_PROXY=1` if the app runs behind a proxy, and back up `DATA_DIR`.
- [ ] Domain name, logo, and a Google Business Profile listing that points to the site.

## Done (from the owner's answers)
- Phone and text line: (469) 686-4690 (confirmed, same number)
- Email: Helpcentre403@gmail.com
- Base: Carrollton, TX. Customers tap **Inside of Carrollton** (no distance fee) or **Outside of Carrollton** (flat $10, up to 20 driving miles; over 20 gets the contact-us message). When the map knows the city, the map decides and any mismatch is shown to the customer and flagged on the lead
- Junk removal:
  - $100 minimum per job, applied to the whole job total
  - The trailer load is used only when no single items or cleanout are chosen
  - All load, item, cleanout, and extra prices entered; "+" removed from Over full load, Construction debris, and House
- Same-day fee: $40, offered only when today still has open times
- Landscaping and Christmas tree service fees entered
- Holidays (Saturday and Sunday hours, 10 AM to 9 PM):
  - Thanksgiving 2026 and 2027
  - Dec 20 to Jan 6 both seasons, which covers New Year's Day
  - MLK Day, Presidents Day, Memorial Day, Juneteenth, July 4 and its observed day, Labor Day, and Veterans Day in 2027
- Christmas Eve 10 AM to 4 PM; closed Christmas Day (2026 and 2027)
