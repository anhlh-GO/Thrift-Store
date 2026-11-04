/* Thrift Store: Cleaning ASMR — game engine.
   Data (items, tools, power-ups, tiers, goals, sound bank, panel styles) comes from assets/data.json,
   decoded from the Unity build. Tween values mirror the original components.
   game.ts wraps this module in the FalconGame contract; this file never touches the SDK. */
import D from "./assets/data.json";

// Every asset goes through a Vite import so the build inlines it into the single dist/index.html.
const IMG = import.meta.glob(["./assets/items/*.webp", "./assets/ui/*.webp"], { eager: true, query: "?url", import: "default" });
const SND = import.meta.glob("./assets/snd/*.mp3", { eager: true, query: "?url", import: "default" });
/** "img/ui/coin.webp" → inlined URL. Already-resolved URLs pass through, so wrapping twice is harmless. */
function U(path) {
  if (!path.startsWith("img/")) return path;
  const url = IMG["./assets/" + path.slice(4)];
  if (!url) console.warn("[thrift] missing image", path);
  return url || "";
}
const SND_URL = name => SND[`./assets/snd/${name}.mp3`];

/** Hooks game.ts installs to report the FalconGame lifecycle. */
const hooks = { levelStart: (_index) => {}, win: () => {} };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const fmt = n => Math.round(n).toLocaleString("en-US");
const game = $("#game");

/* ---------- Layout: the frame always covers the whole screen, no bars on any side ----------
   The design is 720x1280. Phones taller than 9:16 grow the frame's HEIGHT (--ex > 0); screens
   wider than 9:16 grow the frame's WIDTH (--exw > 0) and the layout stays centered in it. The blurred background art fills the extra space.
   #stage is fixed inset 0 (viewport-fit=cover → includes the notch); use the VISIBLE height only. */
let SCALE = 1, GAME_W = 720, GAME_H = 1280;
const MIN_H = 1280; // never squeeze the 1280 design vertically (meter/hint/toolbar would overlap)
function fit() {
  const r = $("#stage").getBoundingClientRect();
  const vw = r.width || innerWidth, vh = Math.min(r.height || innerHeight, innerHeight);
  if (!vw || !vh) return;
  SCALE = vw / 720; GAME_W = 720; GAME_H = vh / SCALE;
  if (GAME_H < MIN_H) { SCALE = vh / MIN_H; GAME_H = MIN_H; GAME_W = vw / SCALE; }
  game.style.width = `${GAME_W}px`;
  game.style.height = `${GAME_H}px`;
  game.style.setProperty("--scale", SCALE);
  game.style.setProperty("--ex", `${GAME_H - 1280}px`);
  game.style.setProperty("--exw", `${GAME_W - 720}px`);
  game.style.transform = `scale(${SCALE})`;
}
addEventListener("resize", fit); addEventListener("orientationchange", fit); addEventListener("load", fit);
window.visualViewport?.addEventListener("resize", fit);
// Previews and shells may resize the frame without a window resize event: watch the stage itself.
if (window.ResizeObserver) new ResizeObserver(fit).observe($("#stage"));
fit();
function toGame(e) {
  const r = game.getBoundingClientRect();
  return { x: (e.clientX - r.left) / SCALE, y: (e.clientY - r.top) / SCALE };
}

