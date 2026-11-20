// Build: renders src/ into dist/ using site.config.mjs and environment variables.
// No dependencies. Run with `npm run build`.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import config from "./site.config.mjs";
import { loadEnv } from "./dev/load-env.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const SRC = join(root, "src");
const DIST = join(root, "dist");
loadEnv();

// ---------- settings from config + env ----------
const baseUrl = (process.env.SITE_URL || config.baseUrl).replace(/\/+$/, "");
const pixelId = (process.env.META_PIXEL_ID ?? config.metaPixelId ?? "").trim();
if (pixelId && !/^\d{5,20}$/.test(pixelId)) {
  console.error(`META_PIXEL_ID must be digits only, got "${pixelId}"`);
  process.exit(1);
}
const b = config.business;
const isPlaceholder = (s) => typeof s !== "string" || /\[[^\]]+\]/.test(s) || s.trim() === "";

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const digits = (s) => String(s).replace(/\D/g, "");
function e164(s) {
  let d = digits(s);
  if (d.length === 10) d = "1" + d;
  return d.length === 11 ? "+" + d : "";
}
function luminance(hex) {
  const n = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
const contrast = (a, b2) => { const [x, y] = [luminance(a), luminance(b2)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || "") ? v : d);
const accent = hex(config.accentColor, "#2E5E3A");
const accentOnDark = hex(config.accentOnDark, "#9DC4A3");
const inkDark = "#111111";
const accentInk = contrast(accent, inkDark) >= contrast(accent, "#ffffff") ? inkDark : "#ffffff";
const accentInkRatio = contrast(accent, accentInk).toFixed(2);

const telHref = e164(b.phone) ? `tel:${e164(b.phone)}` : "tel:TODO-PHONE";
const smsHref = e164(b.textNumber) ? `sms:${e164(b.textNumber)}` : "sms:TODO-TEXT-NUMBER";
const mailHref = isPlaceholder(b.email) ? "mailto:TODO-EMAIL" : `mailto:${b.email}`;
const area = config.serviceArea;
const areaShort = `${area[0]}, ${area[1]} and across ${b.region}`;

// ---------- page definitions ----------
const pages = [
  {
    file: "index.html", path: "/",
    title: `Weekend Junk Removal in ${area[0]}, ${area[1]} & ${b.region} | ${b.name}`,
    description: `${b.name} hauls away junk on weekends in ${area.slice(0, 5).join(", ")} and nearby ${b.region} cities. Send a few details and get a free quote by text.`,
    sitemap: true,
  },
  {
    file: "services.html", path: "/services",
    title: `Junk Removal Services: Single Items to Full Cleanouts | ${b.name}`,
    description: `Single items, a few items, truck loads, estate cleanouts, garage and yard cleanouts across ${b.region}. Weekend pickups from ${b.name}.`,
    sitemap: true, pixelEvent: "ViewContent",
  },
  {
    file: "thank-you.html", path: "/thank-you",
    title: `Thanks, we got your request | ${b.name}`,
    description: `Your junk removal quote request was received. ${b.name} will text you to confirm your pickup time.`,
    noindex: true, page: "thank-you",
  },
  {
    file: "privacy.html", path: "/privacy",
    title: `Privacy Policy | ${b.name}`,
    description: `How ${b.name} collects, uses and protects information submitted through this website.`,
    sitemap: true,
  },
  {
    file: "terms.html", path: "/terms",
    title: `Terms of Service | ${b.name}`,
    description: `Terms for using the ${b.name} website and requesting junk removal quotes in ${b.region}.`,
    sitemap: true,
  },
  {
    file: "404.html", path: "/404",
    title: `Page not found | ${b.name}`,
    description: `This page does not exist. Get a free junk removal quote from ${b.name} in ${b.region}.`,
    noindex: true, noCanonical: true,
  },
];

// ---------- structured data ----------
function jsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: b.name,
    url: baseUrl + "/",
    image: baseUrl + "/assets/img/og-image.png",
    telephone: e164(b.phone) || b.phone,
    areaServed: area.map((c) => ({ "@type": "City", name: `${c}, TX` })),
    description: `Weekend junk removal in ${b.region}.`,
  };
  if (!isPlaceholder(b.email)) data.email = b.email;
  const hours = Object.entries(b.hours || {})
    .filter(([, h]) => /^\d{2}:\d{2}$/.test(h.opens) && /^\d{2}:\d{2}$/.test(h.closes))
    .map(([day, h]) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: `https://schema.org/${day}`, opens: h.opens, closes: h.closes }));
  if (hours.length) data.openingHoursSpecification = hours;
  else warnings.push("Structured data: opening hours skipped (business.hours are still placeholders).");
  if (!isPlaceholder(b.googleReviewsUrl)) data.sameAs = [b.googleReviewsUrl];
  return JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
}

