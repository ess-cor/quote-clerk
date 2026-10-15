// quote.js: rate cards, the prompt, the parser, the no-AI fallback and the money maths.
// Pure functions only (no DOM), so it can be tested in Node:  node test.mjs
//
// The split that matters: the model only READS the client's message and maps it onto
// the freelancer's own rate card. It never sets a price. Every rupee is computed here,
// in plain JavaScript, from numbers the freelancer typed in.

export const PRESETS = {
  web: {
    label: "Web designer / developer",
    business: "",
    items: [
      { id: "landing", name: "Landing page (1 page, responsive)", unit: "page", price: 12000, keywords: ["landing", "one page", "single page", "home page", "homepage"] },
      { id: "page", name: "Extra inner page", unit: "page", price: 4000, keywords: ["page", "pages", "about us", "contact", "menu", "gallery", "services page"] },
      { id: "shop", name: "Online shop setup (up to 20 products)", unit: "shop", price: 25000, keywords: ["online shop", "online store", "ecommerce", "e-commerce", "cart", "sell online", "order online", "orders online", "order cakes online", "payment gateway"] },
      { id: "logo", name: "Logo design (3 concepts, 2 revisions)", unit: "logo", price: 6000, keywords: ["logo", "branding", "brand mark"] },
      { id: "copy", name: "Copywriting", unit: "page", price: 1500, keywords: ["content", "copy", "text", "write"] },
      { id: "seo", name: "Basic SEO setup", unit: "site", price: 3500, keywords: ["seo", "google search", "rank"] },
      { id: "hosting", name: "Domain + hosting setup", unit: "setup", price: 2500, keywords: ["domain", "hosting", "host", "go live"] },
      { id: "care", name: "Monthly maintenance", unit: "month", price: 2000, keywords: ["maintenance", "maintain", "updates", "monthly", "support"] },
    ],
  },
  photo: {
    label: "Photographer",
    business: "",
    items: [
      { id: "product", name: "Product photo (edited, white background)", unit: "photo", price: 350, keywords: ["product", "products", "catalog", "catalogue", "amazon", "white background"] },
      { id: "halfday", name: "Half-day shoot (4 hours)", unit: "shoot", price: 9000, keywords: ["half day", "half-day", "4 hours", "morning shoot"] },
      { id: "fullday", name: "Full-day shoot (8 hours)", unit: "shoot", price: 16000, keywords: ["full day", "full-day", "whole day", "wedding", "event"] },
      { id: "portrait", name: "Portrait session (1 hour, 10 edits)", unit: "session", price: 4500, keywords: ["portrait", "headshot", "profile photo", "linkedin"] },
      { id: "edit", name: "Extra edited photo", unit: "photo", price: 250, keywords: ["edit", "edited", "retouch", "extra photos"] },
      { id: "reel", name: "Short reel (up to 30 s)", unit: "reel", price: 3000, keywords: ["reel", "reels", "video", "instagram video"] },
      { id: "travel", name: "Travel outside city", unit: "trip", price: 1500, keywords: ["outside", "travel", "outstation", "pondicherry", "mahabalipuram"] },
    ],
  },
  writer: {
    label: "Content writer",
    business: "",
    items: [
      { id: "blog", name: "Blog post (~1,000 words, SEO)", unit: "post", price: 2500, keywords: ["blog", "article", "post", "posts", "articles"] },
      { id: "webcopy", name: "Website copy", unit: "page", price: 3000, keywords: ["website", "web copy", "landing", "home page", "about us"] },
      { id: "social", name: "Social media captions (pack of 10)", unit: "pack", price: 1800, keywords: ["caption", "captions", "instagram", "social", "linkedin posts"] },
      { id: "product", name: "Product description", unit: "product", price: 300, keywords: ["product description", "listing", "amazon", "flipkart", "products"] },
      { id: "newsletter", name: "Email newsletter", unit: "issue", price: 2000, keywords: ["newsletter", "email", "mailer"] },
      { id: "translate", name: "English ↔ Tamil translation", unit: "500 words", price: 900, keywords: ["tamil", "translate", "translation"] },
    ],
  },
};

export const DEFAULT_SETTINGS = {
  preset: "web",
  business: "",
  rushPct: 25, // added when the client's deadline is under the rush threshold
  rushDays: 7,
  gst: false, // 18% GST, only if the freelancer is registered
  advancePct: 50,
  validDays: 15,
};

// ---------- Prompt ----------

