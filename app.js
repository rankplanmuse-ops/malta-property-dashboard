"use strict";
/* Malta Property Dashboard (standalone). Vanilla JS + Supabase (optional config). */

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

const cfg = window.APP_CONFIG || {};
let sb = null;
if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
  try { sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); } catch (e) { sb = null; }
}

const GUEST_KEY = "mpd-guest-votes-v1";
let LISTINGS = Array.isArray(window.LISTINGS) ? window.LISTINGS.slice() : [];
let user = null;
let votes = loadGuestVotes();
let undoStack = [];
let tab = "rent";
let viewMode = "deck";
let page = "home";
let deckIdx = 0;

const MODEL_DEFAULTS = { nightly: 48, occ: 70, fee: 15, wifi: 20, licence: 130, linen: 40, util: 100 };
const FILTER_DEFAULTS = { town: "", sort: "rent-asc", island: "", source: "", verdict: "", maxRent: 14000, owner: false, waonly: false };
let filters = Object.assign({}, FILTER_DEFAULTS);
let model = Object.assign({}, MODEL_DEFAULTS);

function loadGuestVotes() {
  try { return JSON.parse(localStorage.getItem(GUEST_KEY)) || {}; } catch (e) { return {}; }
}
function saveGuestVotes() {
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(votes)); } catch (e) {}
}

