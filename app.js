// app.js: UI, rate-card storage, and the on-device model (WebLLM).
import { PRESETS, DEFAULT_SETTINGS, buildPrompt, parseReply, extractWithoutAI, priceQuote, replyText, inr } from "./quote.js";

const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/lib/index.js";

const MODELS = {
  gemma: { f16: "gemma-2-2b-it-q4f16_1-MLC", f32: "gemma-2-2b-it-q4f32_1-MLC", label: "Gemma 2 2B" },
  lite: { f16: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", f32: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", label: "Qwen2.5 1.5B" },
};

const EXAMPLES = {
  web: [
    { label: "Bakery", text: "Hi! Got your number from Priya. I run Sweet Tooth Bakes in Velachery. Need a simple website with a home page + menu page + contact, and a logo too if you do that. Want people to order cakes online eventually. Can it be ready before Diwali? Budget is tight 🙏" },
    { label: "Clinic", text: "Hello, this is Dr. Ramesh from Smile Dental Care. We need a landing page for our new Anna Nagar branch with an appointment section, plus someone to write the content. Also need monthly maintenance. Need it live in 5 days." },
  ],
  photo: [
    { label: "Saree shop", text: "Vanakkam! We are Kanchi Silks Online. We need photos of 40 sarees for our Instagram and website, white background is fine. Also 3 reels for Instagram. Can you do it next week?" },
    { label: "Headshots", text: "Hi, our startup (Leafy Labs) wants LinkedIn headshots for 6 people, at our office in Guindy. Sometime this week if possible." },
  ],
  writer: [
    { label: "D2C brand", text: "Hey, I'm Meena from Kaapi Kottai coffee. We need 4 blog posts a month about filter coffee, Instagram captions, and product descriptions for 12 products for our Amazon listing. Can you start in 2 weeks?" },
    { label: "NGO", text: "Hello, we're a small NGO in Tambaram. We need our website about us page written and a monthly email newsletter. Some of it may need to be in Tamil too." },
  ],
};

const $ = (id) => document.getElementById(id);
const state = { webllm: null, engine: null, modelKey: null, gpu: null, busy: false, extracted: null };

// ---------- Settings & rate card (localStorage only) ----------

function loadSettings() {
  const saved = JSON.parse(localStorage.getItem("qc-settings") || "null");
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  if (!Array.isArray(s.items) || !s.items.length) s.items = structuredClone(PRESETS[s.preset]?.items || PRESETS.web.items);
  return s;
}
let settings = loadSettings();
function saveSettings() {
  localStorage.setItem("qc-settings", JSON.stringify(settings));
  $("setup-summary").textContent = `· ${PRESETS[settings.preset]?.label || "Custom"}, ${settings.items.length} services`;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "item";
}

function renderSetup() {
  $("preset").innerHTML = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join("");
  $("preset").value = settings.preset;
  $("business").value = settings.business || "";
  for (const k of ["rushPct", "rushDays", "advancePct", "validDays"]) $(k).value = settings[k];
  $("gst").checked = !!settings.gst;
  renderRates();
  renderExamples();
  saveSettings();
}

function renderRates() {
  $("rates").innerHTML = settings.items
    .map(
      (it, i) => `<tr data-i="${i}">
        <td><input data-k="name" value="${esc(it.name)}" aria-label="Service name" /></td>
        <td><input data-k="unit" value="${esc(it.unit)}" aria-label="Unit" class="unit" /></td>
        <td><input data-k="price" type="number" min="0" step="50" value="${Number(it.price) || 0}" aria-label="Price in rupees" class="price" /></td>
        <td><button type="button" class="x" data-del="${i}" aria-label="Remove">×</button></td>
      </tr>`
    )
    .join("");
}