/* ---------- DOTween-compatible easing + tiny tween engine ---------- */
const BACK = 1.70158;
const EASE = {
  Linear: t => t,
  InQuad: t => t * t, OutQuad: t => -t * (t - 2), InOutQuad: t => (t *= 2) < 1 ? .5 * t * t : -.5 * (--t * (t - 2) - 1),
  InCubic: t => t * t * t, OutCubic: t => (--t) * t * t + 1,
  InSine: t => 1 - Math.cos(t * Math.PI / 2), OutSine: t => Math.sin(t * Math.PI / 2), InOutSine: t => -.5 * (Math.cos(Math.PI * t) - 1),
  InBack: t => t * t * ((BACK + 1) * t - BACK), OutBack: t => (t -= 1) * t * ((BACK + 1) * t + BACK) + 1,
  OutElastic: t => {
    if (t === 0 || t === 1) return t;
    const p = .3, s = p / 4;  // DOTween default period for duration-normalised time
    return Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1;
  },
};
const tweens = new Set();
function tween(dur, ease, update, done) {
  const tw = { t0: performance.now(), dur: Math.max(1, dur * 1000), ease: EASE[ease] || EASE.Linear, update, done, killed: false };
  tweens.add(tw); update(tw.ease(0), 0); return tw;
}
function kill(tw) { if (tw) { tw.killed = true; tweens.delete(tw); } }
function tick(now) {
  for (const tw of [...tweens]) {
    const p = clamp((now - tw.t0) / tw.dur, 0, 1);
    tw.update(tw.ease(p), p);
    if (p >= 1) { tweens.delete(tw); tw.done && tw.done(); }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
const wait = s => new Promise(r => setTimeout(r, s * 1000));

/* ---------- Save data ---------- */
const DAY = () => new Date().toISOString().slice(0, 10);
const DEFAULT = { coins: 150, gems: 5, rating: 3.0, level: 1, xp: 0, tier: 0, polish: null, polishTime: Date.now(),
  powerUps: { WideBrush: 1, DeepClean: 1, Handshake: 0, GoodWill: 0 }, display: [], itemsCleaned: 0, goodWill: false, handshake: false,
  goals: { day: DAY(), progress: {}, claimed: {} }, settings: { music: true, sfx: true, vibe: true }, lastItems: [],
  placed: {} };  // Decorate: placed[shopTier][slotId] = itemId
let S;
try { S = Object.assign(structuredClone(DEFAULT), JSON.parse(localStorage.getItem("thrift_save") || "{}")); } catch { S = structuredClone(DEFAULT); }
function save() { try { localStorage.setItem("thrift_save", JSON.stringify(S)); } catch {} }
if (S.goals.day !== DAY()) S.goals = { day: DAY(), progress: {}, claimed: {} };

/* ---------- Audio (SoundBank ids from the original game) ---------- */
const AUDIO = {}, lastPlay = {};
function snd(name) {
  if (!AUDIO[name]) { AUDIO[name] = new Audio(SND_URL(name)); AUDIO[name].preload = "auto"; }
  return AUDIO[name];
}
// One-shot SFX go through Web Audio: each clip is decoded ONCE into an AudioBuffer and replayed for free.
// (Cloning an <audio> whose src is an inlined base64 mp3 re-decodes the whole file on every play — that
// was a big source of stutter while scrubbing.) Falls back to <audio> until the buffer is ready.
const ACtx = window.AudioContext || window.webkitAudioContext;
const actx = ACtx ? new ACtx() : null;
const BUF = {};
function decodeClip(name) {
  if (!actx || BUF[name]) return BUF[name];
  BUF[name] = fetch(SND_URL(name)).then(r => r.arrayBuffer())
    .then(ab => new Promise((res, rej) => actx.decodeAudioData(ab, res, rej)))
    .then(b => (BUF[name] = b)).catch(() => (BUF[name] = null));
  return BUF[name];
}
function playClip(name, vol, rate = 1) {
  const b = BUF[name];
  if (actx && b instanceof AudioBuffer && actx.state === "running") {
    const src = actx.createBufferSource(), g = actx.createGain();
    src.buffer = b; src.playbackRate.value = rate; g.gain.value = vol;
    src.connect(g).connect(actx.destination); src.start();
    return;
  }
  decodeClip(name);
  const a = snd(name).cloneNode(); a.volume = vol; a.playbackRate = rate; a.play().catch(() => {});
}
// Browsers start audio only after a gesture: resume the context and decode every SFX clip in the background.
addEventListener("pointerdown", () => {
  if (!actx) return;
  if (actx.state !== "running") actx.resume().catch(() => {});
  if (!decodeClip.warm) { decodeClip.warm = true; [...new Set(Object.values(D.sfx).map(e => e.clip)), "pop"].forEach(decodeClip); }
}, true);
function sfx(id) {
  const e = D.sfx[id]; if (!e || !S.settings.sfx) return;
  const now = performance.now();
  if (lastPlay[id] && now - lastPlay[id] < e.cd * 1000) return;
  lastPlay[id] = now;
  playClip(e.clip, clamp(e.vol, 0, 1), e.pv ? 1 + rand(-e.pv, e.pv) : 1);
}
let music = null, musicName = null;
function playMusic(name, vol) {
  if (musicName === name && music && !music.paused) return;
  if (music) { const old = music; tween(.9, "Linear", t => old.volume = (1 - t) * old.volume, () => old.pause()); }
  musicName = name; music = null;
  if (!S.settings.music) return;
  const a = snd(name).cloneNode(); a.loop = true; a.volume = 0;
  a.play().then(() => tween(.9, "Linear", t => a.volume = t * vol * .7)).catch(() => {});
  music = a;
}
const loops = {};
function loopOn(name, vol = .7) {
  if (!S.settings.sfx) return;
  let a = loops[name];
  if (!a) { a = loops[name] = snd(name).cloneNode(); a.loop = true; }
  a.volume = vol; if (a.paused) a.play().catch(() => {});
}
function loopOff(name) { const a = loops[name]; if (a && !a.paused) a.pause(); }
function vibe(ms = 15) {
  if (S.settings.vibe && navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(ms);
}

/* ---------- Generic UI motion (values from the decoded components) ---------- */
// UIButtonPressFeedback: pressedScale 0.95, pressDuration 0.08, releaseDuration 0.3
document.addEventListener("pointerdown", e => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  kill(b._tw); const from = b._s || 1;
  b._tw = tween(.08, "OutQuad", t => { b._s = lerp(from, .95, t); b.style.scale = b._s; });
  const up = () => {
    removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
    kill(b._tw); const f2 = b._s;
    b._tw = tween(.3, "OutBack", t => { b._s = lerp(f2, 1, t); b.style.scale = b._s; });
  };
  addEventListener("pointerup", up); addEventListener("pointercancel", up);
  if (!b.dataset.silent) sfx(b.classList.contains("closebtn") ? "ButtonClose" : b.id === "playBtn" ? "ButtonPlay" : "ButtonTap");
}, true);

// UIValuePunch: punchScale 1.1, riseDuration 0.09, settleDuration 0.32
function punch(el) {
  kill(el._pt);
  el._pt = tween(.09, "OutQuad", t => el.style.scale = lerp(1, 1.1, t), () => {
    el._pt = tween(.32, "OutBack", t => el.style.scale = lerp(1.1, 1, t));
  });
}
// UIIdleLoop: Breathe (scale) / Float (y) / Sway (rotation)
function idle(el, style, amplitude, period, delay = .8, jitter = .7) {
  const phase = Math.random() * jitter, t0 = performance.now() + delay * 1000;
  const scr = el.closest(".screen");
  (function f(now) {
    if (!el.isConnected) return;
    // Skip the style write while the element's screen is hidden (no restyle during gameplay).
    if (scr && !scr.classList.contains("active")) { requestAnimationFrame(f); return; }
    const t = Math.max(0, now - t0) / 1000, s = Math.sin((t / period + phase) * Math.PI * 2);
    if (style === "Breathe") el.style.scale = 1 + amplitude * s;
    else if (style === "Float") el.style.translate = `0 ${amplitude * s}px`;
    else el.style.rotate = `${amplitude * s}deg`;
    requestAnimationFrame(f);
  })(performance.now());
}
// UIStaggerIntro: delay_i = baseDelay + i*stagger, styles SlideUp/Down/Left/Right/Pop/Fade
function stagger(els, { baseDelay = .1, step = .07, duration = .42, dist = 28 } = {}) {
  const styles = ["SlideUp", "SlideUp", "SlideUp", "Pop", "Fade"];
  els.forEach((el, i) => {
    const st = el.dataset.intro || styles[i % styles.length];
    const off = { SlideUp: [0, dist], SlideDown: [0, -dist], SlideLeft: [dist, 0], SlideRight: [-dist, 0] }[st] || [0, 0];
    el.style.opacity = 0;
    setTimeout(() => tween(duration, st === "Pop" ? "OutBack" : "OutQuad", t => {
      el.style.opacity = st === "Pop" ? Math.min(1, t * 2) : t;
      el.style.translate = `${off[0] * (1 - t)}px ${off[1] * (1 - t)}px`;
      if (st === "Pop") el.style.scale = lerp(.6, 1, t);
    }, () => { el.style.translate = ""; el.style.scale = ""; el.style.opacity = ""; }), (baseDelay + i * step) * 1000);
  });
}

/* ---------- Panels: BasePanel show/hide (random style of 10, from BasePanel..cctor) ---------- */
const panelStack = [];
function panelRoot(id) { return $("#" + id + " .card"); }
function showPanel(id, opts = {}) {
  const p = $("#" + id); if (p.classList.contains("on")) return;
  const card = panelRoot(id);
  p.classList.add("on"); $("#overlay").classList.add("on"); panelStack.push(id);
  sfx("PanelOpen");
  if (opts.instant) { card.style.cssText += ";opacity:1;scale:1;translate:0 0;rotate:none"; return; }
  const st = D.panelStyles[Math.floor(Math.random() * D.panelStyles.length)];
  p._style = st; kill(card._tw); kill(card._tf);
  const sf = st.scaleFrom, [px, py] = st.positionOffset, [rx, , rz] = st.rotationOffset;
  card._tw = tween(st.showDuration, st.showEase, t => {
    card.style.scale = lerp(sf, 1, t);
    card.style.translate = `${px * (1 - t)}px ${-py * (1 - t)}px`;
    card.style.transform = `perspective(1400px) rotateX(${rx * (1 - t)}deg) rotateZ(${-rz * (1 - t)}deg)`;
  });
  card._tf = tween(st.showDuration * .8, "OutQuad", t => card.style.opacity = t);  // fade = showDuration*0.8, OutQuad
  if (opts.stagger) stagger(opts.stagger, opts.staggerCfg);
}
function hidePanel(id, opts = {}) {
  return new Promise(res => {
    const p = $("#" + id); if (!p.classList.contains("on")) return res();
    const i = panelStack.indexOf(id); if (i >= 0) panelStack.splice(i, 1);
    if (!panelStack.length) $("#overlay").classList.remove("on");
    sfx("PanelClose");
    const card = panelRoot(id), st = p._style;
    if (!st || opts.instant) { p.classList.remove("on"); return res(); }
    const sf = st.scaleFrom, [px, py] = st.positionOffset, [rx, , rz] = st.rotationOffset;
    kill(card._tw); kill(card._tf);
    card._tw = tween(st.hideDuration, st.hideEase, t => {
      card.style.scale = lerp(1, sf, t);
      card.style.translate = `${px * t}px ${-py * t}px`;
      card.style.transform = `perspective(1400px) rotateX(${rx * t}deg) rotateZ(${-rz * t}deg)`;
      card.style.opacity = 1 - t;
    }, () => { p.classList.remove("on"); res(); });
  });
}
$$(".panel .closebtn").forEach(b => b.addEventListener("click", () => hidePanel(b.closest(".panel").id)));

/* ---------- HUD ---------- */
function toast(msg, s = 1.8) {
  const t = $("#toast"); t.textContent = msg; kill(t._tw);
  t._tw = tween(.25, "OutBack", k => { t.style.opacity = k; t.style.scale = lerp(.7, 1, k); });
  clearTimeout(t._h); t._h = setTimeout(() => { t._tw = tween(.25, "InQuad", k => t.style.opacity = 1 - k); }, s * 1000);
}
let shown = {};
function hud() {
  const vals = { coins: fmt(S.coins), gems: fmt(S.gems), rating: S.rating.toFixed(1), level: S.level };
  for (const [k, v] of Object.entries(vals)) $$(".v-" + k).forEach(el => {
    if (shown[k] !== undefined && shown[k] !== v && el.offsetParent) punch(el.parentElement);
    el.textContent = v;
  });
  shown = vals;
  const ready = D.goals.filter(g => (S.goals.progress[g.type] || 0) >= g.target && !S.goals.claimed[g.type]).length;
  $("#goalBadge").textContent = ready; $("#goalBadge").classList.toggle("on", ready > 0);
  const waiting = trayItems().length;  // kept items not yet placed in the room
  $("#displayBadge").textContent = waiting; $("#displayBadge").classList.toggle("on", waiting > 0);
}
function floater(html, x, y) {
  const f = document.createElement("div"); f.className = "floater"; f.innerHTML = html;
  f.style.left = x + "px"; f.style.top = y + "px"; game.appendChild(f);
  tween(1.1, "OutQuad", t => { f.style.translate = `-50% ${-80 * t}px`; f.style.opacity = 1 - Math.max(0, t - .6) / .4; }, () => f.remove());
}
function addCoins(n, x = GAME_W / 2, y = GAME_H / 2) {
  S.coins += n; save(); hud();
  if (n > 0) { sfx(n >= 100 ? "CoinGainBig" : "CoinGain"); floater(`<img src="${U(`img/ui/coin.webp`)}">+${fmt(n)}`, x, y); }
}
function addGems(n, x = GAME_W / 2, y = GAME_H / 2) { S.gems += n; save(); hud(); if (n > 0) { sfx("GemGain"); floater(`<img src="${U(`img/ui/gem.webp`)}">+${n}`, x, y); } }
function addRating(d) {
  if (!d) return;
  S.rating = clamp(+(S.rating + d).toFixed(2), 0, 5); save(); hud(); sfx(d > 0 ? "RatingUp" : "RatingDown");
}
function goal(type, n = 1) {
  const g = D.goals.find(g => g.type === type); if (!g) return;
  const before = S.goals.progress[type] || 0;
  S.goals.progress[type] = Math.min(g.target, before + n); save(); hud();
  if (before < g.target && S.goals.progress[type] >= g.target) toast(`Daily goal done: ${g.name}!`);
}

/* ---------- Polish meter (CoreLoopController) ---------- */
const C = D.core; // cleaningMeterMax 400, meterDrainPerUnitDistance 0.004, polishFullRefillSeconds 900, gemRefillCost 5, meterFullShrinkLevel 50
function meterCap() { const t = clamp(S.level / C.meterFullShrinkLevel, 0, 1); return C.cleaningMeterMax * lerp(1, .3, t); }
function refreshPolish() {
  const cap = meterCap();
  if (S.polish === null) S.polish = cap;
  const dt = (Date.now() - S.polishTime) / 1000;
  S.polish = Math.min(cap, S.polish + dt * cap / C.polishFullRefillSeconds); S.polishTime = Date.now();
}
function drawMeter() {
  // Polish left: starts full (100%) and drains as you clean; at 0% the refill panel opens.
  // Called on every scrub frame: touch the DOM only when what is shown actually changes.
  const cap = meterCap(), f = clamp(S.polish / cap, 0, 1);
  const w = Math.round(f * 500) / 5, pct = Math.ceil(f * 100), low = f < .2, m = drawMeter;
  if (w !== m.w) { m.w = w; meterFill.style.width = w + "%"; }
  if (pct !== m.pct) { m.pct = pct; meterText.textContent = `Polish ${pct}%`; }
  if (low !== m.low) { m.low = low; meterBox.classList.toggle("low", low); }
}
const meterFill = $("#meterFill"), meterText = $("#meterText"), meterBox = $(".meter-row .meter");
setInterval(() => {
  refreshPolish();
  if ($("#clean").classList.contains("active")) drawMeter();
  if ($("#polishPanel").classList.contains("on")) drawPolishPanel();
}, 1000);

/* ---------- Screens ---------- */
function screen(id) {
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === id));
}