const fmtEUR = (n) => "EUR " + Math.round(n).toLocaleString("en-US");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function baseTown(town) { return (town || "").split(" (")[0].trim(); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- Scores ---------------- */
function avgPerM2() {
  const sized = LISTINGS.filter((l) => l.size);
  if (!sized.length) return 0;
  return sized.reduce((a, l) => a + l.rent / l.size, 0) / sized.length;
}
function fairValue(l) {
  if (!l.size) return null;
  const avg = avgPerM2();
  const ratio = (l.rent / l.size) / avg;
  const score = Math.round(clamp((1.6 - ratio) * 100, 0, 100));
  const verdict = ratio <= 0.85 ? "Below average" : ratio <= 1.15 ? "Spot on" : ratio <= 1.4 ? "Above average" : "Way above average";
  return { ratio, score, verdict, perM2: l.rent / l.size, avg };
}
function idealRent(l) {
  const avg = avgPerM2();
  const a = l.size ? l.size * avg : null;
  const peers = LISTINGS.filter((x) => x.island === l.island && x.beds === l.beds).map((x) => x.rent);
  const b = peers.length ? median(peers) : null;
  let ideal = a != null && b != null ? (a + b) / 2 : (a != null ? a : b);
  if (ideal == null) ideal = l.rent;
  return Math.round(ideal / 10) * 10;
}
function anchor(l) {
  const ideal = idealRent(l);
  const gap = ideal ? ((l.rent - ideal) / ideal) * 100 : 0;
  const verdict = gap <= -10 ? "Below anchor" : gap <= 10 ? "At anchor" : gap <= 25 ? "Above anchor" : "Way above anchor";
  return { ideal, gap, verdict };
}
function airbnbPremiums(l) {
  const parts = [];
  let p = 0;
  if (l.beds > 2) { const v = 0.12 * (l.beds - 2); p += v; parts.push("+" + Math.round(v * 100) + "% extra bedrooms"); }
  const hay = ((l.type || "") + " " + (l.floor || "") + " " + (l.notes || "")).toLowerCase();
  if ((l.type || "").toLowerCase().indexOf("penthouse") >= 0) { p += 0.15; parts.push("+15% penthouse"); }
  if (hay.indexOf("roof terrace") >= 0 || hay.indexOf("rooftop") >= 0) { p += 0.12; parts.push("+12% roof terrace"); }
  else if (hay.indexOf("terrace") >= 0 || hay.indexOf("garden") >= 0) { p += 0.08; parts.push("+8% terrace or garden"); }
  if (l.furnished === "Yes" || l.furnished === "Yes (fully equipped)") { p += 0.05; parts.push("+5% furnished"); }
  const t = l.town || "";
  if (t.indexOf("Valletta") >= 0) { p += 0.15; parts.push("+15% Valletta"); }
  else if (t.indexOf("Gzira") >= 0) { p += 0.10; parts.push("+10% Gzira"); }
  else if (t.indexOf("Marsascala") >= 0) { p += 0.05; parts.push("+5% Marsascala"); }
  else if (t.indexOf("St Paul") >= 0 || t.indexOf("Qawra") >= 0 || t.indexOf("Bugibba") >= 0) { p += 0.05; parts.push("+5% St Paul's Bay area"); }
  else if (t.indexOf("Xlendi") >= 0) { p += 0.05; parts.push("+5% Xlendi"); }
  else if (t.indexOf("Marsalforn") >= 0) { p += 0.05; parts.push("+5% Marsalforn"); }
  return { p, parts };
}
function airbnb(l) {
  const prem = airbnbPremiums(l);
  const nightly = model.nightly * (1 + prem.p);
  const costs = model.wifi + model.licence / 12 + model.linen + model.util;
  const net = nightly * 30.4 * (model.occ / 100) * (1 - model.fee / 100) - costs - l.rent;
  const score = Math.round(clamp(((net + 500) / 1300) * 100, 0, 100));
  return { nightly, net, score, parts: prem.parts };
}
function purchaseScore(l) {
  if (!l.price) return null;
  const estAnnual = idealRent(l) * 12;
  const yieldPct = (estAnnual / l.price) * 100;
  return { yieldPct, score: Math.round(clamp(((yieldPct - 2) / 6) * 100, 0, 100)) };
}
const TOWN_CALM = {
  "St Paul's Bay": 42, "Qawra": 42, "Bugibba": 42, "Sliema": 40, "Gzira": 44, "Birkirkara": 52,
  "Qormi": 50, "Marsalforn": 55, "Valletta": 55, "Xlendi": 58, "Xemxija": 58, "Swieqi": 58,
  "Zabbar": 58, "Bormla (Cospicua)": 55, "Mosta": 55, "Marsascala": 60, "Zejtun": 60,
  "Rabat (Victoria)": 62, "Victoria (Rabat)": 62, "Mellieha": 66, "Balzan": 66, "Ghaxaq": 66,
  "Attard": 68, "Siggiewi": 70, "Tarxien": 58, "Birzebbugia": 58
};
function calmness(l) {
  const bt = baseTown(l.town);
  let base = TOWN_CALM[l.town] != null ? TOWN_CALM[l.town] : (TOWN_CALM[bt] != null ? TOWN_CALM[bt] : (l.island === "Gozo" ? 76 : 62));
  const fl = (l.floor || "").toLowerCase();
  const ty = (l.type || "").toLowerCase();
  let adj = 0; let posLabel = "floor not stated";
  if (ty.indexOf("penthouse") >= 0 || fl.indexOf("penthouse") >= 0) { adj = 14; posLabel = "penthouse"; }
  else if (fl.indexOf("3rd") >= 0) { adj = 9; posLabel = "3rd floor"; }
  else if (fl.indexOf("2nd") >= 0) { adj = 6; posLabel = "2nd floor"; }
  else if (fl.indexOf("1st") >= 0) { adj = 0; posLabel = "1st floor"; }
  else if (fl.indexOf("ground") >= 0) { adj = -10; posLabel = "ground floor"; }
  else if (["house", "farmhouse", "townhouse", "terraced"].some((k) => ty.indexOf(k) >= 0)) { adj = 4; posLabel = "standalone house"; }
  const score = Math.round(clamp(base + adj, 5, 99));
  const townLabel = base >= 70 ? "quiet town character" : base >= 55 ? "mid-range town character" : "busy town character";
  return { score, basis: posLabel + ", " + townLabel + " (" + l.town + "). No street address in the listing, town only." };
}
function pillClass(score) { return score >= 60 ? "good" : score >= 35 ? "mid" : "bad"; }
function hasWA(l) { return (l.contacts || []).length > 0 || !!l.wa; }
function isOwner(l) { return (l.seller || "").toUpperCase() === "OWNER"; }

/* ---------------- Verdicts ---------------- */
async function persistVote(url) {
  if (user && sb) {
    try {
      if (votes[url]) {
        await sb.from("verdicts").upsert({ user_id: user.id, listing_url: url, verdict: votes[url], updated_at: new Date().toISOString() }, { onConflict: "user_id,listing_url" });
      } else {
        await sb.from("verdicts").delete().eq("user_id", user.id).eq("listing_url", url);
      }
    } catch (e) { /* keep local state; will resync on next sign-in */ }
  } else {
    saveGuestVotes();
  }
}
function setVote(url, v) {
  const prev = votes[url] || null;
  const next = prev === v ? null : v;
  undoStack.push({ url, prev });
  if (next) votes[url] = next; else delete votes[url];
  persistVote(url);
  refreshAfterVote(url);
}
function undoLast() {
  const last = undoStack.pop();
  if (!last) return;
  if (last.prev) votes[last.url] = last.prev; else delete votes[last.url];
  persistVote(last.url);
  const vis = visibleListings();
  const i = vis.findIndex((l) => l.url === last.url);
  if (i >= 0) deckIdx = i;
  refreshAfterVote(last.url);
  toast("Undone");
}
function voteFromDeck(v) {
  const vis = visibleListings();
  if (!vis.length) return;
  const cur = vis[clamp(deckIdx, 0, vis.length - 1)];
  setVote(cur.url, v);
  const after = visibleListings();
  const i = after.findIndex((l) => l.url === cur.url);
  if (i >= 0) deckIdx = Math.min(i + 1, after.length - 1);
  renderMain();
}
function refreshAfterVote(url) {
  updateUndoBtn();
  if (page === "profile") { renderProfile(); return; }
  if (!$("#sheet").hidden && sheetUrl === url) renderSheet(url);
  renderMain();
}
async function loadRemoteVotesAndMerge() {
  if (!sb || !user) return;
  const guest = loadGuestVotes();
  const { data } = await sb.from("verdicts").select("listing_url, verdict").eq("user_id", user.id);
  const remote = {};
  (data || []).forEach((r) => { remote[r.listing_url] = r.verdict; });
  const merged = Object.assign({}, remote);
  const toPush = [];
  Object.keys(guest).forEach((u) => {
    if (!remote[u]) { merged[u] = guest[u]; toPush.push({ user_id: user.id, listing_url: u, verdict: guest[u] }); }
  });
  if (toPush.length) { try { await sb.from("verdicts").upsert(toPush, { onConflict: "user_id,listing_url" }); } catch (e) {} }
  votes = merged;
  try { localStorage.removeItem(GUEST_KEY); } catch (e) {}
}

/* ---------------- Filtering ---------------- */
function filtersActive() {
  const f = filters;
  return f.town !== FILTER_DEFAULTS.town || f.sort !== FILTER_DEFAULTS.sort || f.island !== FILTER_DEFAULTS.island ||
    f.source !== FILTER_DEFAULTS.source || f.verdict !== FILTER_DEFAULTS.verdict || f.maxRent !== FILTER_DEFAULTS.maxRent ||
    f.owner !== FILTER_DEFAULTS.owner || f.waonly !== FILTER_DEFAULTS.waonly ||
    JSON.stringify(model) !== JSON.stringify(MODEL_DEFAULTS);
}
function visibleListings() {
  const q = filters.town.trim().toLowerCase();
  let out = LISTINGS.filter((l) => {
    if (l.rent > filters.maxRent) return false;
    if (filters.island && l.island !== filters.island) return false;
    if (filters.source && l.src !== filters.source) return false;
    if (q && (l.town || "").toLowerCase().indexOf(q) < 0) return false;
    if (filters.owner && !isOwner(l)) return false;
    if (filters.waonly && !hasWA(l)) return false;
    const v = votes[l.url] || null;
    if (filters.verdict === "yay" && v !== "yay") return false;
    if (filters.verdict === "maybe" && v !== "maybe") return false;
    if (filters.verdict === "nay" && v !== "nay") return false;
    if (filters.verdict === "none" && v) return false;
    if (filters.verdict !== "nay" && v === "nay") return false;
    return true;
  });
  const by = {
    "rent-asc": (a, b) => a.rent - b.rent,
    "rent-desc": (a, b) => b.rent - a.rent,
    "anchor": (a, b) => anchor(a).gap - anchor(b).gap,
    "calm": (a, b) => calmness(b).score - calmness(a).score
  };
  out.sort(by[filters.sort] || by["rent-asc"]);
  return out;
}

/* ---------------- Rendering ---------------- */
function metaLine(l) {
  const bits = ["<strong>" + fmtEUR(l.rent) + "/mo</strong>"];
  if (l.size) bits.push(l.size + " m2");
  bits.push(l.beds + " bed");
  bits.push(esc(l.town) + ", " + esc(l.island));
  return bits.join(" · ");
}
function waButtonsHTML(l, withMsg) {
  const cs = l.contacts || [];
  if (!cs.length) {
    if (l.waMsg || l.wa) {
      return '<a class="wa-btn" target="_blank" rel="noopener" href="' + esc(l.waMsg || l.wa) + '">WhatsApp ' + esc(l.phones || "") + "</a>";
    }
    return '<p class="no-phone">No phone number in this listing</p>';
  }
  return cs.map((c) => '<a class="wa-btn" target="_blank" rel="noopener" href="' + esc(withMsg ? (c.waMsg || c.wa) : (c.wa || c.waMsg)) + '">WhatsApp ' + esc(c.phone) + "</a>").join("");
}
function stampHTML(l) {
  const v = votes[l.url];
  if (!v) return "";
  const label = v === "yay" ? "YAY" : v === "maybe" ? "MAYBE" : "NAY";
  return '<span class="stamp ' + v + '">' + label + "</span>";
}
function cardHTML(l) {
  const imgs = (l.images || []).slice(0, 5);
  const photos = imgs.length
    ? '<div class="scroller">' + imgs.map((src) => '<img loading="lazy" alt="Listing photo" src="' + esc(src) + '" onerror="this.style.visibility=\'hidden\'">').join("") + "</div>" +
      (imgs.length > 1 ? '<div class="photo-dots">' + imgs.map((_, i) => "<i" + (i === 0 ? ' class="on"' : "") + "></i>").join("") + "</div>" : "")
    : '<div class="scroller"><div class="no-photo">No photos in this listing</div></div>';
  return '<article class="card" data-url="' + esc(l.url) + '">' +
    '<div class="photos">' + photos + stampHTML(l) + "</div>" +
    '<div class="card-body"><p class="card-line">' + metaLine(l) + "</p>" +
    '<div class="card-actions"><button class="details-link" data-details="' + esc(l.url) + '">Details</button>' + waButtonsHTML(l, true) + "</div></div></article>";
}
function renderDeck() {
  const vis = visibleListings();
  $("#result-count").textContent = vis.length + " homes";
  deckIdx = clamp(deckIdx, 0, Math.max(0, vis.length - 1));
  const deck = $("#deck");
  if (!vis.length) { deck.innerHTML = ""; $("#deck-empty").hidden = false; return; }
  $("#deck-empty").hidden = true;
  const l = vis[deckIdx];
  deck.innerHTML = cardHTML(l);
  const sc = $(".scroller", deck);
  if (sc) {
    sc.addEventListener("scroll", () => {
      const i = Math.round(sc.scrollLeft / sc.clientWidth);
      $$(".photo-dots i", deck).forEach((d, j) => d.classList.toggle("on", j === i));
    }, { passive: true });
  }
  const card = $(".card", deck);
  let sx = null, sy = null, inPhotos = false;
  card.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; inPhotos = !!e.target.closest(".photos"); });
  card.addEventListener("pointerup", (e) => {
    if (sx == null || inPhotos) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      voteFromDeck(dx > 0 ? "yay" : "nay");
    }
  });
  $$("#vote-row .vote-btn[data-vote]").forEach((b) => {
    b.classList.toggle("picked", votes[l.url] === b.dataset.vote);
  });
}
function renderList() {
  const vis = visibleListings();
  $("#result-count").textContent = vis.length + " homes";
  $("#list").innerHTML = vis.map((l) =>
    '<div class="lrow" data-open="' + esc(l.url) + '">' +
    (l.images && l.images[0] ? '<img alt="" src="' + esc(l.images[0]) + '" onerror="this.style.visibility=\'hidden\'">' : "<img alt=''>") +
    '<div class="lr-main"><div class="lr-line">' + metaLine(l) + '</div><div class="lr-line muted">' + esc(l.type) + (l.floor ? " · " + esc(l.floor) : "") + " · " + esc(l.src) + "</div></div>" +
    '<div class="lr-votes">' +
    '<button class="lr-vote' + (votes[l.url] === "nay" ? " picked" : "") + '" data-v="' + esc(l.url) + '|nay" aria-label="Nay">&#x1F645;&#x200D;&#x2640;&#xFE0F;</button>' +
    '<button class="lr-vote' + (votes[l.url] === "maybe" ? " picked" : "") + '" data-v="' + esc(l.url) + '|maybe" aria-label="Maybe">&#x1F928;</button>' +
    '<button class="lr-vote' + (votes[l.url] === "yay" ? " picked" : "") + '" data-v="' + esc(l.url) + '|yay" aria-label="Yay">&#x1F60D;</button>' +
    "</div></div>"
  ).join("");
}
function renderMain() {
  if (page !== "home") return;
  $("#deck-wrap").hidden = viewMode !== "deck";
  $("#list-wrap").hidden = viewMode !== "list";
  $("#view-deck").classList.toggle("active", viewMode === "deck");
  $("#view-list").classList.toggle("active", viewMode === "list");
  if (viewMode === "deck") renderDeck(); else renderList();
  $("#filter-dot").hidden = !filtersActive();
  updateUndoBtn();
}
function updateUndoBtn() { $("#btn-undo").disabled = !undoStack.length; }