export function buildPrompt(message, items, today = new Date()) {
  const card = items.map((i) => `- ${i.id}: ${i.name} (per ${i.unit})`).join("\n");
  return `You help a freelancer turn a client's message into a quote.
Read the client's message and map what they want onto the freelancer's rate card.

RATE CARD (use ONLY these ids):
${card}

RULES:
- Only list work the client actually asked for. Do not upsell.
- Use the closest id. If something they asked for is not on the rate card, do NOT list it as an item; ask about it instead.
- QTY is a number. If the client did not say how many, use 1 and ask.
- Ask about anything missing that changes the price (how many, deadline, who supplies content). At most 3 questions.
- Do not write any prices.
- Today is ${today.toDateString()}.

Answer in EXACTLY this format and nothing else:
CLIENT: <client or business name, or unknown>
ITEM: <id> | <qty> | <short note>
ITEM: <id> | <qty> | <short note>
DEADLINE: <deadline in the client's words, or none>
DAYS: <whole days from today until the deadline, or none>
ASK: <question for the client>
ASK: <question for the client>

CLIENT MESSAGE:
"""
${message.trim().slice(0, 2500)}
"""`;
}

// ---------- Parser ----------

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100 };

function toQty(s) {
  const t = String(s || "").trim().toLowerCase();
  const m = t.match(/\d+(\.\d+)?/);
  if (m) return Math.max(0, Math.min(10000, Number(m[0])));
  for (const [w, n] of Object.entries(NUM_WORDS)) if (t.includes(w)) return n;
  return 1;
}