const BLUR_CACHE = {};
function blurThumb(src) {
  if (!src) return Promise.resolve("");
  return BLUR_CACHE[src] ||= loadImg(src).then(img => {
    const c = document.createElement("canvas"); c.width = 27; c.height = 48;
    const x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.drawImage(img, 0, 0, c.width, c.height);
    x.fillStyle = "rgba(20,10,4,.3)"; x.fillRect(0, 0, c.width, c.height);  // darken like the old brightness(.72)
    return c.toDataURL();
  }).catch(() => src);
}

/* ---------- Splash (shown only until registerFalconGame calls startLevel) ---------- */
function initView() {
  $$("img[data-src]").forEach(i => { i.src = U(i.dataset.src); });
  // Tall/wide screens: the 9:16 background stays whole and centered (.bgimg), and a blurred copy of the
  // same art fills the extra space around it (.bgblur). The "blur" is a tiny darkened thumbnail made once
  // per image and stretched by the browser — no CSS filter, which re-ran on every repaint and cost frames.
  $$(".bgimg").forEach(bg => {
    const blur = document.createElement("img");
    blur.className = "bgblur"; blur.alt = "";
    bg.before(blur);
    const sync = () => blurThumb(bg.src).then(u => { blur.src = u; });
    sync();
    new MutationObserver(sync).observe(bg, { attributes: true, attributeFilter: ["src"] });
  });
  // SplashAnimator: title parts pop in one after another
  $$(".splash-title .tp").forEach((el, i) => setTimeout(() =>
    tween(.5, "OutBack", t => { el.style.opacity = Math.min(1, t * 2); el.style.scale = lerp(.4, 1, t); }), 200 + i * 180));
  tween(1.2, "OutQuad", t => $("#loadfill").style.width = t * 100 + "%");
}
// Browsers only start audio after a gesture: the first touch starts the track the current screen wants.
addEventListener("pointerdown", () => {
  if (musicName && S.settings.music && (!music || music.paused)) { const n = musicName; musicName = null; playMusic(n, n === "music_menu" ? .6 : .5); }
}, true);

/* ---------- Main menu ---------- */
function goMenu() {
  refreshPolish();
  screen("menu"); playMusic("music_menu", .6);
  const tier = D.tiers[S.tier];
  $("#menuBg").src = U(`img/ui/${tier.bg}.webp`);
  $("#tierName").textContent = tier.name;
  $("#menuStats").textContent = `${S.itemsCleaned} items cleaned · ${S.display.length} on display`;
  hud();
  stagger($$(".menu-title > *, .menu-side .sidebtn, #playBtn"), { baseDelay: .1, step: .06, duration: .42, dist: 28 });
}
idle($("#playBtn"), "Breathe", .025, 2.4);
idle($$(".menu-side.left .sidebtn")[0], "Sway", 1.6, 3.7);
idle($$(".menu-side.left .sidebtn")[1], "Sway", 1.6, 3.2);
$$("[data-open]").forEach(b => b.addEventListener("click", () => openPanel(b.dataset.open)));
$("#playBtn").addEventListener("click", () => startLevel(LEVEL));

function openPanel(id) {
  if (id === "powerPanel") buildPower();
  if (id === "dailyPanel") buildGoals();
  if (id === "shopTierPanel") buildTiers();
  if (id === "shopRatingPanel") $("#ratingInfo").innerHTML = `Great deals and items on display raise your rating.<br>Buyers offer more to well-rated shops (×${(.8 + S.rating * .08).toFixed(2)}).`;
  if (id === "settingsPanel") $$(".toggle").forEach(t => t.classList.toggle("on", !!S.settings[t.dataset.toggle]));
  const list = $("#" + id + " .list");
  showPanel(id, { stagger: list ? [...list.children] : null, staggerCfg: { baseDelay: .12, step: .06, duration: .42, dist: 28 } });
}

/* ---------- Cleaning: wipe reveal ---------- */
const TOOLS = [
  { key: "brush", name: "Brush", ranged: false, loop: "brush", fx: "cloud", size: [256, 256], tipY: 0, label: "Scrub off the dirt" },
  { key: "sprayer", name: "Sprayer", ranged: true, loop: "spray", fx: "foam", size: [105, 382], tipY: 195, label: "Foam it up" },
  { key: "hose", name: "Hose", ranged: true, loop: "hose", fx: "water", size: [60, 360], tipY: 175, label: "Rinse it clean" },
  { key: "towel", name: "Towel", ranged: false, loop: "towel", fx: null, size: [300, 300], tipY: 0, label: "Dry & polish" },
];
const IMG_CACHE = {};
function loadImg(src) {
  if (!IMG_CACHE[src]) IMG_CACHE[src] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  return IMG_CACHE[src];
}
// The wipe canvas is drawn on every scrub frame and read only every 150 ms (via the 64px mask below),
// so keep it GPU-backed: willReadFrequently would force the whole 512px canvas onto the CPU.
const wipe = $("#wipeCanvas"), wctx = wipe.getContext("2d");
// reveal: where the tool has passed this stage; nextCanvas = next stage art clipped to it
const reveal = document.createElement("canvas"); reveal.width = reveal.height = 512;
const rctx = reveal.getContext("2d"), nctx = $("#nextCanvas").getContext("2d"), nextImgEl = $("#nextImg");
function drawNext() {
  if (!R || !R.next) return;
  nctx.globalCompositeOperation = "copy"; nctx.drawImage(reveal, 0, 0);
  nctx.globalCompositeOperation = "source-in"; nctx.drawImage(R.next, ...R.nextRect);
  nctx.globalCompositeOperation = "source-over";
}
const fx = $("#fxCanvas"), fctx = fx.getContext("2d");
const MASK = 64; const mcan = document.createElement("canvas"); mcan.width = mcan.height = MASK; const mctx = mcan.getContext("2d", { willReadFrequently: true });
let R = null; // current round

/* ---------- Levels: one level = one item, in a fixed order ---------- */
// Seeded shuffle so every player meets the items in the same order; no Rare item before level 5.
const ORDER = (() => {
  let seed = 20261104;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const idx = D.items.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const isRare = i => D.items[i].tier === "Rare";
  const early = idx.filter(i => !isRare(i)).slice(0, 4);
  return [...early, ...idx.filter(i => !early.includes(i))];
})();
export const LEVEL_COUNT = ORDER.length;
let LEVEL = 0, levelToken = 0, paused = false;

function hideAllPanels() {
  $$(".panel.on").forEach(p => p.classList.remove("on"));
  panelStack.length = 0; $("#overlay").classList.remove("on");
  $("#decoSell").classList.remove("on"); decoCancelDrag();
}
/** FalconGame.startLevel: land straight in gameplay on item ORDER[index]. */
export function startLevel(index) {
  LEVEL = ((Math.floor(index) % LEVEL_COUNT) + LEVEL_COUNT) % LEVEL_COUNT;
  const token = ++levelToken;
  endDrag(); hideAllPanels(); paused = false;
  deco.focus = null; deco.thenNext = false; $("#decoDone").classList.remove("nudge");
  startItem(D.items[ORDER[LEVEL]], token);
}

async function startItem(item, token) {
  refreshPolish();
  R = { item, stage: 0, revealed: 0, wide: false, busy: true, dragging: false, last: null };
  screen("clean"); playMusic("music_game", .5);
  $("#cleanBg").src = U(`img/ui/${item.bg}.webp`);
  $("#rarityTag").src = U(`img/ui/rarity_${item.tier.toLowerCase()}.webp`);
  $("#itemName").textContent = item.name;
  hud(); drawMeter(); buildToolbar(); updatePU();
  sfx(item.tier === "Rare" ? "RareFound" : item.tier === "Uncommon" ? "UncommonFound" : "ItemSpawn");
  item.stages.forEach(s => loadImg(U("img/items/" + s)));
  nextImgEl.style.opacity = 0; nctx.clearRect(0, 0, 512, 512);  // no flash of the previous item's art
  await setStage(0, true);
  if (token !== levelToken) return;  // another startLevel came in while the images loaded
  const box = $("#wipeBox");
  tween(.45, "OutBack", t => { box.style.scale = lerp(.6, 1, t); box.style.opacity = Math.min(1, t * 2); });
  stagger([$(".item-head"), $(".stage-row"), $(".meter-row"), $(".toolbar")], { baseDelay: .05, step: .06, duration: .4, dist: 26 });
  R.busy = false;
  hooks.levelStart(LEVEL);  // the board is playable
  tutShow(.8);
}
async function setStage(i, first) {
  const round = R;
  R.stage = i; R.revealed = 0; R.base = null; R.wide = false; updatePU();
  const [top, next] = await Promise.all([loadImg(U("img/items/" + R.item.stages[i])), loadImg(U("img/items/" + R.item.stages[i + 1]))]);
  if (R !== round) return;  // the level changed while loading: do not paint the old item
  // Next stage art shows ONLY where the tool has passed (e.g. foam appears where you spray), never as a
  // halo around the current layer; the full image (#nextImg) fades in when the stage completes.
  nextImgEl.src = next.src; nextImgEl.style.opacity = 0;
  const ns = Math.min(512 / next.width, 512 / next.height);
  R.next = next; R.nextRect = [(512 - next.width * ns) / 2, (512 - next.height * ns) / 2, next.width * ns, next.height * ns];
  rctx.clearRect(0, 0, 512, 512); nctx.clearRect(0, 0, 512, 512);
  wctx.globalCompositeOperation = "source-over"; wctx.globalAlpha = 1;
  wctx.clearRect(0, 0, 512, 512);
  const s = Math.min(512 / top.width, 512 / top.height), w = top.width * s, h = top.height * s;
  R.rect = [(512 - w) / 2, (512 - h) / 2, w, h];
  wctx.drawImage(top, ...R.rect);
  wipe.style.opacity = 1;
  // coverage mask = opaque pixels of the layer being wiped
  mctx.clearRect(0, 0, MASK, MASK);
  const k = MASK / 512;
  mctx.drawImage(top, R.rect[0] * k, R.rect[1] * k, w * k, h * k);

  const md = mctx.getImageData(0, 0, MASK, MASK).data;
  R.mask = []; for (let p = 0; p < MASK * MASK; p++) if (md[p * 4 + 3] > 60) R.mask.push(p);
  $$("#stageDots i").forEach((d, j) => d.className = j < i ? "done" : j === i ? "cur" : "");
  $("#stageLabel").textContent = TOOLS[i].label;
  $$(".tool").forEach((t, j) => { t.classList.toggle("cur", j === i); t.classList.toggle("done", j < i); t.classList.toggle("lockd", j > i); });
  updatePct();
  if (!first) {
    const t = $$(".tool")[i]; tween(.3, "OutBack", k => t.style.scale = lerp(1.25, 1, k));
  }
}
function buildToolbar() {
  $("#stageDots").innerHTML = "<i></i>".repeat(4);
  $("#toolbar").innerHTML = TOOLS.map((t, i) => `<div class="tool" data-i="${i}"><img src="${U(`img/ui/tool_${t.key}_icon.webp`)}" alt=""><span>${t.name}</span></div>`).join("");
}
function hint(msg) {
  const h = $("#hint"); h.textContent = msg; h.style.opacity = 1;
  clearTimeout(h._t); h._t = setTimeout(() => {
    tween(.4, "Linear", k => h.style.opacity = 1 - k, () => {
      if (h.classList.contains("tut") && R && S.itemsCleaned === 0) { h.textContent = TUT_TEXT[R.stage]; h.style.opacity = 1; }  // back to the tutorial step
    });
  }, 3500);
}

