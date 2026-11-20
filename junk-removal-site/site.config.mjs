// ---------------------------------------------------------------------------
// SITE CONFIG: the single place for public business details.
// Anything in [SQUARE BRACKETS] is a placeholder that must be replaced
// before launch. `npm run build` lists every placeholder it still finds.
// Secrets (Twilio, Google keys) do NOT go here. They go in environment
// variables (see .env.example).
// ---------------------------------------------------------------------------

export default {
  business: {
    name: "[BUSINESS NAME]",            // TODO
    phone: "[PHONE]",                   // TODO, e.g. "(214) 555-0100"
    textNumber: "[TEXT NUMBER]",        // TODO, e.g. "(214) 555-0101"
    email: "[EMAIL]",                   // TODO
    hoursText: "[HOURS]",               // TODO, e.g. "Saturday and Sunday, 8 AM to 6 PM"
    // Used for structured data (Google). 24-hour "HH:MM". Leave as-is until
    // confirmed; the build skips the hours in structured data while these are
    // placeholders.
    hours: {
      Saturday: { opens: "[HH:MM]", closes: "[HH:MM]" }, // TODO
      Sunday: { opens: "[HH:MM]", closes: "[HH:MM]" },   // TODO
    },
    // Set to true ONLY if the business is licensed and insured. If false or
    // null, nothing about licensing or insurance is shown anywhere.
    licensedInsured: null,              // TODO: confirm YES/NO
    googleReviewsUrl: "[GOOGLE REVIEW LINK]", // TODO
    region: "Dallas-Fort Worth",
  },

  // Base URL of the live site, no trailing slash. Canonical URLs, Open Graph
  // URLs and sitemap.xml are all built from this. Can be overridden with the
  // SITE_URL environment variable at build time.
  baseUrl: "https://example.com",       // TODO: your real domain

  // Meta Pixel ID. Leave empty to disable the pixel. The META_PIXEL_ID
  // environment variable overrides this value at build time.
  metaPixelId: "",

  // One accent color (forest green) for buttons and highlights. Text color on
  // the accent is picked automatically for contrast. `accentOnDark` is a lighter
  // shade of the same green, used for small text on black backgrounds.
  accentColor: "#2E5E3A",
  accentOnDark: "#9DC4A3",

  serviceArea: [
    "Plano", "Frisco", "Irving", "Richardson", "Garland", "Carrollton",
    "Farmers Branch", "Addison", "Lewisville", "Denton", "Coppell",
    "Flower Mound",
  ],

  // Items NOT accepted. Placeholder list until the owner confirms.
  notAccepted: [
    "[CONFIRM: refrigerants (e.g. fridges or AC units with freon)]",
    "[CONFIRM: tires]",
    "[CONFIRM: hazardous materials (paint, chemicals, fuel, asbestos)]",
  ],

  pricing: {
    startingAt: "[STARTING PRICE]",     // TODO, e.g. "$X for a single item"
    policyText: "[PRICING TEXT, or \"quote confirmed before pickup\" if that is the policy]", // TODO
  },

  // Form options. `value` is what is stored; `label` is what people see.
  jobTypes: [
    { value: "single_item", label: "Single item" },
    { value: "few_items", label: "A few items" },
    { value: "truck_load", label: "Truck load" },
    { value: "estate_cleanout", label: "Estate or full cleanout" },
    { value: "not_sure", label: "Not sure" },
  ],
  weekends: [
    { value: "this_saturday", label: "This Saturday" },
    { value: "this_sunday", label: "This Sunday" },
    { value: "next_weekend", label: "Next weekend" },
    { value: "flexible", label: "Flexible" },
  ],

  upload: {
    maxFiles: 5,
    maxBytesEach: 10 * 1024 * 1024, // 10 MB
  },

  // Minimum seconds between page load and submit. Faster = treated as a bot.
  minSecondsToSubmit: 3,

  consentText:
    "I agree to receive texts about my quote and booking. Consent is not required to buy.",
};
