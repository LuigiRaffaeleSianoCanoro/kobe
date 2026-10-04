// Page-side director for the demo capture. Injected before the app loads; every
// frame is driven explicitly by record.mjs through window.__demo.frame(t, dt).
(() => {
  const W = 1440;
  const H = 810;
  const WIN_S = 0.82;
  const WIN_X = (W - W * WIN_S) / 2;
  const WIN_Y = 108;
  const mono = "'JetBrains Mono', monospace";

  let seed = 11;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Smooth scrolling is compositor-driven and ignores the fake clock, so tween it per frame instead.
  const scrolls = new Map();
  const nativeScrollTo = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function (a, ...rest) {
    if (a && typeof a === "object" && a.behavior === "smooth") {
      scrolls.set(this, a.top ?? 0);
      return;
    }
    return nativeScrollTo.call(this, a, ...rest);
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const easeBack = (x) => {
    x = clamp(x, 0, 1);
    const c = 1.5;
    return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
  };
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const lerp = (a, b, p) => a + (b - a) * p;

  const ballCss = (size) => {
    const seam = size >= 40 ? Math.max(2, size / 26) : 1.5;
    return `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;background:radial-gradient(circle at 32% 28%, rgba(255,220,180,.4), transparent 45%), radial-gradient(circle, rgba(60,20,0,.35) .8px, transparent 1.2px) 0 0/3px 3px, radial-gradient(circle at 70% 75%, #9c3f0c, #e0712a 70%);box-shadow:0 ${size / 10}px ${size / 3}px rgba(224,113,42,.45)">
      <div style="position:absolute;left:50%;top:0;bottom:0;width:${seam}px;margin-left:${-seam / 2}px;background:#2a1206"></div>
      <div style="position:absolute;top:50%;left:0;right:0;height:${seam}px;margin-top:${-seam / 2}px;background:#2a1206"></div>
      <div style="position:absolute;top:-10%;bottom:-10%;left:-62%;width:100%;border-radius:50%;border:${seam}px solid #2a1206"></div>
      <div style="position:absolute;top:-10%;bottom:-10%;right:-62%;width:100%;border-radius:50%;border:${seam}px solid #2a1206"></div>
    </div>`;
  };

  const CAPTIONS = [
    { a: 2.45, b: 4.5, k: "COURTSIDE", text: "Kobe scouts your inbox, calendar & socials" },
    { a: 4.6, b: 9.0, k: "01 · BIRTHDAYS", text: "Never miss a <em>birthday.</em>" },
    { a: 9.1, b: 15.05, k: "02 · PREGAME", text: "Never walk in <em>cold.</em>" },
    { a: 15.15, b: 19.45, k: "03 · CONFLICTS", text: "Never double-book a <em>night.</em>" },
    { a: 19.55, b: 22.35, k: "04 · SOURCES", text: "Reads 18 sources. <em>Never posts.</em>" },
    { a: 22.45, b: 25.0, k: "05 · CHANNELS", text: "Text Kobe on <em>Telegram, WhatsApp, Slack</em>" },
  ];

  const D = (window.__demo = {
    cam: { x: W / 2, y: H / 2, z: 1, vx: 0, vy: 0, vz: 0, tx: 0, ty: 0 },
    camKeys: [],
    cursor: { x: 760, y: 900, moves: [], visible: 0, press: -9, ring: -9 },
    seen: { alerts: 0, agent: 0, alertIds: new Set() },
    ready: false,
  });

  const buildDom = () => {
    const style = document.createElement("style");
    style.textContent = `
      body { background:#0b0806 !important; }
      #demo-stage { position:fixed; inset:0; z-index:0; overflow:hidden;
        background:
          radial-gradient(60% 70% at 12% 8%, rgba(107,51,184,.42), transparent 70%),
          radial-gradient(55% 65% at 92% 96%, rgba(242,182,58,.26), transparent 70%),
          radial-gradient(120% 120% at 50% 50%, #1a110c, #0b0806 70%); }
      #demo-stage svg { position:absolute; inset:0; width:100%; height:100%; opacity:.16; }
      #demo-win { position:fixed; left:${WIN_X}px; top:${WIN_Y}px; width:${W}px; height:${H}px; transform-origin:0 0;
        border-radius:26px; overflow:hidden; z-index:1; background:#120d0a;
        box-shadow:0 50px 140px rgba(0,0,0,.65), 0 0 0 1.5px rgba(255,255,255,.09); }
      #demo-cam { position:absolute; inset:0; transform-origin:0 0; }
      #demo-cursor { position:absolute; left:0; top:0; width:26px; height:26px; z-index:999; pointer-events:none; transform-origin:4px 3px; }
      #demo-ring { position:absolute; left:0; top:0; width:44px; height:44px; margin:-22px 0 0 -22px; border-radius:50%;
        border:2.5px solid #F2B63A; z-index:998; pointer-events:none; opacity:0; }
      .demo-ov { position:fixed; pointer-events:none; z-index:5; }
      #demo-cap { left:0; right:0; top:0; height:${WIN_Y}px; display:flex; align-items:center; justify-content:center; gap:18px; }
      #demo-cap .k { font:600 13px ${mono}; letter-spacing:.16em; color:#F2B63A; padding:6px 10px; border-radius:8px;
        background:rgba(242,182,58,.12); border:1px solid rgba(242,182,58,.3); white-space:nowrap; }
      #demo-cap .t { font-family:Archivo; font-weight:800; font-stretch:68%; font-size:48px; line-height:1; text-transform:uppercase;
        color:#F4F1EC; white-space:nowrap; letter-spacing:.005em; }
      #demo-cap em, #demo-outro em { font-style:normal; color:#F2B63A; }
      #demo-intro, #demo-outro { inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
      .demo-word { font-family:Archivo; font-weight:800; font-stretch:72%; line-height:1; letter-spacing:.01em; color:#F4F1EC; }
      .demo-kick { font:500 15px ${mono}; letter-spacing:.32em; color:#D9D2C7; }
      .demo-mask { overflow:hidden; padding:0 .04em; }
      #demo-fade { inset:0; background:#000; opacity:0; z-index:9; }
    `;
    document.head.appendChild(style);

    const stage = document.createElement("div");
    stage.id = "demo-stage";
    stage.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" fill="none" stroke="#F4E3BC" stroke-width="2">
      <circle cx="${W / 2}" cy="${H + 60}" r="560"/><rect x="${W / 2 - 170}" y="${H - 380}" width="340" height="440"/>
      <circle cx="${W / 2}" cy="${H - 380}" r="170"/><line x1="0" y1="40" x2="${W}" y2="40" stroke-opacity=".5"/></svg>`;
    document.body.prepend(stage);

    const win = document.createElement("div");
    win.id = "demo-win";
    const cam = document.createElement("div");
    cam.id = "demo-cam";
    win.appendChild(cam);
    const root = document.getElementById("root");
    root.parentNode.insertBefore(win, root);
    cam.appendChild(root);

    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    cursor.innerHTML = `<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 3 L4 21 L8.6 16.8 L11.6 23.4 L14.8 22 L11.9 15.5 L18.2 15.3 Z" fill="#fff" stroke="#15110D" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    const ring = document.createElement("div");
    ring.id = "demo-ring";
    cam.append(ring, cursor);

    const intro = document.createElement("div");
    intro.id = "demo-intro";
    intro.className = "demo-ov";
    intro.innerHTML = `
      <div style="display:flex;align-items:center;gap:30px">
        <div style="position:relative">
          <div id="demo-ishadow" style="position:absolute;left:-4px;right:-4px;bottom:-14px;height:18px;border-radius:50%;background:radial-gradient(rgba(0,0,0,.75),transparent 70%)"></div>
          <div id="demo-iball" style="position:relative">${ballCss(132)}</div>
        </div>
        <div class="demo-mask"><div id="demo-iword" class="demo-word" style="font-size:168px">KOBE<span style="color:#F2B63A">.AI</span></div></div>
      </div>
      <div id="demo-ikick" class="demo-kick" style="margin-top:40px;font-size:18px;color:#E6E0D7">YOUR RELATIONSHIP SCOUT</div>`;

    const cap = document.createElement("div");
    cap.id = "demo-cap";
    cap.className = "demo-ov";
    cap.innerHTML = `<div class="k"></div><div class="demo-mask"><div class="t"></div></div>`;

    const outro = document.createElement("div");
    outro.id = "demo-outro";
    outro.className = "demo-ov";
    outro.innerHTML = `
      <div id="demo-okick" class="demo-kick" style="color:#F2B63A;margin-bottom:26px">BIRTHDAYS · PREGAME · CONFLICTS · FOLLOW-UPS</div>
      <div class="demo-mask"><div id="demo-o1" class="demo-word" style="font-size:150px;font-stretch:64%;line-height:.92">KNOW YOUR</div></div>
      <div class="demo-mask"><div id="demo-o2" class="demo-word" style="font-size:150px;font-stretch:64%;line-height:.92"><em>PEOPLE.</em></div></div>
      <div id="demo-obrand" style="display:flex;align-items:center;gap:14px;margin-top:44px">
        ${ballCss(40)}
        <div class="demo-word" style="font-size:44px">KOBE<span style="color:#F2B63A">.AI</span></div>
        <div style="width:1px;height:30px;background:rgba(255,255,255,.2);margin:0 8px"></div>
        <div style="font:500 18px ${mono};letter-spacing:.06em;color:#D9D2C7">kobe-ashen-nu.vercel.app</div>
      </div>`;

    const fade = document.createElement("div");
    fade.id = "demo-fade";
    fade.className = "demo-ov";

    document.body.append(intro, cap, outro, fade);

    D.el = { win, cam, cursor, ring, intro, cap, outro, fade,
      capK: cap.querySelector(".k"), capT: cap.querySelector(".t"),
      iball: intro.querySelector("#demo-iball"), iword: intro.querySelector("#demo-iword"),
      ishadow: intro.querySelector("#demo-ishadow"), ikick: intro.querySelector("#demo-ikick"),
      okick: outro.querySelector("#demo-okick"), o1: outro.querySelector("#demo-o1"), o2: outro.querySelector("#demo-o2"),
      obrand: outro.querySelector("#demo-obrand") };
    D.ready = true;
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildDom);
  else buildDom();

  // ---------- element targets ----------
  const buttons = () => [...document.querySelectorAll("#root button")];
  const btn = (label) => buttons().find((b) => b.textContent.trim() === label);
  const srcBtn = (name) => buttons().find((b) => b.classList.contains("src") && b.textContent.includes(name));
  const messages = () => {
    const col = document.querySelector("#root main > div");
    return col ? [...col.children].slice(1) : [];
  };
  const alertCard = (title) => [...document.querySelectorAll("#root aside > div")].find((d) => d.textContent.includes(title));
  const modalPanel = () => {
    const fixed = [...document.querySelectorAll("#root > div")].filter((d) => getComputedStyle(d).position === "fixed" && d.style.inset);
    const top = fixed[fixed.length - 1];
    return top ? top.firstElementChild : null;
  };
  const union = (els) => {
    const rs = els.filter(Boolean).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
    if (!rs.length) return null;
    return { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
  };

  const TARGETS = {
    mayaDraft: () => btn("Draft message"),
    sendIG: () => btn("Send via Instagram"),
    sendWA: () => btn("Send via WhatsApp"),
    input: () => document.querySelector("#root input"),
    fullReport: () => btn("Full scouting report"),
    closeRecord: () => btn("Close"),
    resolve: () => btn("Resolve"),
    integrations: () => document.querySelector("#root header button"),
    linkedin: () => srcBtn("LinkedIn"),
    zoomSrc: () => srcBtn("Zoom"),
    tabChannels: () => buttons().find((b) => b.textContent.trim() === "Add Kobe to…" && !b.closest("header")),
    sentCode: () => btn("I've sent the code"),
    mayaAlert: () => alertCard("Maya Chen turns 29"),
    conflictAlert: () => alertCard("Double-booked"),
    chatTail: () => {
      const m = messages();
      return union(m.slice(-2));
    },
    chatTail1: () => union(messages().slice(-1)),
    modal: () => modalPanel(),
    lane: () => union([...document.querySelectorAll("#root aside > div")].slice(0, 3)),
  };

  // Screen rect -> page (pre-camera, pre-window) coordinates.
  const toPage = (sx, sy) => {
    const c = D.cam;
    return { x: ((sx - WIN_X) / WIN_S - c.tx) / c.z, y: ((sy - WIN_Y) / WIN_S - c.ty) / c.z };
  };
  const pageRect = (name) => {
    const f = TARGETS[name];
    if (!f) return null;
    let r = f();
    if (!r) return null;
    if (r instanceof Element) r = r.getBoundingClientRect();
    if (!(r.right > r.left)) return null;
    const a = toPage(r.left, r.top);
    const b = toPage(r.right, r.bottom);
    return { l: a.x, t: a.y, r: b.x, b: b.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, w: b.x - a.x, h: b.y - a.y };
  };
  D.pageRect = pageRect;
  D.hits = (name, x, y) => {
    const el = TARGETS[name]?.();
    const hit = document.elementFromPoint(x, y);
    return el instanceof Element ? !!hit && el.contains(hit) : !!hit;
  };
  D.toScreen = (px, py) => ({ x: WIN_X + WIN_S * (D.cam.tx + D.cam.z * px), y: WIN_Y + WIN_S * (D.cam.ty + D.cam.z * py) });

  // ---------- camera ----------
  const camDesired = (t) => {
    let k = null;
    for (const key of D.camKeys) if (key.at <= t) k = key;
    if (!k) return { x: W / 2, y: H / 2, z: 1 };
    const z = k.z ?? 1;
    const vw = W / z;
    const vh = H / z;
    let x = k.x ?? W / 2;
    let y = k.y ?? H / 2;
    if (k.target) {
      const r = pageRect(k.target);
      if (r) {
        x = r.cx + (k.dx ?? 0);
        const pad = k.pad ?? 40;
        y = r.h + pad * 2 > vh ? r.b + pad - vh / 2 : r.cy;
        y += k.dy ?? 0;
      } else if (k.last) {
        return k.last;
      }
    }
    const out = { x: clamp(x, vw / 2, W - vw / 2), y: clamp(y, vh / 2, H - vh / 2), z };
    k.last = out;
    return out;
  };

  const stepCamera = (t, dt, snap) => {
    const c = D.cam;
    const d = camDesired(t);
    if (snap) {
      Object.assign(c, { x: d.x, y: d.y, z: d.z, vx: 0, vy: 0, vz: 0 });
    } else {
      const w = 5.2;
      const sub = 4;
      const h = dt / sub;
      for (let i = 0; i < sub; i++) {
        c.vx += (w * w * (d.x - c.x) - 2 * w * c.vx) * h;
        c.vy += (w * w * (d.y - c.y) - 2 * w * c.vy) * h;
        c.vz += (w * w * (d.z - c.z) - 2 * w * c.vz) * h;
        c.x += c.vx * h;
        c.y += c.vy * h;
        c.z += c.vz * h;
      }
    }
    const z = Math.max(1, c.z);
    c.tx = clamp(W / 2 - z * c.x, W - z * W, 0);
    c.ty = clamp(H / 2 - z * c.y, H - z * H, 0);
    c.z = z;
    D.el.cam.style.transform = `translate(${c.tx}px, ${c.ty}px) scale(${z})`;
  };

  // ---------- cursor ----------
  const stepCursor = (t) => {
    const cur = D.cursor;
    let m = null;
    for (const mv of cur.moves) if (mv.at <= t) m = mv;
    if (m) {
      if (!m.from) m.from = { x: cur.x, y: cur.y };
      const r = m.target ? pageRect(m.target) : null;
      const to = r
        ? { x: r.l + r.w * (m.fx ?? 0.5), y: r.t + r.h * (m.fy ?? 0.5) }
        : m.last ?? (m.rel ? { x: m.from.x + m.rel.dx, y: m.from.y + m.rel.dy } : { x: m.x, y: m.y });
      m.last = to;
      const p = ease(seg(t, m.at, m.at + (m.dur ?? 0.7)));
      const dx = to.x - m.from.x;
      const dy = to.y - m.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const arc = Math.sin(Math.PI * p) * Math.min(60, len * 0.12);
      cur.x = lerp(m.from.x, to.x, p) + (-dy / len) * arc;
      cur.y = lerp(m.from.y, to.y, p) + (dx / len) * arc;
    }
    cur.visible = (cur.show ?? []).reduce((v, [a, b]) => Math.max(v, Math.min(seg(t, a, a + 0.25), 1 - seg(t, b - 0.25, b))), 0);
    const press = 1 - 0.14 * Math.max(0, 1 - Math.abs(t - cur.press) / 0.09);
    D.el.cursor.style.transform = `translate(${cur.x - 4}px, ${cur.y - 3}px) scale(${press / Math.max(1, D.cam.z * 0.85)})`;
    D.el.cursor.style.opacity = String(cur.visible);
    const rp = seg(t, cur.ring, cur.ring + 0.45);
    D.el.ring.style.opacity = rp > 0 && rp < 1 ? String((1 - rp) * 0.9) : "0";
    D.el.ring.style.transform = `translate(${cur.x}px, ${cur.y}px) scale(${0.35 + rp * 0.9})`;
  };

  // ---------- overlays ----------
  const stepOverlays = (t) => {
    const e = D.el;

    // Intro: ball drops in with two bounces, wordmark wipes up, then the group lifts away.
    const g = 1;
    let by;
    const land = [0.42, 0.74, 0.94];
    if (t < land[0]) by = -560 * (1 - Math.pow(t / land[0], 2));
    else if (t < land[1]) { const u = (t - land[0]) / (land[1] - land[0]); by = -150 * 4 * u * (1 - u); }
    else if (t < land[2]) { const u = (t - land[1]) / (land[2] - land[1]); by = -46 * 4 * u * (1 - u); }
    else by = 0;
    const squash = land.reduce((s, l) => s + Math.max(0, 1 - Math.abs(t - l) / 0.05) * 0.14, 0) * g;
    const spin = Math.min(t, 1.0) * 300;
    e.iball.style.transform = `translateY(${by}px) scale(${1 + squash}, ${1 - squash}) rotate(${spin}deg)`;
    e.iball.style.transformOrigin = "50% 100%";
    e.ishadow.style.opacity = String(clamp(1 + by / 400, 0, 1) * 0.9);
    e.ishadow.style.transform = `scale(${0.5 + 0.5 * clamp(1 + by / 560, 0, 1)})`;
    e.iword.style.transform = `translateY(${(1 - easeOut(seg(t, 0.5, 0.95))) * 110}%)`;
    e.ikick.style.opacity = String(easeOut(seg(t, 0.85, 1.25)));
    e.ikick.style.letterSpacing = `${0.6 - 0.28 * easeOut(seg(t, 0.85, 1.4))}em`;
    const out = ease(seg(t, 1.45, 2.0));
    e.intro.style.opacity = String(1 - out);
    e.intro.style.transform = `translateY(${-out * 120}px) scale(${1 - out * 0.12})`;
    e.intro.style.display = out >= 1 ? "none" : "flex";

    // App window rises in, then falls back for the outro.
    const wIn = easeBack(seg(t, 1.75, 2.55));
    const wOut = ease(seg(t, 25.05, 25.75));
    const s = WIN_S * (0.9 + 0.1 * wIn) * (1 - 0.1 * wOut);
    const y = WIN_Y + (1 - wIn) * 260 + wOut * 140;
    const x = (W - W * s) / 2;
    e.win.style.transform = `translate(${x - WIN_X}px, ${y - WIN_Y}px) scale(${s / WIN_S}) scale(${WIN_S})`;
    e.win.style.left = `${WIN_X}px`;
    e.win.style.opacity = String(clamp(seg(t, 1.75, 2.2), 0, 1) * (1 - wOut));
    e.win.style.filter = wOut > 0 ? `blur(${wOut * 8}px)` : "none";

    // Captions: kicker fades, headline wipes up through a mask.
    const c = CAPTIONS.find((c) => t >= c.a - 0.01 && t < c.b + 0.35);
    if (c) {
      if (e.capT.dataset.k !== c.k) {
        e.capT.dataset.k = c.k;
        e.capT.innerHTML = c.text;
        e.capK.textContent = c.k;
      }
      const pin = easeOut(seg(t, c.a, c.a + 0.4));
      const pout = ease(seg(t, c.b, c.b + 0.3));
      e.capT.style.transform = `translateY(${(1 - pin) * 105 - pout * 105}%)`;
      e.capK.style.opacity = String(pin * (1 - pout));
      e.capK.style.transform = `translateX(${(1 - pin) * -16}px)`;
      e.cap.style.opacity = "1";
    } else {
      e.cap.style.opacity = "0";
    }

    // Outro.
    const o = seg(t, 25.4, 30);
    e.outro.style.display = o > 0 ? "flex" : "none";
    e.okick.style.opacity = String(easeOut(seg(t, 26.3, 26.8)));
    e.o1.style.transform = `translateY(${(1 - easeOut(seg(t, 25.5, 25.95))) * 105}%)`;
    e.o2.style.transform = `translateY(${(1 - easeOut(seg(t, 25.7, 26.15))) * 105}%)`;
    const ob = easeBack(seg(t, 26.4, 26.95));
    e.obrand.style.opacity = String(clamp(seg(t, 26.4, 26.7), 0, 1));
    e.obrand.style.transform = `translateY(${(1 - ob) * 24}px)`;
    e.outro.style.transform = `scale(${1 + seg(t, 25.5, 30) * 0.035})`;
    e.fade.style.opacity = String(Math.max(1 - easeOut(seg(t, 0, 0.25)), ease(seg(t, 29.45, 30))));
  };

  // ---------- CSS animation / scroll stepping ----------
  const stepAnimations = (dt) => {
    for (const a of document.getAnimations()) {
      if (a.__k === undefined) {
        a.__k = 0;
        a.pause();
      }
      a.__k += dt * 1000;
      const end = a.effect?.getComputedTiming().endTime;
      a.currentTime = Number.isFinite(end) ? Math.min(a.__k, end) : a.__k;
    }
  };
  const stepScroll = (dt) => {
    for (const [el, top] of scrolls) {
      const max = el.scrollHeight - el.clientHeight;
      const target = clamp(top, 0, max);
      const next = el.scrollTop + (target - el.scrollTop) * (1 - Math.exp(-dt * 8));
      el.scrollTop = Math.abs(target - next) < 0.5 ? target : next;
    }
  };

  const detectEvents = (t) => {
    const ev = [];
    for (const d of document.querySelectorAll("#root aside > div")) {
      if (!D.seen.alertIds.has(d)) {
        D.seen.alertIds.add(d);
        const kind = d.querySelector("span + span")?.textContent ?? "";
        ev.push({ type: "alert", t, kind });
      }
    }
    const agentCount = messages().filter((m) => m.firstElementChild?.style.maxWidth === "92%").length;
    if (agentCount > D.seen.agent) ev.push({ type: "agent", t });
    D.seen.agent = Math.max(D.seen.agent, agentCount);
    return ev;
  };

  D.frame = (t, dt, snap) => {
    if (!D.ready) return null;
    stepAnimations(dt);
    stepScroll(dt);
    stepCamera(t, dt, snap);
    stepCursor(t);
    stepOverlays(t);
    const scr = D.toScreen(D.cursor.x, D.cursor.y);
    return { cursor: scr, visible: D.cursor.visible > 0.5, events: detectEvents(t) };
  };
  D.configure = (cfg) => {
    D.camKeys = cfg.camKeys;
    D.cursor.moves = [...cfg.moves].sort((a, b) => a.at - b.at);
    D.cursor.show = cfg.show;
    if (cfg.cursorStart) Object.assign(D.cursor, cfg.cursorStart);
  };
  D.press = (t) => {
    D.cursor.press = t;
    D.cursor.ring = t;
  };
})();