/* pointer handling: press a tool (or the item) and drag; ranged tools work above the finger */
const cursor = $("#toolCursor");
const wipeBox = $("#wipeBox"); let boxOff = null;
function boxPoint(g) { // game coords -> 512 canvas coords
  // offsetLeft/Top force a layout; read them once per drag (they only change on resize), not per move
  if (!boxOff) boxOff = { x: wipeBox.offsetLeft, y: wipeBox.offsetTop };
  return { x: (g.x - boxOff.x) / 600 * 512, y: (g.y - boxOff.y) / 600 * 512 };
}
function placeCursor(g) {
  const t = TOOLS[R.stage], [w, h] = t.size;
  const sc = t.key === "towel" ? .55 : t.key === "brush" ? .8 : 1;
  const cw = w * sc, ch = h * sc;
  if (cursor._w !== cw || cursor._h !== ch) { cursor._w = cw; cursor._h = ch; cursor.style.width = cw + "px"; cursor.style.height = ch + "px"; }
  // ranged tools: the cleaning point sits rangedTipAnchorY above the finger; the nozzle is JET_GAP below
  // that point and the water jet / foam mist bridges the gap
  const tipX = g.x, tipY = g.y - (t.ranged ? t.tipY : 0);
  // `translate` (not left/top): compositor-only move, and it is applied outside the pick-up `scale` tween
  cursor.style.translate = `${tipX - cw / 2}px ${t.ranged ? tipY + JET_GAP : tipY - ch / 2}px`;
  if (t.ranged) jet.style.translate = `${tipX - jet._w / 2}px ${tipY - JET_OVER}px`;
  return { x: tipX, y: tipY };
}
/* Water jet (hose) / foam mist (sprayer): the fx_spray sprite stretched from the nozzle up to the
   cleaning point, flickering every frame while the tool is held. */
const jet = $("#sprayJet"), JET_GAP = 95, JET_OVER = 30;
let jetRaf = 0;
function jetOn(t) {
  const hose = t.key === "hose";
  jet._w = hose ? 64 : 120; jet._hose = hose;
  jet.style.width = jet._w + "px"; jet.style.height = JET_GAP + JET_OVER + "px";
  jet.style.display = "block";
  if (!jetRaf) jetRaf = requestAnimationFrame(jetTick);
}
function jetOff() { jet.style.display = "none"; cancelAnimationFrame(jetRaf); jetRaf = 0; }
function jetTick() {
  const hose = jet._hose;
  // hose: tight bright jet that pulses in length; sprayer: wide soft mist
  const sx = (Math.random() < .5 ? -1 : 1) * (hose ? rand(.8, 1.15) : rand(.9, 1.3));
  const sy = hose ? rand(.9, 1.08) : rand(.75, 1);
  jet.style.scale = `${sx} ${sy}`;
  jet.style.opacity = hose ? rand(.8, 1) : rand(.6, .85);
  jetRaf = requestAnimationFrame(jetTick);
}
// Native image drag fires pointercancel and drops the tool, so block it everywhere.
document.addEventListener("dragstart", e => e.preventDefault());
// Pressing anywhere in the play area picks up the current tool (toolbar slot, gaps, item, empty table).
// Only a press squarely on a different tool slot is refused.
$("#clean").addEventListener("pointerdown", e => {
  if (!R || R.busy || paused || panelStack.length || R.dragging) return;
  if (e.target.closest("button, .topbar")) return;
  e.preventDefault();
  const g = toGame(e);
  const onTool = e.target.closest(".tool");
  if (onTool && +onTool.dataset.i !== R.stage) {
    sfx("ButtonDenied"); hint(+onTool.dataset.i < R.stage ? "That step is done!" : `Use the ${TOOLS[R.stage].name} first`);
    punch($$(".tool")[R.stage]); return;
  }
  if (S.polish <= 0) { openPolish(); return; }
  const t = TOOLS[R.stage];
  R.dragging = true; R.pointer = e.pointerId; R.last = null; boxOff = null;
  try { $("#clean").setPointerCapture(e.pointerId); } catch {}
  cursor.src = U(`img/ui/tool_${t.key}.webp`); cursor.style.display = "block";
  $$(".tool")[R.stage].classList.add("held");
  kill(cursor._tw); cursor._tw = tween(.18, "OutBack", k => cursor.style.scale = lerp(.6, 1, k));
  sfx("DragPickup"); if (S.settings.sfx) playClip("pop", .7);
  if (t.ranged) jetOn(t);
  tutStop();
  move(g);
});
// Touch screens fire pointermove up to 120-240x a second; draw at most once per frame with the latest
// point (move() interpolates the stroke from the previous point, so nothing is lost).
let pendingMove = null, moveRaf = 0;
function flushMove() {
  moveRaf = 0;
  const g = pendingMove; pendingMove = null;
  if (g && R && R.dragging) move(g);
}
addEventListener("pointermove", e => {
  if (!R || !R.dragging || e.pointerId !== R.pointer) return;
  pendingMove = toGame(e);
  if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
}, { passive: true });
addEventListener("pointerup", e => { if (R && e.pointerId === R.pointer) endDrag(); });
addEventListener("pointercancel", e => { if (R && e.pointerId === R.pointer) endDrag(); });
addEventListener("blur", () => endDrag());
function endDrag() {
  if (!R || !R.dragging) return;
  if (moveRaf) { cancelAnimationFrame(moveRaf); flushMove(); }  // paint the last queued point first
  if (!R.dragging) return;  // that last point emptied the polish and already ended the drag
  R.dragging = false; R.pointer = null; cursor.style.display = "none"; loopOff(TOOLS[R.stage].loop);
  jetOff();
  $$(".tool")[R.stage]?.classList.remove("held");
  updatePct();  // count the last stroke even if it was shorter than one sample interval
  if (!R.busy) tutShow(1.2);  // tutorial: show the hand again if the player stops before the stage is done
}