$("rates").addEventListener("input", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const it = settings.items[Number(tr.dataset.i)];
  const k = e.target.dataset.k;
  it[k] = k === "price" ? Number(e.target.value) || 0 : e.target.value;
  if (k === "name") it.keywords = Array.from(new Set([...(it.keywords || []), ...it.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3)]));
  saveSettings();
  if (state.extracted) renderQuote();
});
$("rates").addEventListener("click", (e) => {
  const i = e.target.dataset.del;
  if (i == null) return;
  settings.items.splice(Number(i), 1);
  renderRates();
  saveSettings();
});
$("add-rate").addEventListener("click", () => {
  const name = prompt("Service name (e.g. 'Brochure design')");
  if (!name) return;
  let id = slug(name);
  while (settings.items.some((x) => x.id === id)) id += "x";
  settings.items.push({ id, name, unit: "item", price: 0, keywords: name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3) });
  renderRates();
  saveSettings();
});
$("preset").addEventListener("change", () => {
  if (!confirm("Switch to the sample rates for this kind of work? Your current rate card will be replaced.")) {
    $("preset").value = settings.preset;
    return;
  }
  settings.preset = $("preset").value;
  settings.items = structuredClone(PRESETS[settings.preset].items);
  renderSetup();
});
$("reset-rates").addEventListener("click", () => {
  if (!confirm("Reset to the sample rates?")) return;
  settings.items = structuredClone(PRESETS[settings.preset].items);
  renderSetup();
});
$("business").addEventListener("input", () => { settings.business = $("business").value.trim(); saveSettings(); if (state.extracted) renderQuote(); });
for (const k of ["rushPct", "rushDays", "advancePct", "validDays"]) {
  $(k).addEventListener("input", () => { settings[k] = Math.max(0, Number($(k).value) || 0); saveSettings(); if (state.extracted) renderQuote(); });
}
$("gst").addEventListener("change", () => { settings.gst = $("gst").checked; saveSettings(); if (state.extracted) renderQuote(); });

function renderExamples() {
  const ex = EXAMPLES[settings.preset] || [];
  $("examples").innerHTML = ex.map((x, i) => `<button type="button" class="ghost small" data-ex="${i}">Try: ${esc(x.label)}</button>`).join("");
}
$("examples").addEventListener("click", (e) => {
  const i = e.target.closest("[data-ex]")?.dataset.ex;
  if (i == null) return;
  $("message").value = EXAMPLES[settings.preset][Number(i)].text;
});

// ---------- Device check & model loading ----------

async function checkGPU() {
  if (!("gpu" in navigator)) return { ok: false, why: "This browser doesn't support WebGPU." };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, why: "No WebGPU adapter was found on this device." };
    return { ok: true, f16: adapter.features.has("shader-f16") };
  } catch (e) {
    return { ok: false, why: "WebGPU is switched off or unavailable." };
  }
}
const modelId = (key) => (state.gpu && state.gpu.f16 ? MODELS[key].f16 : MODELS[key].f32);
const setStatus = (html) => ($("ai-status").innerHTML = html);

async function loadModel(key) {
  if (state.busy) return;
  state.busy = true;
  $("ai-actions").hidden = true;
  const bar = $("ai-progress");
  bar.hidden = false;
  setStatus(`Loading ${MODELS[key].label}… the first time downloads it to this device.`);
  try {
    state.webllm = state.webllm || (await import(WEBLLM_URL));
    state.engine = await state.webllm.CreateMLCEngine(modelId(key), {
      initProgressCallback: (p) => {
        bar.value = p.progress || 0;
        setStatus(`Loading ${MODELS[key].label}: ${Math.round((p.progress || 0) * 100)}%`);
      },
    });
    state.modelKey = key;
    localStorage.setItem("qc-model", key);
    setStatus(`✅ <b>${MODELS[key].label}</b> is running on this device. Client messages never leave it.`);
  } catch (e) {
    console.error(e);
    state.engine = null;
    setStatus(`Couldn't load the model (${esc(String(e.message || e)).slice(0, 140)}). You can still quote with the keyword matcher.`);
    $("ai-actions").hidden = false;
  } finally {
    bar.hidden = true;
    state.busy = false;
  }
}