/* ---------------- Details sheet ---------------- */
let sheetUrl = null;
function factRow(k, v) { return v ? '<span class="frow"><dt>' + esc(k) + ":</dt> <dd>" + esc(v) + "</dd></span>" : ""; }
function renderSheet(url) {
  const l = LISTINGS.find((x) => x.url === url);
  if (!l) return;
  sheetUrl = url;
  $("#sheet-title").textContent = fmtEUR(l.rent) + "/mo · " + l.town;
  const fv = fairValue(l);
  const an = anchor(l);
  const calm = calmness(l);
  const ab = airbnb(l);
  const ps = purchaseScore(l);
  const tel = (l.contacts || []).map((c) => c.phone).join(", ") || l.phones || "";
  const msgText = (l.contacts && l.contacts[0] && l.contacts[0].waMsg)
    ? decodeURIComponent((l.contacts[0].waMsg.split("?text=")[1] || "")).replace(/\+/g, " ")
    : "Hi, I saw your listing: " + l.url + " Is it still available for a long let?";
  const imgs = (l.images || []).slice(0, 5);
  const v = votes[l.url];
  $("#sheet-body").innerHTML =
    (imgs.length ? '<div class="photos"><div class="scroller">' + imgs.map((src) => '<img loading="lazy" alt="Listing photo" src="' + esc(src) + '" onerror="this.style.visibility=\'hidden\'">').join("") + "</div>" + stampHTML(l) + "</div>" : "") +
    '<dl class="facts">' +
    factRow("Type", l.type) +
    factRow("Size", l.size ? l.size + " m2" : "Not stated") +
    factRow("Bedrooms", String(l.beds)) +
    factRow("Floor", l.floor || "Not stated") +
    factRow("Furnished", l.furnished || "Not stated") +
    factRow("Source", l.src + (l.sellerName ? " · " + l.sellerName : "") + (l.seller ? " · " + l.seller : "")) +
    factRow("Posted", l.posted) +
    factRow("Available", l.avail || "Not stated") +
    factRow("Tel", tel || "No phone number in this listing") +
    "</dl>" +
    '<div class="anchor-box"><span class="big">Asked ' + fmtEUR(l.rent) + " vs Ideal " + fmtEUR(an.ideal) + '</span><br>' +
    '<span class="pill ' + (an.verdict === "Below anchor" ? "good" : an.verdict === "Way above anchor" ? "bad" : "mid") + '">' + an.verdict + "</span> " +
    '<span class="muted">Gap ' + (an.gap >= 0 ? "+" : "") + fmtEUR(l.rent - an.ideal).replace("EUR ", "EUR ") + " (" + (an.gap >= 0 ? "+" : "") + an.gap.toFixed(0) + "%). Ideal blends size at the dataset average with the median rent for " + l.beds + "-bed homes on " + esc(l.island) + ".</span></div>" +
    '<p class="score-line">Calmness <span class="pill ' + pillClass(calm.score) + '">' + calm.score + '/100</span></p><p class="score-basis">' + esc(calm.basis) + "</p>" +
    (fv
      ? '<p class="score-line">Fair value <span class="pill ' + (fv.verdict === "Below average" ? "good" : fv.verdict === "Way above average" ? "bad" : "mid") + '">' + fv.score + "/100 · " + fv.verdict + '</span></p><p class="score-basis">' + fmtEUR(fv.perM2).replace("EUR", "EUR") + " per m2 vs dataset average of EUR " + fv.avg.toFixed(2) + " per m2 across sized listings. Relative to this dataset only.</p>"
      : '<p class="score-line">Fair value <span class="pill na">no size listed</span></p>') +
    (ps ? '<p class="score-line">Purchase <span class="pill ' + pillClass(ps.score) + '">' + ps.score + "/100</span></p><p class=\"score-basis\">Estimated gross yield " + ps.yieldPct.toFixed(1) + "% from dataset rents.</p>" : "") +
    (l.notes ? '<div class="notes-box">' + esc(l.notes) + "</div>" : "") +
    '<div class="sheet-votes"><span class="muted">Your verdict:</span>' +
    '<button class="lr-vote' + (v === "nay" ? " picked" : "") + '" data-v="' + esc(l.url) + '|nay" aria-label="Nay">&#x1F645;&#x200D;&#x2640;&#xFE0F;</button>' +
    '<button class="lr-vote' + (v === "maybe" ? " picked" : "") + '" data-v="' + esc(l.url) + '|maybe" aria-label="Maybe">&#x1F928;</button>' +
    '<button class="lr-vote' + (v === "yay" ? " picked" : "") + '" data-v="' + esc(l.url) + '|yay" aria-label="Yay">&#x1F60D;</button></div>' +
    '<div><p class="muted" style="margin:0 0 6px">WhatsApp message</p><div class="msg-preview">' + esc(msgText) + "</div></div>" +
    '<div class="sheet-actions">' + waButtonsHTML(l, true) +
    (l.contacts || []).map((c) => '<a class="call-btn" href="tel:+356' + esc(c.phone.replace(/\s+/g, "")) + '">Call ' + esc(c.phone) + "</a>").join("") +
    '<a class="link-btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(l.town + ", " + l.island) + '">Map: ' + esc(l.town) + ", " + esc(l.island) + "</a>" +
    '<a class="link-btn" target="_blank" rel="noopener" href="' + esc(l.url) + '">Original listing on ' + esc(l.src) + "</a></div>" +
    '<details class="airbnb-last"><summary>Airbnb</summary>' +
    '<p class="score-line" style="margin-top:10px">Airbnb score <span class="pill ' + pillClass(ab.score) + '">' + ab.score + '/100</span></p>' +
    '<p class="score-basis">Estimated net ' + fmtEUR(ab.net) + "/mo at EUR " + ab.nightly.toFixed(0) + "/night after premiums" + (ab.parts.length ? " (" + esc(ab.parts.join(", ")) + ")" : "") + ", " + model.occ + "% occupancy, " + model.fee + "% platform fee, minus running costs and the rent. Flat-rate model, EUR " + model.nightly + "/night base.</p></details>";
}
function openSheet(url) { renderSheet(url); $("#sheet").hidden = false; $("#sheet-backdrop").hidden = false; $("#sheet").scrollTop = 0; }
function closeSheet() { $("#sheet").hidden = true; $("#sheet-backdrop").hidden = true; sheetUrl = null; }