/* ---------- Tutorial (first item only): a hand shows each tool's gesture, a bubble names the step ---------- */
const TUT_TEXT = [
  "Drag the Brush over the item to scrub off the dirt",
  "Hold the Sprayer under the item — foam sprays out of the nozzle",
  "Rinse the foam away with the Hose",
  "Dry & polish it with the Towel",
];
const tutHand = $("#tutHand");
let tutToken = 0;
const tutOn = () => R && S.itemsCleaned === 0 && !R.busy && !R.dragging && !paused;
function tutStop() {
  tutToken++;
  tutHand.style.display = "none"; tutHand.style.opacity = 0;
}
function tutEnd() {
  tutStop();
  const h = $("#hint"); h.classList.remove("tut"); h.style.opacity = 0;
}
async function tutShow(delay = .5) {
  if (!R || S.itemsCleaned !== 0) return;
  const token = ++tutToken;
  const h = $("#hint");
  clearTimeout(h._t); h.classList.add("tut"); h.textContent = TUT_TEXT[R.stage]; h.style.opacity = 1;
  await wait(delay);
  // the hand's fingertip is at (27, 9) in its 96x120 box
  const place = (x, y) => { tutHand.style.translate = `${x - 27}px ${y - 9}px`; };
  const step = (dur, ease, fn) => new Promise(r => tween(dur, ease, fn, r));
  while (token === tutToken && R && S.itemsCleaned === 0) {
    // paused, a panel open, or the stage is changing: hide the hand and check again shortly
    if (!tutOn() || panelStack.length) { tutHand.style.display = "none"; await wait(.3); continue; }
    const t = TOOLS[R.stage], slot = $$(".tool")[R.stage];
    if (!slot) return;
    const gr = game.getBoundingClientRect(), sr = slot.getBoundingClientRect();
    const from = { x: (sr.left + sr.width / 2 - gr.left) / SCALE, y: (sr.top + sr.height * .45 - gr.top) / SCALE };
    // finger target: item centre; ranged tools are held BELOW the item (the spray reaches up to it)
    const bx = wipeBox.offsetLeft + 300, by = wipeBox.offsetTop + 300 + (t.ranged ? t.tipY : 0);
    const to = { x: bx, y: Math.min(by, from.y - 40) };
    tutHand.style.display = "block"; place(from.x, from.y);
    await step(.25, "OutQuad", k => { tutHand.style.opacity = k; tutHand.style.scale = lerp(1.2, 1, k); });
    if (token !== tutToken) return;
    await step(.12, "OutQuad", k => { tutHand.style.scale = lerp(1, .88, k); });         // press
    await step(.7, "InOutSine", k => place(lerp(from.x, to.x, k), lerp(from.y, to.y, k)));  // drag onto the item
    if (token !== tutToken) return;
    await step(1.3, "Linear", k => place(to.x + Math.sin(k * Math.PI * 4) * 120, to.y - Math.sin(k * Math.PI * 2) * 30));  // scrub
    if (token !== tutToken) return;
    await step(.25, "Linear", k => { tutHand.style.opacity = 1 - k; tutHand.style.scale = lerp(.88, 1, k); });
    await wait(.45);
  }
  if (token === tutToken) tutHand.style.display = "none";
}
let lastSample = 0;
const STAMPS = {};
function brushStamp(rad) {
  const key = Math.round(rad);
  if (STAMPS[key]) return STAMPS[key];
  const c = document.createElement("canvas"); c.width = c.height = key * 2;
  const x = c.getContext("2d"), gr = x.createRadialGradient(key, key, 0, key, key, key);
  gr.addColorStop(0, "rgba(0,0,0,.9)"); gr.addColorStop(.6, "rgba(0,0,0,.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = gr; x.fillRect(0, 0, key * 2, key * 2);
  return (STAMPS[key] = c);
}
function move(g) {
  const tip = placeCursor(g), p = boxPoint(tip), t = TOOLS[R.stage];
  const inside = p.x > -60 && p.x < 572 && p.y > -60 && p.y < 572;
  if (!inside) { loopOff(t.loop); R.last = null; return; }
  loopOn(t.loop, .65);
  // brushRadiusInMaskPixels 40 on a 512 mask shown at maxDisplaySize 800 → 53 on our 600px box; wide x2
  const rad = 53 * (R.wide ? 2 : 1) * (t.key === "towel" ? 1.3 : 1);
  const from = R.last || p, dist = Math.hypot(p.x - from.x, p.y - from.y);
  wctx.globalCompositeOperation = "destination-out";
  const steps = Math.max(1, Math.ceil(dist / (rad * .25)));
  const stamp = brushStamp(rad);  // same soft radial falloff, rendered once instead of a gradient per step
  for (let s = 1; s <= steps; s++) {
    const x = lerp(from.x, p.x, s / steps), y = lerp(from.y, p.y, s / steps);
    wctx.drawImage(stamp, x - rad, y - rad);
    rctx.drawImage(stamp, x - rad, y - rad);
  }
  wctx.globalCompositeOperation = "source-over";
  drawNext();
  R.last = p;
  // CoreLoopController: polish -= distance moved over the item × meterDrainPerUnitDistance (0.004), distance
  // measured in the 512px cleaning-mask space the brush works in (brushRadiusInMaskPixels); meter starts at
  // cleaningMeterMax (400) and its capacity shrinks with shop level up to meterFullShrinkLevel (50).
  if (dist > 0) {
    S.polish = Math.max(0, S.polish - dist * C.meterDrainPerUnitDistance);
    drawMeter();
    if (S.polish / meterCap() < .2 && !R.lowWarned) { R.lowWarned = true; sfx("MeterLow"); }
    if (S.polish <= 0) { endDrag(); sfx("MeterEmpty"); openPolish(); save(); return; }
  }
  if (Math.random() < .55) spawnFx(t.fx, tip.x, tip.y);
  if (Math.random() < .25) vibe(6);
  const now = performance.now();
  if (now - lastSample > 150) { lastSample = now; updatePct(); }   // percentSampleInterval 0.15
}
function updatePct() {
  if (!R || !R.mask) return;
  mctx.clearRect(0, 0, MASK, MASK); mctx.drawImage(wipe, 0, 0, MASK, MASK);
  const d = mctx.getImageData(0, 0, MASK, MASK).data;
  let left = 0; for (const p of R.mask) if (d[p * 4 + 3] > 60) left++;
  const raw = 1 - left / Math.max(1, R.mask.length);
  if (R.base == null) R.base = raw;  // edge resampling makes an untouched layer read a few % — treat that as 0
  R.revealed = clamp((raw - R.base) / (1 - R.base), 0, 1);
  const shownPct = clamp(R.revealed / R.item.cleanThreshold, 0, 1);
  $("#pct").textContent = Math.floor(shownPct * 100) + "%";
  if (R.revealed >= R.item.cleanThreshold && !R.busy) completeStage();
}
async function completeStage() {
  R.busy = true; endDrag();
  sfx("StageAdvance"); vibe(30);
  tutStop();
  await new Promise(r => tween(.3, "OutQuad", t => { wipe.style.opacity = 1 - t; nextImgEl.style.opacity = t; }, r));
  sparkleBurst();
  if (R.stage >= 3) { await wait(.4); tutEnd(); return itemCleaned(); }
  await setStage(R.stage + 1);
  R.busy = false;
  tutShow();
}

/* particles (Smoke / Particles / Water Particle / Drops from the Unity scene) */
const FX_IMG = {}; ["cloud", "splash", "foam", "spray"].forEach(k => loadImg(U(`img/ui/fx_${k}.webp`)).then(i => FX_IMG[k] = i));
const parts = [];
function spawnFx(kind, gx, gy) {
  if (!kind || parts.length > 120) return;  // cap: a fast scrub must not pile up hundreds of sprites
  // fxCanvas sits at the wipe box's top-left minus 60px; the box moves with the screen size (--ex/--exw)
  const bx = boxOff ? boxOff.x : wipeBox.offsetLeft, by = boxOff ? boxOff.y : wipeBox.offsetTop;
  const x = gx - (bx - 60), y = gy - (by - 60);
  if (kind === "cloud") parts.push({ img: "cloud", x, y, vx: rand(-40, 40), vy: rand(-60, -20), life: .7, t: 0, s: rand(40, 80), rot: rand(0, 6), a: .55, grow: 1.6, frame: Math.floor(rand(0, 4)) });
  if (kind === "foam") for (let i = 0; i < 2; i++) parts.push({ img: "foam", x: x + rand(-20, 20), y: y + rand(-20, 20), vx: rand(-90, 90), vy: rand(-90, 60), life: .6, t: 0, s: rand(26, 50), rot: rand(0, 6), a: .9, grow: .6 });
  if (kind === "water") for (let i = 0; i < 3; i++) parts.push({ img: "splash", x, y, vx: rand(-220, 220), vy: rand(-260, -40), g: 900, life: .55, t: 0, s: rand(30, 60), rot: rand(0, 6), a: .85, grow: .8 });
}
function sparkleBurst() {
  for (let i = 0; i < 26; i++) {
    const a = rand(0, Math.PI * 2), v = rand(150, 420);
    parts.push({ img: "star", x: 360, y: 360, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 300, life: .9, t: 0, s: rand(18, 36), rot: rand(0, 6), a: 1, grow: .3 });
  }
}
const starImg = new Image(); starImg.src = U("img/ui/star.webp");
let lastF = performance.now(), fxDirty = false;
(function fxLoop(now) {
  const dt = Math.min(.05, (now - lastF) / 1000); lastF = now;
  if (parts.length || fxDirty) {  // idle frames (no particles, canvas already clear) cost nothing
    fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.globalAlpha = 1;
    fctx.clearRect(0, 0, 720, 720);
    let n = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]; p.t += dt;
      if (p.t >= p.life) continue;
      parts[n++] = p;  // compact in place (no splice per dead particle)
      p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.t / p.life, img = p.img === "star" ? starImg : FX_IMG[p.img]; if (!img) continue;
      const s = p.s * (1 + p.grow * k), r = p.rot + k, c = Math.cos(r), sn = Math.sin(r);
      fctx.globalAlpha = p.a * (1 - k); fctx.setTransform(c, sn, -sn, c, p.x, p.y);
      if (p.img === "cloud") { const fw = img.width / 2, fh = img.height / 2; fctx.drawImage(img, (p.frame % 2) * fw, Math.floor(p.frame / 2) * fh, fw, fh, -s / 2, -s / 2, s, s); }
      else fctx.drawImage(img, -s / 2, -s / 2, s, s);
    }
    parts.length = n;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fxDirty = n > 0;
  }
  requestAnimationFrame(fxLoop);
})(lastF);

/* ---------- Power-ups ---------- */
function puData(type) { return D.powerUps.find(p => p.type === type); }
function updatePU() {
  $$(".pubtn").forEach(b => {
    const pu = puData(b.dataset.pu), locked = S.level < pu.unlock;
    b.classList.toggle("locked", locked);
    b.classList.toggle("active", !!(R && R.wide && pu.type === "WideBrush"));
    b.querySelector("b").textContent = locked ? `Lv${pu.unlock}` : S.powerUps[pu.type] > 0 ? S.powerUps[pu.type] : "+";
  });
}
$$(".pubtn").forEach(b => b.addEventListener("click", () => {
  if (!R || R.busy) return;
  const pu = puData(b.dataset.pu);
  if (S.level < pu.unlock) { sfx("ButtonDenied"); return toast(`Unlocks at shop level ${pu.unlock}`); }
  if (!S.powerUps[pu.type]) return openPanel("powerPanel");
  if (pu.type === "WideBrush") { if (R.wide) return; R.wide = true; sfx("PowerUpWideBrush"); toast("Wide Brush! Bigger swipes this stage"); }
  if (pu.type === "DeepClean") { sfx("PowerUpDeepClean"); toast("Deep Clean!"); wctx.clearRect(0, 0, 512, 512); R.revealed = 1; completeStage(); }
  S.powerUps[pu.type]--; save(); updatePU();
  tween(.35, "OutBack", t => b.style.scale = lerp(1.35, 1, t));
}));
function buildPower() {
  $("#powerList").innerHTML = D.powerUps.slice().sort((a, b) => a.unlock - b.unlock).map(pu => {
    const locked = S.level < pu.unlock, cur = pu.currency === "Gems" ? "gem" : "coin";
    return `<div class="row-card"><img src="${U(`img/ui/pu_${pu.type.toLowerCase()}.webp`)}" alt="">
      <div><b>${pu.name}</b> <small>${pu.desc}</small><small>Owned: ${S.powerUps[pu.type] || 0}${locked ? ` · Unlocks at level ${pu.unlock}` : ""}</small></div>
      <button class="smallbtn green" data-buypu="${pu.type}" ${locked ? "disabled" : ""}><img src="${U(`img/ui/${cur}.webp`)}" alt="">${pu.cost}</button></div>`;
  }).join("");
  $$("[data-buypu]").forEach(b => b.addEventListener("click", () => {
    const pu = puData(b.dataset.buypu), key = pu.currency === "Gems" ? "gems" : "coins";
    if (S[key] < pu.cost) { sfx("ButtonDenied"); return toast(`Not enough ${key}`); }
    S[key] -= pu.cost; S.powerUps[pu.type] = (S.powerUps[pu.type] || 0) + 1; save(); hud();
    sfx(key === "gems" ? "GemSpend" : "CoinSpend"); sfx("PurchaseSuccess"); buildPower(); updatePU();
    if (pu.type === "Handshake" || pu.type === "GoodWill") toast(`${pu.name} will be used in your next deal`);
  }));
}

