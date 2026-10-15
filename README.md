# Quote Clerk 🧾

**Client message in, priced quote out.** Paste a client's WhatsApp message or email, and Quote Clerk turns it into a line-item quote from *your own* rate card, plus a ready-to-send reply with the questions you still need answered.

It runs an open-weight model (**Gemma 2 2B Instruct**, or **Qwen2.5 1.5B Instruct** as a lighter option) entirely in your browser with [WebLLM](https://github.com/mlc-ai/web-llm). Client messages and your rates never leave your device. There is no server.

**Live demo:** https://ess-cor.github.io/quote-clerk/

Built for the [Hacktoberfest Open-Source AI Challenge Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12) on DEV.

## Who it's for

Freelancers and one-person studios (web designers, photographers, writers) who get vague requests on WhatsApp ("need a website + logo, before Diwali, budget is tight 🙏") and lose 20 minutes per lead turning them into a quote.

## How it works

1. **Your rate card** lives in `localStorage`: services, unit, price in ₹, rush fee, advance %, optional 18% GST. Three sample cards are included (web, photo, writing).
2. **The model only reads.** The prompt gives it the rate card *ids* (never the prices) and asks for a strict line format: `ITEM: id | qty | note`, `DEADLINE`, `DAYS`, `ASK`.
3. **A parser drops anything that isn't on your rate card**, so the model can't invent a service or a price.
4. **Plain JavaScript does all the money maths** (`priceQuote` in `quote.js`): subtotal, rush fee, GST, advance.
5. You edit quantities, add or remove lines, then copy the reply, open it in WhatsApp, or print/save the quote as a PDF.

No WebGPU? A keyword matcher built on the same rate card fills in a first draft, so the app still works.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The single page |
| `app.js` | UI, rate-card storage, WebLLM model loading and streaming |
| `quote.js` | Presets, prompt, parser, keyword fallback, pricing and reply text (pure functions) |
| `test.mjs` | `node test.mjs` checks the parser, fallback and maths |
| `sw.js` | Service worker: the app opens offline after the first visit |

## Run locally

Any static server works:

```bash
npx serve .
# or
python3 -m http.server 8000
```

WebGPU needs a recent Chrome or Edge (desktop or Android). The first model download is about 1.4 GB (Gemma 2 2B) or about 1 GB (Qwen2.5 1.5B); after that it loads from the browser cache.

## Licence

MIT. Model weights are under their own licences (Gemma Terms of Use; Qwen2.5 under Apache 2.0).