/* ---------------- Profile ---------------- */
function pickRow(l) {
  return '<div class="prow" data-open="' + esc(l.url) + '">' +
    (l.images && l.images[0] ? '<img alt="" src="' + esc(l.images[0]) + '" onerror="this.style.visibility=\'hidden\'">' : "<img alt=''>") +
    '<div class="lr-main"><div class="lr-line">' + metaLine(l) + '</div><div class="lr-line muted">' + esc(l.type) + " · " + esc(l.src) + "</div></div></div>";
}
function renderProfile() {
  renderAccount();
  const byV = { yay: [], maybe: [], nay: [] };
  LISTINGS.forEach((l) => { if (votes[l.url]) byV[votes[l.url]].push(l); });
  const n = byV.yay.length + byV.maybe.length + byV.nay.length;
  $("#saved-line").textContent = user
    ? n + " verdicts saved to your account. They load on any device where you sign in."
    : n + " verdicts saved on this device only. Sign in to move them across devices.";
  const group = (title, arr) => arr.length
    ? '<div class="pick-group"><h4>' + title + " (" + arr.length + ")</h4>" + arr.map(pickRow).join("") + "</div>"
    : '<div class="pick-group"><h4>' + title + " (0)</h4><p class='muted'>None yet.</p></div>";
  $("#picks").innerHTML = group("Yay", byV.yay) + group("Maybe", byV.maybe) + group("Archived (Nay)", byV.nay);
}
function renderAccount() {
  const box = $("#account-box");
  if (!sb) {
    box.innerHTML = '<p style="margin:0">Accounts are not switched on yet on this copy. Your verdicts still save on this device. See SETUP.md for the one-time backend setup.</p>';
    return;
  }
  if (user) {
    box.innerHTML = '<p style="margin:0 0 10px">Signed in as <strong>' + esc(user.email || "") + '</strong></p>' +
      '<button id="btn-signout" class="mini-btn" type="button">Sign out</button>';
    $("#btn-signout").addEventListener("click", async () => { await sb.auth.signOut(); });
    return;
  }
  box.innerHTML =
    '<form id="auth-form"><input id="auth-email" type="email" required placeholder="Email" autocomplete="email">' +
    '<input id="auth-pass" type="password" required placeholder="Password" autocomplete="current-password">' +
    '<div class="row"><button class="primary-btn" id="btn-signin" type="submit">Sign in</button>' +
    '<button class="primary-btn" id="btn-signup" type="button">Create account</button></div>' +
    '<p class="auth-msg" id="auth-msg"></p></form>' +
    '<div style="margin-top:10px"><button class="google-btn" id="btn-google" type="button">' +
    '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.5 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.5 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>' +
    "Continue with Google</button></div>";
  const msg = (t, ok) => { const m = $("#auth-msg"); m.textContent = t; m.className = "auth-msg " + (ok ? "ok" : "err"); };
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $("#auth-email").value.trim(), password: $("#auth-pass").value });
    if (error) msg(error.message, false);
  });
  $("#btn-signup").addEventListener("click", async () => {
    const { data, error } = await sb.auth.signUp({ email: $("#auth-email").value.trim(), password: $("#auth-pass").value });
    if (error) { msg(error.message, false); return; }
    msg(data.session ? "Account created and signed in." : "Account created. Check your email to confirm, then sign in.", true);
  });
  $("#btn-google").addEventListener("click", async () => {
    const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
    if (error) msg(error.message, false);
  });
}
function downloadState() {
  const byV = { yay: [], maybe: [], nay: [] };
  LISTINGS.forEach((l) => { if (votes[l.url]) byV[votes[l.url]].push(l); });
  const pick = (l) => ({ verdict: votes[l.url], rent: l.rent, beds: l.beds, type: l.type, town: l.town, island: l.island, size: l.size, floor: l.floor, src: l.src, phones: (l.contacts || []).map((c) => c.phone), url: l.url });
  const payload = {
    exportedAt: new Date().toISOString(),
    account: user ? (user.email || "signed in") : "guest (this device)",
    counts: { yay: byV.yay.length, maybe: byV.maybe.length, nay: byV.nay.length },
    verdictsByUrl: votes,
    picks: { yay: byV.yay.map(pick), maybe: byV.maybe.map(pick), nay: byV.nay.map(pick) },
    filters: filters,
    airbnbModel: model
  };
  const name = "malta-property-state-" + new Date().toISOString().slice(0, 10) + ".json";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  $("#download-note").textContent = "Saved " + name + " with " + payload.counts.yay + payload.counts.maybe + payload.counts.nay + " verdicts. Send it in chat and it can be read back exactly.";
}