async function initAI() {
  state.gpu = await checkGPU();
  if (!state.gpu.ok) {
    setStatus(`${state.gpu.why} You'll get quotes from the built-in keyword matcher instead (no AI, still private).`);
    return;
  }
  const saved = localStorage.getItem("qc-model");
  if (saved && MODELS[saved]) {
    try {
      state.webllm = await import(WEBLLM_URL);
      if (await state.webllm.hasModelInCache(modelId(saved))) return loadModel(saved);
    } catch (e) {
      console.warn("Cache check failed", e);
    }
  }
  setStatus("This device can run an AI model locally. Load it once and it stays here. Or quote without it.");
  $("ai-actions").hidden = false;
}

// ---------- Making the quote ----------

async function makeQuote(e) {
  e.preventDefault();
  if (state.busy) return;
  const msg = $("message").value.trim();
  if (!msg) return $("message").focus();
  state.message = msg;
  const fallback = extractWithoutAI(msg, settings.items);

  if (!state.engine) {
    state.extracted = fallback;
    $("source").textContent = "Read by the keyword matcher (no AI). Check the items.";
    return show();
  }

  state.busy = true;
  $("go").disabled = true;
  $("result").hidden = false;
  $("quote").hidden = true;
  $("source").textContent = `${MODELS[state.modelKey].label} is reading the message, on your device…`;
  const out = $("stream");
  out.hidden = false;
  out.textContent = "";
  let text = "";
  try {
    // All instructions go in the user turn: Gemma's chat template has no system role.
    const chunks = await state.engine.chat.completions.create({
      messages: [{ role: "user", content: buildPrompt(msg, settings.items) }],
      temperature: 0.1,
      max_tokens: 320,
      stream: true,
    });
    for await (const c of chunks) {
      text += c.choices[0]?.delta?.content || "";
      out.textContent = text;
    }
    const parsed = parseReply(text, settings.items);
    if (parsed && parsed.items.length) {
      if (!parsed.deadline && fallback.deadline) { parsed.deadline = fallback.deadline; parsed.days = fallback.days; }
      state.extracted = parsed;
      $("source").textContent = `Read by ${MODELS[state.modelKey].label}, on this device. Prices come from your rate card.`;
    } else {
      state.extracted = fallback;
      $("source").textContent = "The model's answer was messy, so the keyword matcher read it instead. Check the items.";
    }
  } catch (err) {
    console.error(err);
    state.extracted = fallback;
    $("source").textContent = "The model hit a snag, so the keyword matcher read it instead.";
  } finally {
    state.busy = false;
    $("go").disabled = false;
    out.hidden = true;
    show();
  }
}

function show() {
  $("result").hidden = false;
  $("quote").hidden = false;
  renderQuote();
  $("result").scrollIntoView({ behavior: "smooth" });
}