/* ---------- Item cleaned → sell or keep ---------- */
async function itemCleaned() {
  S.itemsCleaned++; S.xp++; goal("CleanItems");
  const lvBefore = S.level; S.level = 1 + S.itemsCleaned; save(); hud();
  sfx("ItemCleaned");
  const it = R.item;
  $("#cleanedImg").src = U("img/items/" + it.stages[4]);
  $("#cleanedRarity").src = U(`img/ui/rarity_${it.tier.toLowerCase()}.webp`);
  $("#cleanedName").textContent = it.name;
  $("#keepBtn").disabled = S.display.includes(it.id);
  showPanel("cleanedPanel", { stagger: [$("#cleanedPanel .banner"), $("#cleanedPanel .itemframe"), $("#cleanedRarity"), $("#cleanedName"), ...$$("#cleanedPanel .row2 .bigbtn")] });
  const unlocked = D.powerUps.find(p => p.unlock > lvBefore && p.unlock <= S.level);
  if (unlocked) setTimeout(() => { sfx("BoosterUnlocked"); toast(`New power-up unlocked: ${unlocked.name}!`, 2.4); }, 900);
}
$("#keepBtn").addEventListener("click", async () => {
  const it = R.item; sfx("KeepItem");
  if (!S.display.includes(it.id)) S.display.push(it.id);
  addRating(it.ratingBonusDisplay);
  hooks.win();  // the item is resolved: level cleared
  await hidePanel("cleanedPanel");
  // Straight into the display room to place it; Done there moves on to the next item.
  openDecorate({ focus: it.id, thenNext: true });
});
$("#sellBtn").addEventListener("click", async () => { await hidePanel("cleanedPanel"); openHaggle(); });

/* ---------- Haggle ---------- */
let H = null;
function openHaggle() {
  const it = R.item;
  const value = lerp(it.priceMin, it.priceMax, rand(.25, .85)) * (.8 + S.rating * .08);
  const offer = Math.round(value * (1 - it.stinginess * rand(.1, .3)));
  const lo = Math.round(offer * .6), hi = Math.round(offer * 1.6);
  H = { offer, lo, hi, ask: Math.round(offer * 1.1) };
  $("#haggleImg").src = U("img/items/" + it.stages[4]);
  $("#buyerOffer").textContent = "$" + fmt(offer);
  const pos = v => (v - lo) / (hi - lo) * 100;
  $(".zone.fair").style.width = pos(offer) + "%";
  $(".zone.high").style.width = pos(offer * (1 + it.looseGap)) - pos(offer) + "%";
  $("#offerMarker").style.left = pos(offer) + "%";
  setAsk(H.ask, true);
  sfx("BuyerArrive");
  showPanel("hagglePanel", { stagger: $$("#hagglePanel .card > *") });
}
function setAsk(v, silent) {
  const it = R.item;
  v = Math.round(clamp(v, H.lo, H.hi));
  if (v !== H.ask && !silent) sfx("PriceTick");
  H.ask = v;
  $("#askPrice").textContent = "$" + fmt(v);
  $("#priceKnob").style.left = (v - H.lo) / (H.hi - H.lo) * 100 + "%";
  const gap = (v - H.offer) / H.offer;
  const r = gap <= 0 ? "fair" : gap <= it.looseGap ? "bithigh" : "toohigh";
  if (r !== H.reaction) {
    H.reaction = r;
    $("#reactionImg").src = U(`img/ui/face_${r}.webp`);
    $("#reactionText").textContent = { fair: "That sounds fair!", bithigh: "Hmm… a bit high.", toohigh: "Way too much!" }[r];
    if (!silent) sfx({ fair: "ReactionFair", bithigh: "ReactionBitHigh", toohigh: "ReactionTooHigh" }[r]);
    punch($("#reactionImg"));
  }
}
(() => {
  const tr = $("#priceTrack"); let drag = false;
  const at = e => { const r = tr.getBoundingClientRect(); setAsk(H.lo + clamp((e.clientX - r.left) / r.width, 0, 1) * (H.hi - H.lo)); };
  tr.addEventListener("pointerdown", e => { drag = true; tr.setPointerCapture(e.pointerId); at(e); });
  tr.addEventListener("pointermove", e => drag && at(e));
  tr.addEventListener("pointerup", () => drag = false);
})();
$("#nudgeUp").addEventListener("click", () => setAsk(H.ask + Math.max(1, H.offer * .02)));   // nudgeStepPercent 0.02
$("#nudgeDown").addEventListener("click", () => setAsk(H.ask - Math.max(1, H.offer * .02)));
$("#lockBtn").addEventListener("click", async () => {
  const it = R.item; sfx("LockIn");
  await wait(.6);   // resolutionBeatSeconds
  let gap = (H.ask - H.offer) / H.offer, kind, paid, dRating = 0;
  if (S.handshake || (S.powerUps.Handshake > 0 && S.level >= puData("Handshake").unlock && confirmHandshake())) { gap = 0; S.handshake = false; }
  if (gap <= 0 && gap >= -it.tightGap) { kind = "great"; paid = H.ask; dRating = it.ratingBonusTight; }
  else if (gap < -it.tightGap) { kind = "fair"; paid = H.ask; }
  else if (gap <= it.tightGap) { kind = "great"; paid = H.ask; dRating = it.ratingBonusTight; }
  else { kind = "tough"; paid = Math.round(H.offer * .9); dRating = -it.ratingPenaltyWalk; }
  if (dRating < 0 && S.goodWill) { dRating = 0; S.goodWill = false; toast("Good Will shielded your rating!"); }
  await hidePanel("hagglePanel");
  showSale(kind, paid, dRating);
});
function confirmHandshake() { S.powerUps.Handshake--; sfx("PowerUpHandshake"); toast("Handshake! Guaranteed Great Deal"); return true; }

function showSale(kind, paid, dRating) {
  const it = R.item;
  $("#saleBanner").src = U(`img/ui/deal_${kind}.webp`);
  $("#saleImg").src = U("img/items/" + it.stages[4]);
  $("#saleAvatar").src = { great: U("img/ui/avatar.webp"), fair: U("img/ui/face_bithigh.webp"), tough: U("img/ui/face_toohigh.webp") }[kind];
  $("#saleBubble").textContent = { great: "Pleasure doing business!", fair: "What a bargain, thanks!", tough: "I'll pay this, take it or leave it." }[kind];
  $("#saleCoins").textContent = "+" + fmt(paid);
  $("#saleRating").textContent = dRating ? `Rating ${dRating > 0 ? "+" : ""}${dRating.toFixed(2)}` : "Rating unchanged";
  $("#saleFlavor").textContent = { great: "Spot on — right at the buyer's limit.", fair: "Sold, but you left some coins on the table.", tough: "You pushed too hard. The buyer haggled you down." }[kind];
  sfx({ great: "DealGreat", fair: "DealOk", tough: "DealBad" }[kind]);
  showPanel("salePanel", { stagger: $$("#salePanel .card > *"), staggerCfg: { baseDelay: .08, step: .045, duration: .4, dist: 26 } });
  if (kind === "great") goal("CloseFullPriceDeals");
  if (it.tier === "Rare") goal("SellRareItem");
  setTimeout(async () => {
    addCoins(paid, GAME_W / 2, 700 + (GAME_H - 1280) / 2); addRating(dRating); sfx("SellConfirm");
    hooks.win();  // the item is sold: level cleared
    await wait(2.2 - .9);   // SaleToastPanel autoHideDelay 2.2
    await hidePanel("salePanel");
    await wait(C.postResolutionDelay); nextRound();
  }, 900);
}
function nextRound() {
  const tierNext = D.tiers[S.tier + 1];
  if (tierNext && S.level >= tierNext.level) toast(`New shop upgrade available: ${tierNext.name}!`, 2.4);
  startLevel(LEVEL + 1);
}