// ---------- template engine: {{ path }} escaped, {{{ path }}} raw, {{> partial }} ----------
const warnings = [];
function lookup(ctx, path) {
  const v = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
  if (v === undefined) throw new Error(`Template variable not found: ${path}`);
  return v;
}
function render(tpl, ctx) {
  return tpl
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => render(readFileSync(join(SRC, "partials", `${name}.html`), "utf8"), ctx))
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, p) => String(lookup(ctx, p)))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => esc(lookup(ctx, p)));
}
// Wrap visible placeholders ("[...]" and "TODO...") in <mark> inside <body> text (not scripts).
function highlightTodos(html) {
  const [head, body] = html.split(/<body/);
  const out = ("<body" + body).replace(/(<script[\s\S]*?<\/script>)|>([^<]+)</g, (m, script, text) => {
    if (script) return script;
    const t = text.replace(/(\[[^\]<>]+\]|TODO(?::[^.<\]]*)?)/g, '<mark class="todo">$1</mark>');
    return ">" + t + "<";
  });
  return head + out;
}

const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("\n");
const options = (arr) => arr.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("\n");

const ctx = {
  b,
  year: new Date().getFullYear(),
  baseUrl,
  telHref, smsHref, mailHref,
  areaShort,
  areaFirst: area[0],
  cityList: li(area),
  notAcceptedList: li(config.notAccepted),
  jobTypeOptions: options(config.jobTypes),
  weekendOptions: options(config.weekends),
  consentText: config.consentText,
  pricing: config.pricing,
  maxFiles: config.upload.maxFiles,
  maxBytes: config.upload.maxBytesEach,
  licensedLine: config.business.licensedInsured === true ? `<p class="badge-line">Licensed and insured</p>` : "",
  reviewsHref: isPlaceholder(b.googleReviewsUrl) ? "#TODO-google-reviews-link" : b.googleReviewsUrl,
};

// ---------- build ----------
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(SRC, "assets"), join(DIST, "assets"), { recursive: true });

// Theme: accent color from config, prepended to the stylesheet (no inline styles needed).
const css = readFileSync(join(SRC, "assets/css/styles.css"), "utf8");
writeFileSync(join(DIST, "assets/css/styles.css"), `:root{--accent:${accent};--accent-ink:${accentInk};--accent-on-dark:${accentOnDark}}\n` + css);

// Meta Pixel: generated file with the ID baked in at build time (not in the HTML source).
const pixelJs = pixelId
  ? `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${pixelId}');
fbq('track','PageView');
(function(){var ev=document.body&&document.body.getAttribute('data-pixel-event');if(ev)fbq('track',ev,{content_name:document.title});})();\n`
  : `/* Meta Pixel disabled: set META_PIXEL_ID (env) or metaPixelId (site.config.mjs) and rebuild. */\n`;
writeFileSync(join(DIST, "assets/js/pixel.js"), pixelJs);
if (!pixelId) warnings.push("Meta Pixel is disabled (no META_PIXEL_ID).");

const layout = readFileSync(join(SRC, "partials/layout.html"), "utf8");
for (const p of pages) {
  const pageCtx = {
    ...ctx,
    title: p.title,
    description: p.description,
    canonicalTag: p.noCanonical ? "" : `<link rel="canonical" href="${esc(baseUrl + p.path)}">`,
    ogUrl: baseUrl + (p.noCanonical ? "/" : p.path),
    robots: p.noindex ? "noindex, follow" : "index, follow",
    bodyAttrs: [p.pixelEvent ? `data-pixel-event="${p.pixelEvent}"` : "", p.page ? `data-page="${p.page}"` : ""].join(" ").trim(),
    jsonLd: p.file === "index.html" ? `<script type="application/ld+json">\n${jsonLd()}\n</script>` : "",
    noscriptPixel: pixelId ? `<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${pixelId}&amp;ev=PageView&amp;noscript=1"></noscript>` : "",
  };
  pageCtx.content = render(readFileSync(join(SRC, "pages", p.file), "utf8"), pageCtx);
  const html = highlightTodos(render(layout, pageCtx));
  writeFileSync(join(DIST, p.file), html);
}

// sitemap.xml + robots.txt
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pages.filter((p) => p.sitemap).map((p) => `  <url><loc>${esc(baseUrl + p.path)}</loc><lastmod>${today}</lastmod></url>`).join("\n") +
  `\n</urlset>\n`);
writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nDisallow: /thank-you\nDisallow: /api/\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
cpSync(join(SRC, "_headers"), join(DIST, "_headers"));

// ---------- report ----------
const report = [];
for (const f of readdirSync(DIST).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(DIST, f), "utf8");
  const n = (html.match(/<mark class="todo">/g) || []).length;
  if (n) report.push(`  ${f}: ${n} visible placeholder(s)`);
}
if (baseUrl === "https://example.com") warnings.push("baseUrl is still https://example.com (set SITE_URL or site.config.mjs baseUrl).");
console.log(`Built ${pages.length} pages into dist/  (base URL: ${baseUrl}, pixel: ${pixelId || "off"}, accent ${accent} with ${accentInk} text, contrast ${accentInkRatio}:1)`);
if (report.length) console.log("Placeholders still on the site (see CHECKLIST.md):\n" + report.join("\n"));
for (const w of warnings) console.log("WARNING: " + w);