function renderQuote() {
  const ex = state.extracted;
  const q = priceQuote(ex, settings.items, settings);
  const today = new Date();
  $("q-meta").textContent = [ex.client ? `For ${ex.client}` : "", today.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), ex.deadline ? `Needed: ${ex.deadline}` : ""].filter(Boolean).join(" · ");
  $("q-from").textContent = settings.business || "";
  $("lines").innerHTML = q.lines.length
    ? q.lines
        .map(
          (l) => `<tr data-id="${l.id}">
        <td>${esc(l.name)}${l.note ? `<br><small>${esc(l.note)}</small>` : ""}</td>
        <td class="num"><input type="number" min="0" step="1" value="${l.qty}" class="qty noprint-input" aria-label="Quantity" /><span class="printonly">${l.qty}</span></td>
        <td class="num">${inr(l.rate)}<br><small>/${esc(l.unit)}</small></td>
        <td class="num">${inr(l.amount)}</td>
        <td class="noprint"><button type="button" class="x" data-rm="${l.id}" aria-label="Remove">×</button></td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="muted">Nothing matched your rate card yet. Add an item below.</td></tr>`;
  const rows = [[`Subtotal`, q.subtotal]];
  if (q.rush) rows.push([`Rush (${settings.rushPct}%, under ${settings.rushDays} days)`, q.rushFee]);
  if (q.gst) rows.push(["GST 18%", q.gst]);
  rows.push([`<b>Total</b>`, q.total]);
  if (settings.advancePct) rows.push([`Advance to start (${settings.advancePct}%)`, q.advance]);
  $("totals").innerHTML = rows.map(([k, v]) => `<tr><td colspan="3" class="num">${k}</td><td class="num">${k.includes("Total") ? `<b>${inr(v)}</b>` : inr(v)}</td><td class="noprint"></td></tr>`).join("");
  $("dropped").hidden = !ex.dropped?.length;
  $("dropped").textContent = ex.dropped?.length ? `Skipped (not on your rate card): ${ex.dropped.join(", ")}` : "";
  $("asks-wrap").hidden = !ex.asks.length;
  $("asks").innerHTML = ex.asks.map((a) => `<li contenteditable="true">${esc(a)}</li>`).join("");
  $("q-terms").textContent = `Valid for ${settings.validDays} days.${settings.gst ? "" : " GST not applicable."}`;
  $("add-line").innerHTML = `<option value="">+ Add an item from your rate card…</option>` + settings.items.map((i) => `<option value="${i.id}">${esc(i.name)} (${inr(i.price)}/${esc(i.unit)})</option>`).join("");
  $("reply").value = replyText(ex, q, settings, today);
  $("whatsapp").href = "https://wa.me/?text=" + encodeURIComponent($("reply").value);
}

$("lines").addEventListener("change", (e) => {
  if (!e.target.classList.contains("qty")) return;
  const id = e.target.closest("tr").dataset.id;
  const item = state.extracted.items.find((x) => x.id === id);
  item.qty = Math.max(0, Number(e.target.value) || 0);
  if (!item.qty) state.extracted.items = state.extracted.items.filter((x) => x.id !== id);
  renderQuote();
});
$("lines").addEventListener("click", (e) => {
  const id = e.target.dataset.rm;
  if (!id) return;
  state.extracted.items = state.extracted.items.filter((x) => x.id !== id);
  renderQuote();
});
$("asks").addEventListener("input", () => {
  state.extracted.asks = [...$("asks").querySelectorAll("li")].map((li) => li.textContent.trim()).filter(Boolean);
  const q = priceQuote(state.extracted, settings.items, settings);
  $("reply").value = replyText(state.extracted, q, settings);
  $("whatsapp").href = "https://wa.me/?text=" + encodeURIComponent($("reply").value);
});
$("add-line").addEventListener("change", () => {
  const id = $("add-line").value;
  if (!id) return;
  const ex = state.extracted.items.find((x) => x.id === id);
  if (ex) ex.qty += 1;
  else state.extracted.items.push({ id, qty: 1, note: "" });
  renderQuote();
});
$("reply").addEventListener("input", () => ($("whatsapp").href = "https://wa.me/?text=" + encodeURIComponent($("reply").value)));
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("reply").value);
    $("copy").textContent = "Copied ✓";
  } catch {
    $("reply").select();
    document.execCommand("copy");
    $("copy").textContent = "Copied ✓";
  }
  setTimeout(() => ($("copy").textContent = "Copy reply"), 1500);
});
$("print").addEventListener("click", () => window.print());

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Wire up ----------

$("form").addEventListener("submit", makeQuote);
$("load-gemma").addEventListener("click", () => loadModel("gemma"));
$("load-lite").addEventListener("click", () => loadModel("lite"));
renderSetup();
if (!localStorage.getItem("qc-settings-seen")) { $("setup").open = true; localStorage.setItem("qc-settings-seen", "1"); }
initAI();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registration failed", e));
}