/* ---------- Out of polish ---------- */
function openPolish() { drawPolishPanel(); showPanel("polishPanel"); }
function drawPolishPanel() {
  const cap = meterCap(), f = S.polish / cap;
  $("#polishFill").style.width = f * 100 + "%";
  const secs = Math.ceil((cap - S.polish) / cap * C.polishFullRefillSeconds);
  $("#polishTimer").textContent = f >= 1 ? "Polish is full!" : `Full refill in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  $("#gemRefillBtn").innerHTML = `Refill now <img src="${U(`img/ui/gem.webp`)}" style="width:36px;vertical-align:middle"> ${C.gemRefillCost}`;
}
function refill() { S.polish = meterCap(); S.polishTime = Date.now(); R && (R.lowWarned = false); save(); drawMeter(); sfx("MeterRefill"); hidePanel("polishPanel"); }
$("#adRefillBtn").addEventListener("click", async () => { $("#adRefillBtn").textContent = "Ad is loading..."; await wait(1.2); $("#adRefillBtn").textContent = "Watch Ad for Full Refill"; refill(); });
$("#gemRefillBtn").addEventListener("click", () => {
  if (S.gems < C.gemRefillCost) { sfx("ButtonDenied"); return toast("Not enough gems"); }
  S.gems -= C.gemRefillCost; sfx("GemSpend"); hud(); refill();
});

/* ---------- Pause ---------- */
// PausePanel has disableShowHideAnimation = true: it appears instantly, children use UIStaggerIntro
$("#pauseBtn").addEventListener("click", () => {
  endDrag();
  const els = [$("#pausePanel .ptitle"), $("#resumeBtn"), $("#restartBtn"), $("#homeBtn")];
  els[0].dataset.intro = "SlideDown"; els.slice(1).forEach(e => e.dataset.intro = "SlideUp");
  showPanel("pausePanel", { instant: true });
  stagger(els, { baseDelay: .1, step: .07, duration: .42, dist: 28 });
  if (music) music.volume *= .3;   // pauseDuck 0.3
});
const unduck = () => { if (music) music.volume = Math.min(.35, music.volume / .3); };
$("#resumeBtn").addEventListener("click", () => { hidePanel("pausePanel", { instant: true }); unduck(); });
$("#restartBtn").addEventListener("click", async () => { await hidePanel("pausePanel", { instant: true }); unduck(); sfx("RoundRestart"); startLevel(LEVEL); });
$("#homeBtn").addEventListener("click", async () => { await hidePanel("pausePanel", { instant: true }); R = null; goMenu(); });

/* ---------- Daily goals / tiers / display / store / settings ---------- */
function buildGoals() {
  $("#goalList").innerHTML = D.goals.map(g => {
    const p = S.goals.progress[g.type] || 0, done = p >= g.target, cl = S.goals.claimed[g.type];
    const cur = g.currency === "Gems" ? "gem" : "coin";
    return `<div class="row-card"><img src="${U(`img/ui/${g.currency === "Gems" ? "gems_pile" : "coins_pile"}.webp`)}" alt="">
      <div><b>${g.name}</b><small>${p} / ${g.target}</small><div class="progress"><div style="width:${p / g.target * 100}%"></div></div></div>
      <button class="smallbtn ${done && !cl ? "green" : "orange"}" data-claim="${g.type}" ${!done || cl ? "disabled" : ""}>${cl ? "Claimed" : `<img src="${U(`img/ui/${cur}.webp`)}" alt="">${g.amount}`}</button></div>`;
  }).join("");
  $$("[data-claim]").forEach(b => b.addEventListener("click", () => {
    const g = D.goals.find(x => x.type === b.dataset.claim);
    S.goals.claimed[g.type] = true;
    g.currency === "Gems" ? addGems(g.amount) : addCoins(g.amount);
    buildGoals(); hud();
  }));
}
function buildTiers() {
  $("#tierList").innerHTML = D.tiers.map((t, i) => {
    const owned = i <= S.tier, can = i === S.tier + 1 && S.level >= t.level;
    return `<div class="row-card"><img src="${U(`img/ui/${t.bg}.webp`)}" alt="" style="border-radius:14px;object-fit:cover">
      <div><b>${t.name}</b><small>${i === 0 ? "Your first shop" : `Requires shop level ${t.level}`}</small></div>
      <button class="smallbtn green" data-tier="${i}" ${owned || !can ? "disabled" : ""}>${owned ? "Owned" : `<img src="${U(`img/ui/coin.webp`)}" alt="">${fmt(t.cost)}`}</button></div>`;
  }).join("");
  $$("[data-tier]").forEach(b => b.addEventListener("click", () => {
    const t = D.tiers[+b.dataset.tier];
    if (S.coins < t.cost) { sfx("ButtonDenied"); return toast("Not enough coins"); }
    S.coins -= t.cost; S.tier = +b.dataset.tier; save(); sfx("TierUnlock"); hud(); buildTiers();
    $("#menuBg").src = U(`img/ui/${t.bg}.webp`); $("#tierName").textContent = t.name;
    toast(`Welcome to ${t.name}!`);
  }));
}
/* ---------- Decorate: the display room (DisplayRoomPanel / DisplaySlotView / DisplayTrayCellView) ----------
   Kept items wait in the "Your Items" tray; drag one onto a free slot of its displayCategory
   (Hangable → clothes rail, Shelf → shelves). Placed items can be dragged to another slot (swap),
   back to the tray, or tapped to sell. Slots and room art change with the shop tier. */
const DECO = D.decorate;                 // trayScrollSeconds 0.25, dragGhostSize 240, dragGhostLift 70, dropPadding 25
const RS = 720 / 1080;                   // the room was laid out on 1080x1920; our room layer is 720x1280
const RARITY_COLOR = { Common: "#9aa3ad", Uncommon: "#4cb050", Rare: "#a259e6" };
const itemById = id => D.items.find(i => i.id === id);
function placedMap() { return (S.placed[S.tier] ||= {}); }
function trayItems() {
  const used = new Set(Object.values(S.placed[S.tier] || {}));
  const ids = S.display.filter(id => !used.has(id));
  const f = typeof deco !== "undefined" && deco.focus;  // the item just kept goes first in the tray
  if (f && ids.includes(f)) ids.sort((a, b) => (b === f) - (a === f));
  return ids.map(itemById).filter(Boolean);
}
function slotDefs() { return D.displaySlots[S.tier] || []; }
/** The track the visible screen wants (SoundBank music ids Menu / Gameplay / Decorate). */
function playScreenMusic() {
  const id = $(".screen.active")?.id;
  if (id === "decorate") playMusic("music_decorate", .5);
  else if (id === "clean") playMusic("music_game", .5);
  else playMusic("music_menu", .6);
}
// `var`, not `let`: hud() → trayItems() may read it before this line has run.
var deco = { drag: null, pending: null, scrollX: 0, scrollTw: null, focus: null, thenNext: false };

/** opts.focus = item id just kept (first in the tray, highlighted); opts.thenNext = Done goes to the next level. */
function openDecorate(opts = {}) {
  deco.focus = opts.focus || null; deco.thenNext = !!opts.thenNext;
  screen("decorate"); playMusic("music_decorate", .5);
  $("#roomBg").src = U(`img/ui/room_${S.tier + 1}.webp`);
  // forget placements of items that are no longer on display (sold from the room)
  const pm = placedMap();
  for (const [slot, id] of Object.entries(pm)) if (!S.display.includes(id)) delete pm[slot];
  deco.scrollX = 0;
  buildSlots(); buildTray();
  stagger([$(".deco-top"), $(".tray"), ...$$("#slots .slot.filled")], { baseDelay: .05, step: .04, duration: .4, dist: 26 });
  if (deco.focus) {
    const it = itemById(deco.focus);
    setTimeout(() => toast(it.displayCategory === "Hangable" ? "Drag it onto the clothes rail!" : "Drag it onto a shelf!", 2.6), 450);
    // empty slots it fits glow once so the player sees where it can go
    setTimeout(() => $$(`#slots .slot[data-cat="${it.displayCategory}"]:not(.filled)`).forEach(s => {
      s.classList.add("invite"); setTimeout(() => s.classList.remove("invite"), 1800);
    }), 500);
  }
}
function leaveDecorate() {
  const next = deco.thenNext;
  deco.focus = null; deco.thenNext = false; $("#decoDone").classList.remove("nudge");
  if (next) nextRound(); else goMenu();
}
function slotRect(def) {   // centre-origin, y-up on 1080x1920 → top-left px on the 720x1280 room layer
  const w = def.w * RS, h = def.h * RS;
  return { x: 360 + def.x * RS - w / 2, y: 640 - def.y * RS - h / 2, w, h };
}
function buildSlots() {
  const pm = placedMap();
  $("#slots").innerHTML = slotDefs().map(def => {
    const r = slotRect(def), id = pm[def.id], it = id && itemById(id);
    return `<div class="slot ${def.align}${it ? " filled" : ""}" data-slot="${def.id}" data-cat="${def.cat}"
      style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">${it ? `<img src="${U(`img/items/${it.stages[4]}`)}" alt="${it.name}">` : ""}</div>`;
  }).join("");
}
function buildTray() {
  const items = trayItems();
  $("#trayContent").innerHTML = items.map(it => `<div class="tray-cell${it.id === deco.focus ? " focus" : ""}" data-item="${it.id}" style="--rc:${RARITY_COLOR[it.tier]}">
      <img src="${U(`img/items/${it.stages[4]}`)}" alt="${it.name}">
      <span class="cat"><img src="${U(it.displayCategory === "Hangable" ? "img/ui/hanger.webp" : "img/ui/star.webp")}" alt=""></span></div>`).join("");
  $(".tray").classList.toggle("empty", !items.length);
  setTrayScroll(deco.scrollX, true); hud();
}
function trayMax() { return Math.max(0, $("#trayContent").scrollWidth - $("#trayScroll").clientWidth); }
function setTrayScroll(x, instant) {
  kill(deco.scrollTw);
  const to = clamp(x, 0, trayMax()), from = deco.scrollX;
  const apply = v => { deco.scrollX = v; $("#trayContent").style.transform = `translateX(${-v}px)`; };
  if (instant) apply(to); else deco.scrollTw = tween(DECO.trayScrollSeconds, "OutQuad", t => apply(lerp(from, to, t)));
  $("#trayLeft").disabled = to <= 0; $("#trayRight").disabled = to >= trayMax();
}
$("#trayLeft").addEventListener("click", () => setTrayScroll(deco.scrollX - $("#trayScroll").clientWidth * .8));
$("#trayRight").addEventListener("click", () => setTrayScroll(deco.scrollX + $("#trayScroll").clientWidth * .8));
$("#decorateBtn").addEventListener("click", () => openDecorate());
$("#decoDone").addEventListener("click", () => leaveDecorate());