/* ---------------- Toast ---------------- */
let toastTimer = null;
function toast(t) {
  const el = $("#toast");
  el.textContent = t; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------------- Wiring ---------------- */
function showPage(p) {
  page = p;
  $("#rent-view").hidden = p !== "home" || tab !== "rent";
  $("#buy-view").hidden = p !== "home" || tab !== "buy";
  $("#profile-view").hidden = p !== "profile";
  if (p === "profile") renderProfile(); else renderMain();
}
function setTab(t) {
  tab = t;
  $("#tab-rent").classList.toggle("active", t === "rent");
  $("#tab-buy").classList.toggle("active", t === "buy");
  $("#tab-rent").setAttribute("aria-selected", t === "rent");
  $("#tab-buy").setAttribute("aria-selected", t === "buy");
  showPage("home");
}
function bindFilters() {
  const upd = () => {
    filters.town = $("#f-town").value;
    filters.sort = $("#f-sort").value;
    filters.island = $("#f-island").value;
    filters.source = $("#f-source").value;
    filters.verdict = $("#f-verdict").value;
    filters.maxRent = parseInt($("#f-maxrent").value, 10);
    $("#f-maxrent-label").textContent = fmtEUR(filters.maxRent);
    filters.owner = $("#f-owner").checked;
    filters.waonly = $("#f-waonly").checked;
    deckIdx = 0;
    renderMain();
  };
  ["f-town", "f-sort", "f-island", "f-source", "f-verdict", "f-maxrent", "f-owner", "f-waonly"].forEach((id) => {
    $("#" + id).addEventListener("input", upd);
    $("#" + id).addEventListener("change", upd);
  });
  const updModel = () => {
    model = {
      nightly: parseFloat($("#m-nightly").value) || 0,
      occ: parseFloat($("#m-occ").value) || 0,
      fee: parseFloat($("#m-fee").value) || 0,
      wifi: parseFloat($("#m-wifi").value) || 0,
      licence: parseFloat($("#m-licence").value) || 0,
      linen: parseFloat($("#m-linen").value) || 0,
      util: parseFloat($("#m-util").value) || 0
    };
    renderMain();
    if (sheetUrl) renderSheet(sheetUrl);
  };
  ["m-nightly", "m-occ", "m-fee", "m-wifi", "m-licence", "m-linen", "m-util"].forEach((id) => {
    $("#" + id).addEventListener("input", updModel);
  });
  $("#m-nightly").value = model.nightly; $("#m-occ").value = model.occ; $("#m-fee").value = model.fee;
  $("#m-wifi").value = model.wifi; $("#m-licence").value = model.licence; $("#m-linen").value = model.linen; $("#m-util").value = model.util;
  $("#f-reset").addEventListener("click", () => {
    filters = Object.assign({}, FILTER_DEFAULTS);
    model = Object.assign({}, MODEL_DEFAULTS);
    $("#f-town").value = ""; $("#f-sort").value = "rent-asc"; $("#f-island").value = ""; $("#f-source").value = "";
    $("#f-verdict").value = ""; $("#f-maxrent").value = 14000; $("#f-maxrent-label").textContent = fmtEUR(14000);
    $("#f-owner").checked = false; $("#f-waonly").checked = false;
    $("#m-nightly").value = model.nightly; $("#m-occ").value = model.occ; $("#m-fee").value = model.fee;
    $("#m-wifi").value = model.wifi; $("#m-licence").value = model.licence; $("#m-linen").value = model.linen; $("#m-util").value = model.util;
    deckIdx = 0; renderMain();
  });
  const sized = LISTINGS.filter((l) => l.size).length;
  $("#f-benchmark").textContent = "Dataset: " + LISTINGS.length + " long lets. Fair value benchmark EUR " + avgPerM2().toFixed(2) + " per m2 across " + sized + " sized listings.";
}
function init() {
  $("#btn-filters").addEventListener("click", () => {
    const p = $("#filters-panel");
    p.hidden = !p.hidden;
    $("#btn-filters").setAttribute("aria-expanded", String(!p.hidden));
  });
  $("#f-close").addEventListener("click", () => { $("#filters-panel").hidden = true; });
  $("#tab-rent").addEventListener("click", () => setTab("rent"));
  $("#tab-buy").addEventListener("click", () => setTab("buy"));
  $("#btn-profile").addEventListener("click", () => showPage("profile"));
  $("#btn-back").addEventListener("click", () => showPage("home"));
  $("#view-deck").addEventListener("click", () => { viewMode = "deck"; renderMain(); });
  $("#view-list").addEventListener("click", () => { viewMode = "list"; renderMain(); });
  $$("#vote-row .vote-btn[data-vote]").forEach((b) => {
    b.addEventListener("click", () => voteFromDeck(b.dataset.vote));
  });
  $("#btn-undo").addEventListener("click", undoLast);
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet-backdrop").addEventListener("click", closeSheet);
  $("#btn-download").addEventListener("click", downloadState);
  $("#btn-clear").addEventListener("click", async () => {
    if (!Object.keys(votes).length) { toast("No verdicts to clear"); return; }
    if (!confirm("Clear all your verdicts?")) return;
    votes = {}; undoStack = [];
    if (user && sb) { try { await sb.from("verdicts").delete().eq("user_id", user.id); } catch (e) {} }
    else saveGuestVotes();
    renderProfile(); toast("Verdicts cleared");
  });
  document.addEventListener("click", (e) => {
    const d = e.target.closest("[data-details]");
    if (d) { openSheet(d.dataset.details); return; }
    const vb = e.target.closest("[data-v]");
    if (vb) { const parts = vb.dataset.v.split("|"); setVote(parts[0], parts[1]); return; }
    const o = e.target.closest("[data-open]");
    if (o && !e.target.closest(".lr-votes")) openSheet(o.dataset.open);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeSheet(); $("#filters-panel").hidden = true; }
    if (page === "home" && viewMode === "deck" && $("#sheet").hidden && tab === "rent") {
      const k = e.key.toLowerCase();
      if (k === "y") voteFromDeck("yay");
      if (k === "m") voteFromDeck("maybe");
      if (k === "n") voteFromDeck("nay");
    }
  });
  bindFilters();
  renderMain();

  if (sb) {
    sb.auth.getSession().then(async ({ data }) => {
      user = data.session ? data.session.user : null;
      if (user) { await loadRemoteVotesAndMerge(); }
      renderMain();
      if (page === "profile") renderProfile();
    });
    sb.auth.onAuthStateChange(async (event, session) => {
      const was = user ? user.id : null;
      user = session ? session.user : null;
      if (user && user.id !== was) { await loadRemoteVotesAndMerge(); }
      if (!user && was) { votes = loadGuestVotes(); undoStack = []; }
      renderMain();
      if (page === "profile") renderProfile();
      if (event === "SIGNED_IN") toast("Signed in. Your verdicts are synced.");
    });
    sb.from("listings").select("data").order("rent", { ascending: true }).then(({ data, error }) => {
      if (!error && data && data.length) {
        LISTINGS = data.map((r) => r.data);
        bindFiltersBenchmarkOnly();
        renderMain();
      }
    });
  }
}
function bindFiltersBenchmarkOnly() {
  const sized = LISTINGS.filter((l) => l.size).length;
  $("#f-benchmark").textContent = "Dataset: " + LISTINGS.length + " long lets. Fair value benchmark EUR " + avgPerM2().toFixed(2) + " per m2 across " + sized + " sized listings.";
}
document.addEventListener("DOMContentLoaded", init);