// Returns { client, items:[{id,qty,note}], deadline, days, asks:[] } or null when unusable.
export function parseReply(text, items) {
  const ids = new Set(items.map((i) => i.id));
  const out = { client: "", items: [], deadline: "", days: null, asks: [], dropped: [] };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/^[\s*>#-]+/, "").replace(/\*\*/g, "").trim();
    const m = line.match(/^(CLIENT|ITEM|DEADLINE|DAYS|ASK)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const val = m[2].trim();
    if (key === "CLIENT") out.client = /^unknown|none|n\/a$/i.test(val) ? "" : val.slice(0, 80);
    else if (key === "DEADLINE") out.deadline = /^none|unknown|n\/a$/i.test(val) ? "" : val.slice(0, 80);
    else if (key === "DAYS") {
      const d = val.match(/\d+/);
      out.days = d ? Number(d[0]) : null;
    } else if (key === "ASK") {
      if (val && out.asks.length < 3) out.asks.push(val.slice(0, 200));
    } else if (key === "ITEM") {
      const [idRaw, qtyRaw, ...rest] = val.split("|");
      const id = String(idRaw || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (!ids.has(id)) {
        out.dropped.push(String(idRaw || "").trim()); // model invented an id: never price it
        continue;
      }
      const qty = toQty(qtyRaw);
      if (!qty) continue;
      const existing = out.items.find((i) => i.id === id);
      if (existing) existing.qty += qty;
      else out.items.push({ id, qty, note: rest.join("|").trim().slice(0, 120) });
    }
  }
  if (!out.items.length && !out.asks.length) return null;
  return out;
}

// ---------- No-AI fallback: keyword matching ----------

export function extractWithoutAI(message, items, today = new Date()) {
  const text = " " + String(message || "").toLowerCase().replace(/\s+/g, " ") + " ";
  const found = [];
  // Longer, more specific keywords first, so "landing page" wins over "page".
  const pairs = [];
  for (const it of items) for (const k of it.keywords || []) pairs.push({ it, k: k.toLowerCase() });
  pairs.sort((a, b) => b.k.length - a.k.length);
  const used = [];
  for (const { it, k } of pairs) {
    // Every non-overlapping occurrence of this keyword.
    let from = 0;
    let idx;
    while ((idx = text.indexOf(k, from)) >= 0) {
      from = idx + k.length;
      // whole words only ("page" must not match inside "pages" twice, "seo" not inside "seoul")
      if (/[a-z0-9]/.test(text[idx - 1] || "") || /[a-z0-9]/.test(text[idx + k.length] || "")) continue;
      if (used.some(([s, e]) => idx < e && idx + k.length > s)) continue; // overlaps a stronger match
      const near = used.some(([s, e, id]) => id === it.id && (Math.abs(idx - e) <= 2 || Math.abs(s - (idx + k.length)) <= 2)); // "menu page" is one page
      used.push([idx, idx + k.length, it.id]);
      // Look for a quantity just before the keyword: "5 pages", "twenty products", "3 x reels".
      const before = text.slice(Math.max(0, idx - 24), idx);
      const q = before.match(/(\d+)\s*(?:x\s*)?(?:[a-z]+\s)?$/) || before.match(new RegExp(`\\b(${Object.keys(NUM_WORDS).join("|")})\\s+(?:[a-z]+\\s)?$`));
      const qty = q ? toQty(q[1]) : 1;
      const f = found.find((x) => x.id === it.id);
      if (!f) found.push({ id: it.id, qty: qty || 1, counted: !!q, note: `matched “${k}”` });
      else if (it.unit === "page" && !f.counted && !q && !near) { f.qty += 1; f.note += `, “${k}”`; } // "menu page + contact page"
    }
  }
  for (const f of found) delete f.counted;
  const dl = findDeadline(text, today);
  const asks = [];
  if (!found.length) asks.push("Could you tell me a bit more about what you need, so I can quote accurately?");
  if (!dl.deadline) asks.push("When do you need this by?");
  if (found.some((f) => f.qty === 1 && !/\d/.test(f.note))) asks.push("Roughly how many of each do you need?");
  return { client: "", items: found, deadline: dl.deadline, days: dl.days, asks: asks.slice(0, 3), dropped: [] };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function findDeadline(text, today = new Date()) {
  const t = String(text).toLowerCase();
  let m;
  if (/\b(today|tonight|asap|urgent|urgently)\b/.test(t)) return { deadline: "ASAP", days: 1 };
  if (/\btomorrow\b/.test(t)) return { deadline: "tomorrow", days: 1 };
  if ((m = t.match(/\b(?:in|within)\s+(\d+|a|one|two|three|four)\s+(day|days|week|weeks)\b/))) {
    const n = m[1] === "a" ? 1 : toQty(m[1]);
    const days = /week/.test(m[2]) ? n * 7 : n;
    return { deadline: m[0], days };
  }
  if (/\bnext week\b/.test(t)) return { deadline: "next week", days: 7 };
  if (/\bthis week\b/.test(t)) return { deadline: "this week", days: Math.max(1, 6 - today.getDay()) };
  if (/\bnext month\b/.test(t)) return { deadline: "next month", days: 30 };
  if ((m = t.match(/\b(?:by|before|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
    let d = (WEEKDAYS.indexOf(m[1]) - today.getDay() + 7) % 7;
    if (d === 0) d = 7;
    return { deadline: m[0], days: d };
  }
  if (/\b(diwali|deepavali)\b/.test(t)) return { deadline: "before Diwali", days: null };
  if (/\bpongal\b/.test(t)) return { deadline: "before Pongal", days: null };
  return { deadline: "", days: null };
}

// ---------- Money ----------

export function priceQuote(extracted, items, settings) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const lines = extracted.items
    .filter((x) => byId[x.id])
    .map((x) => {
      const it = byId[x.id];
      const qty = Math.round(Number(x.qty) * 100) / 100;
      return { id: x.id, name: it.name, unit: it.unit, qty, rate: Number(it.price) || 0, amount: Math.round(qty * (Number(it.price) || 0)), note: x.note || "" };
    });
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const rush = extracted.days != null && extracted.days > 0 && extracted.days < settings.rushDays && settings.rushPct > 0;
  const rushFee = rush ? Math.round((subtotal * settings.rushPct) / 100) : 0;
  const taxable = subtotal + rushFee;
  const gst = settings.gst ? Math.round(taxable * 0.18) : 0;
  const total = taxable + gst;
  const advance = Math.round((total * settings.advancePct) / 100);
  return { lines, subtotal, rush, rushFee, gst, total, advance, balance: total - advance };
}

export function inr(n) {
  return "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
}

// ---------- The message back to the client ----------

export function replyText(extracted, q, settings, today = new Date()) {
  const name = extracted.client ? ` ${extracted.client}` : "";
  const biz = settings.business ? `\n— ${settings.business}` : "";
  const valid = new Date(today.getTime() + settings.validDays * 864e5).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const parts = [];
  parts.push(`Hi${name}, thanks for reaching out! Here's my quote:`);
  parts.push(q.lines.map((l) => `• ${l.name} × ${l.qty}: ${inr(l.amount)}`).join("\n"));
  if (q.rush) parts.push(`Rush delivery (${extracted.deadline || "under " + settings.rushDays + " days"}): +${settings.rushPct}% = ${inr(q.rushFee)}`);
  if (q.gst) parts.push(`GST 18%: ${inr(q.gst)}`);
  parts.push(`Total: ${inr(q.total)}${settings.advancePct ? ` (${settings.advancePct}% advance, ${inr(q.advance)}, to start)` : ""}`);
  if (extracted.asks.length) parts.push("A few quick questions so I can confirm:\n" + extracted.asks.map((a, i) => `${i + 1}. ${a}`).join("\n"));
  parts.push(`This quote is valid till ${valid}.${biz}`);
  return parts.join("\n\n");
}