/* drag & drop */
function roomPoint(g) {   // game coords → room-layer coords (the room is centred like .bgimg)
  return { x: g.x - (GAME_W - 720) / 2, y: g.y - (GAME_H - 1280) / 2 };
}
function hitSlot(g, cat) {
  const p = roomPoint(g), pad = DECO.dropPadding * RS;
  let best = null, bestD = Infinity;
  for (const def of slotDefs()) {
    if (def.cat !== cat) continue;
    const r = slotRect(def);
    if (p.x < r.x - pad || p.x > r.x + r.w + pad || p.y < r.y - pad || p.y > r.y + r.h + pad) continue;
    const d = Math.hypot(p.x - (r.x + r.w / 2), p.y - (r.y + r.h / 2));
    if (d < bestD) { bestD = d; best = def; }
  }
  return best;
}
function overTray(g) {
  const t = $(".tray"); return g.y > t.offsetTop - 20;
}
$("#decorate").addEventListener("pointerdown", e => {
  if (deco.drag || $("#decoSell").classList.contains("on")) return;
  const cell = e.target.closest(".tray-cell"), slot = e.target.closest(".slot.filled");
  const inTray = e.target.closest(".tray-scroll");
  if (!cell && !slot && !inTray) return;
  e.preventDefault();
  try { $("#decorate").setPointerCapture(e.pointerId); } catch {}
  const g = toGame(e);
  deco.pending = { pointer: e.pointerId, x0: g.x, y0: g.y, scroll0: deco.scrollX, mode: null,
    id: cell ? cell.dataset.item : slot ? placedMap()[slot.dataset.slot] : null,
    fromSlot: slot ? slot.dataset.slot : null, el: cell || slot };
});
addEventListener("pointermove", e => {
  const pd = deco.pending; if (!pd || e.pointerId !== pd.pointer) return;
  const g = toGame(e), dx = g.x - pd.x0, dy = g.y - pd.y0;
  if (!pd.mode) {
    if (!pd.fromSlot && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) pd.mode = "scroll";  // swipe the tray
    else if (pd.id && Math.hypot(dx, dy) > 10) startDrag(pd);
    else return;
  }
  if (pd.mode === "scroll") setTrayScroll(pd.scroll0 - dx, true);
  if (pd.mode === "drag") moveDrag(g);
}, { passive: true });
addEventListener("pointerup", e => { const pd = deco.pending; if (pd && e.pointerId === pd.pointer) endDecoPointer(toGame(e)); });
addEventListener("pointercancel", e => { const pd = deco.pending; if (pd && e.pointerId === pd.pointer) decoCancelDrag(); });

function startDrag(pd) {
  const it = itemById(pd.id); if (!it) return;
  pd.mode = "drag"; deco.drag = { it };
  const ghost = $("#dragGhost"); ghost.src = U(`img/items/${it.stages[4]}`); ghost.style.display = "block";
  kill(ghost._tw); ghost._tw = tween(.18, "OutBack", k => ghost.style.scale = lerp(.6, 1, k));
  pd.el.classList.add("lifted");
  $("#decorate").classList.add("dragging");
  $$("#slots .slot").forEach(s => { const ok = s.dataset.cat === it.displayCategory; s.classList.toggle("ok", ok); s.classList.toggle("no", !ok); });
  sfx("DragPickup"); vibe(8);
}
function moveDrag(g) {
  const size = DECO.dragGhostSize * RS, lift = DECO.dragGhostLift * RS, ghost = $("#dragGhost");
  ghost.style.left = g.x - size / 2 + "px"; ghost.style.top = g.y - size / 2 - lift + "px";
  const hot = hitSlot({ x: g.x, y: g.y - lift }, deco.drag.it.displayCategory);
  $$("#slots .slot").forEach(s => s.classList.toggle("hot", !!hot && s.dataset.slot === hot.id));
}
function decoCancelDrag() {
  if (deco.pending?.el) deco.pending.el.classList.remove("lifted");
  deco.pending = null; deco.drag = null;
  $("#dragGhost").style.display = "none";
  $("#decorate").classList.remove("dragging");
  $$("#slots .slot").forEach(s => s.classList.remove("ok", "no", "hot"));
}
function endDecoPointer(g) {
  const pd = deco.pending;
  if (pd.mode === "drag") {
    const it = deco.drag.it, pm = placedMap();
    const hot = hitSlot({ x: g.x, y: g.y - DECO.dragGhostLift * RS }, it.displayCategory);
    decoCancelDrag();
    if (hot && hot.id !== pd.fromSlot) {
      const prev = pm[hot.id];
      if (pd.fromSlot) { delete pm[pd.fromSlot]; if (prev) pm[pd.fromSlot] = prev; }  // swap within the room
      pm[hot.id] = it.id;
      save(); buildSlots(); buildTray(); sfx("ItemPlaced"); vibe(15);
      const img = $(`#slots .slot[data-slot="${hot.id}"] img`);
      if (img) tween(.35, "OutBack", k => img.style.scale = lerp(1.25, 1, k));
      if (prev && !pd.fromSlot) toast(`${itemById(prev).name} went back to the tray`);
      else if (it.id === deco.focus) {   // the item just kept is in the room: point at Done
        deco.focus = null; buildTray();
        toast(deco.thenNext ? "Looks great! Tap Done for the next item" : "Looks great!", 2.4);
        $("#decoDone").classList.add("nudge");
      }
    } else if (pd.fromSlot && !hot && overTray(g)) {
      delete pm[pd.fromSlot]; save(); buildSlots(); buildTray(); sfx("ItemReturned");
    } else if (!hot) {
      sfx("ItemReturned");
      if (!pd.fromSlot) toast(it.displayCategory === "Hangable" ? "Hang clothes on the rail" : "Put it on a shelf");
    }
    return;
  }
  decoCancelDrag();
  if (!pd.mode && pd.fromSlot) openDecoSell(pd.fromSlot);   // tap a placed item
  else if (!pd.mode && pd.id) toast("Drag it into the room");
}

/* sell popup for a placed item */
function displayPrice(it) { return Math.round(lerp(it.priceMin, it.priceMax, .5) * (.8 + S.rating * .08) * .9); }
let decoSellSlot = null;
function openDecoSell(slotId) {
  const it = itemById(placedMap()[slotId]); if (!it) return;
  decoSellSlot = slotId;
  $("#decoSellIcon").src = U(`img/items/${it.stages[4]}`);
  $("#decoSellRarity").src = U(`img/ui/rarity_${it.tier.toLowerCase()}.webp`);
  $("#decoSellName").textContent = it.name;
  $("#decoSellBtn").innerHTML = `Sell <img src="${U("img/ui/coin.webp")}" style="width:40px;vertical-align:middle"> ${fmt(displayPrice(it))}`;
  $("#decoSell").classList.add("on"); sfx("PanelOpen");
  const card = $("#decoSell .deco-sell-card"); tween(.32, "OutBack", k => { card.style.scale = lerp(.82, 1, k); card.style.opacity = k; });
}
function closeDecoSell() { $("#decoSell").classList.remove("on"); decoSellSlot = null; sfx("PanelClose"); }
$("#decoSellClose").addEventListener("click", closeDecoSell);
$("#decoReturnBtn").addEventListener("click", () => {
  delete placedMap()[decoSellSlot]; save(); closeDecoSell(); buildSlots(); buildTray(); sfx("ItemReturned");
});
$("#decoSellBtn").addEventListener("click", () => {
  const id = placedMap()[decoSellSlot], it = itemById(id); if (!it) return;
  delete placedMap()[decoSellSlot];
  S.display = S.display.filter(x => x !== id);
  if (it.tier === "Rare") goal("SellRareItem");
  closeDecoSell(); buildSlots(); buildTray();
  addCoins(displayPrice(it), 360, GAME_H / 2); sfx("SellConfirm");
});
$$("[data-buy]").forEach(b => b.addEventListener("click", () => {
  const k = b.dataset.buy; sfx("PurchaseSuccess");
  if (k === "coins") addCoins(1000);
  if (k === "gems") addGems(10);
  if (k === "bundle") { addCoins(3000); addGems(25); }
}));
$$(".toggle").forEach(t => t.addEventListener("click", () => {
  const k = t.dataset.toggle; S.settings[k] = !S.settings[k]; save();
  t.classList.toggle("on", S.settings[k]); sfx(S.settings[k] ? "ToggleOn" : "ToggleOff");
  if (k === "music") { if (!S.settings.music && music) { music.pause(); music = null; musicName = null; } else playScreenMusic(); }
  if (k === "sfx" && !S.settings.sfx) Object.values(loops).forEach(a => a.pause());
}));
$("#resetBtn").addEventListener("click", () => {
  if (!confirm("Reset all progress?")) return;
  try { localStorage.removeItem("thrift_save"); } catch {}
  S = structuredClone(DEFAULT); refreshPolish(); save(); hidePanel("settingsPanel"); goMenu();
});

refreshPolish(); hud(); initView();

/* ---------- What game.ts drives (the FalconGame contract) ---------- */
export function setHooks(h) { Object.assign(hooks, h); }
export function pauseGame() {
  paused = true; endDrag();
  if (music) music.volume *= .3;   // pauseDuck 0.3
}
export function resumeGame() {
  if (!paused) return;
  paused = false;
  if (music) music.volume = Math.min(.35, music.volume / .3);
}
/** 0–100: stages done plus the share of the current stage. */
export function getProgress() {
  if (!R) return 0;
  return Math.round(((R.stage + clamp(R.revealed / R.item.cleanThreshold, 0, 1)) / TOOLS.length) * 100);
}
const AUDIO_KEY = { sound: "sfx", music: "music", haptic: "vibe" };
export function audioGet(key) { return !!S.settings[AUDIO_KEY[key]]; }
export function audioSet(key, on) {
  const k = AUDIO_KEY[key]; if (S.settings[k] === on) return;
  S.settings[k] = on; save();
  $$(`.toggle[data-toggle="${k}"]`).forEach(t => t.classList.toggle("on", on));
  if (k === "music") {
    if (!on && music) { music.pause(); music = null; musicName = null; }
    else if (on) playScreenMusic();
  }
  if (k === "sfx" && !on) Object.values(loops).forEach(a => a.pause());
}
