// Run with: node test.mjs  (tests the parser, fallback and maths; the WebGPU path needs a real browser)
import assert from "node:assert/strict";
import { PRESETS, DEFAULT_SETTINGS, buildPrompt, parseReply, extractWithoutAI, priceQuote, replyText } from "./quote.js";

const items = PRESETS.web.items;
const today = new Date("2026-10-13T10:00:00+05:30");

// 1. Parser keeps only rate-card ids and never trusts model prices.
const reply = `CLIENT: Sweet Tooth Bakes
ITEM: landing | 1 | home page
ITEM: page | two | menu + contact
ITEM: logo | 1 | logo
ITEM: app | 1 | mobile app
DEADLINE: before Diwali
DAYS: 5
ASK: Who will supply the photos and menu text?
ASK: How many cakes should the online shop list?`;
const p = parseReply(reply, items);
assert.equal(p.client, "Sweet Tooth Bakes");
assert.deepEqual(p.items.map((i) => [i.id, i.qty]), [["landing", 1], ["page", 2], ["logo", 1]]);
assert.deepEqual(p.dropped, ["app"]);
assert.equal(p.days, 5);
assert.equal(p.asks.length, 2);

// 2. Maths: subtotal 12000 + 8000 + 6000 = 26000; rush 25% (5 < 7 days) = 6500; total 32500; advance 50%.
const q = priceQuote(p, items, DEFAULT_SETTINGS);
assert.equal(q.subtotal, 26000);
assert.equal(q.rushFee, 6500);
assert.equal(q.total, 32500);
assert.equal(q.advance, 16250);
const qg = priceQuote(p, items, { ...DEFAULT_SETTINGS, gst: true });
assert.equal(qg.gst, 5850);
assert.equal(qg.total, 38350);

// 3. Garbage in -> null, so the app falls back.
assert.equal(parseReply("Sure! Here is a quote for your bakery website...", items), null);

// 4. Fallback keyword matcher.
const f = extractWithoutAI("Hello, we need a landing page for our clinic plus 3 pages and someone to write the content. Need monthly maintenance. Need it live in 5 days.", items, today);
const ids = Object.fromEntries(f.items.map((i) => [i.id, i.qty]));
assert.equal(ids.landing, 1);
assert.equal(ids.page, 3);
assert.ok(ids.copy && ids.care);
assert.equal(f.days, 5);

const fp = extractWithoutAI("We need photos of 40 sarees for our website, white background is fine. Also 3 reels. Next week?", PRESETS.photo.items, today);
const pids = Object.fromEntries(fp.items.map((i) => [i.id, i.qty]));
assert.equal(pids.product, 1); // "40 sarees" isn't directly before the keyword: matcher asks instead
assert.equal(pids.reel, 3);
assert.equal(fp.days, 7);

// 5. Prompt contains the rate card ids but no prices.
const pr = buildPrompt("hi", items, today);
assert.ok(pr.includes("- landing:"));
assert.ok(!pr.includes("12000"));

// 6. Reply text.
const t = replyText(p, q, { ...DEFAULT_SETTINGS, business: "Adib Studio" }, today);
assert.ok(t.includes("₹32,500"));
assert.ok(t.includes("Adib Studio"));
console.log(t);
console.log("\nall tests passed");
