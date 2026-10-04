// Frame-by-frame capture of the Kobe.ai Next.js UI.
//
//   node record.mjs            1080p render -> out/video.mp4 + out/events.json
//   node record.mjs --preview  low-res stills every 0.5s -> out/preview/
//   node record.mjs --check    load the page, prove it is the offline UI, exit
//
// The public site (https://kobeai.vercel.app/) is recorded only while it is the locked
// offline demo. /api/chat and /api/season are aborted before they leave the browser, and
// the run fails if the page ever tries to call them or shows the live agent.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const PREVIEW = process.argv.includes("--preview");
const CHECK = process.argv.includes("--check");
const PUBLIC_PAGE = "https://kobeai.vercel.app/";
const PAGE = process.env.KOBE_URL ?? PUBLIC_PAGE;
const CHROME = [process.env.CHROME, "/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
const FPS = 30;
const DURATION = 30;
const T0 = new Date("2026-10-04T09:12:00").getTime();

if (!CHROME) throw new Error("Chrome not found. Set CHROME to the browser binary.");

// Clicks and keystrokes, in video seconds. Labels are the ones the Next UI actually renders.
const actions = [
  { at: 4.45, click: "mayaDraft", drift: true },
  { at: 7.2, click: "copyIG", drift: true },
  { at: 9.55, click: "input", fx: 0.35, fy: 0.4 },
  { at: 9.75, type: "Brief me on Marcus", cps: 22 },
  { at: 10.65, key: "Enter" },
  { at: 12.45, click: "fullReport" },
  { at: 14.65, click: "closeRecord" },
  { at: 15.55, click: "resolve", drift: true },
  { at: 18.2, click: "copyWA", drift: true },
  { at: 19.55, click: "integrations" },
  { at: 21.75, click: "tabChannels" },
];

const moves = actions
  .filter((a) => a.click)
  .map((a) => {
    const dur = a.click === "input" ? 0.55 : 0.62;
    return { at: a.at - dur - 0.1, dur, target: a.click, fx: a.fx, fy: a.fy };
  });
moves.push({ at: 9.7, dur: 0.4, x: 980, y: 640 });
for (const a of actions) if (a.drift) moves.push({ at: a.at + 0.18, dur: 0.65, rel: { dx: 36, dy: 64 } });

const camKeys = [
  { at: 0, z: 1 },
  { at: 2.9, target: "mayaAlert", z: 1.28 },
  { at: 4.6, target: "chatTail", z: 1.26 },
  { at: 7.45, target: "plan", z: 1.18, dx: -90 },
  { at: 8.5, z: 1 },
  { at: 10.35, target: "chatTail", z: 1.24 },
  { at: 12.55, target: "modal", z: 1.12 },
  { at: 14.8, target: "conflictAlert", z: 1.26, dx: -30 },
  { at: 15.7, target: "chatTail", z: 1.2 },
  { at: 18.75, z: 1 },
  { at: 19.65, target: "modal", z: 1.06 },
  { at: 24.85, z: 1 },
];

// App clock (ms) per video frame. Held until the window is on screen so the feed starts with the shot.
const clockRate = (t) => (t < 1.4 ? 0 : 1);

mkdirSync(out, { recursive: true });
const previewDir = join(out, "preview");
if (PREVIEW) {
  rmSync(previewDir, { recursive: true, force: true });
  mkdirSync(previewDir, { recursive: true });
}

const apiHits = [];
let browser;
let ffmpeg = null;
try {
  browser = await chromium.launch({ executablePath: CHROME, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: PREVIEW || CHECK ? 1 : 2 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new globalThis.URL(PAGE).origin });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  // Never let a recording reach the model or the database, whatever the deployment does.
  await page.route("**/api/**", (route) => {
    apiHits.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  await ctx.addInitScript({ content: readFileSync(join(here, "inject.js"), "utf8") });
  await page.clock.install({ time: T0 });
  await page.clock.pauseAt(T0 + 1);
  await page.goto(PAGE, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);

  const gate = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      offline: /OFFLINE DEMO/.test(text),
      live: /LIVE AGENT/.test(text),
      gamePlan: /GAME PLAN/.test(text),
      composer: !!document.querySelector("textarea"),
      signIn: /KOBE_PASSWORD|Sign in/.test(text),
    };
  });
  if (gate.signIn) throw new Error(`Refusing ${PAGE}: it is asking for a password, so this is not the public offline demo.`);
  if (gate.live || !gate.offline) throw new Error(`Refusing ${PAGE}: the page is not the offline scripted demo (live=${gate.live}).`);
  if (!gate.gamePlan || !gate.composer) throw new Error(`Refusing ${PAGE}: this is not the current Next.js UI (game plan and composer are missing).`);
  if (apiHits.length) throw new Error(`Refusing ${PAGE}: the page called an API on load (${apiHits.join(", ")}). Nothing was sent.`);

  if (CHECK) {
    console.log(`ok ${PAGE} offline demo, no API calls`);
  } else {
  await page.evaluate(() => window.__demo.adopt());
  await page.evaluate((cfg) => window.__demo.configure(cfg), { camKeys, moves, show: [[3.2, 25.0]], cursorStart: { x: 760, y: 860 } });

  if (!PREVIEW) {
    ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
      "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS),
      join(out, "video.mp4")], { stdio: ["pipe", "inherit", "inherit"] });
  }

  const events = [];
  const pending = actions.flatMap((a) => {
    if (!a.type) return [a];
    return [...a.type].map((ch, i) => ({ at: a.at + i / a.cps, char: ch }));
  }).sort((a, b) => a.at - b.at);

  const frames = FPS * DURATION;
  const dt = 1 / FPS;
  let fake = 0;
  let lastCursor = null;
  const started = Date.now();

  for (let f = 0; f < frames; f++) {
    const t = f / FPS;

    while (pending.length && pending[0].at <= t + 1e-6) {
      const a = pending.shift();
      if (a.click) {
        const p = await page.evaluate(({ name, fx, fy }) => {
          const r = window.__demo.pageRect(name);
          if (!r) return null;
          const s = window.__demo.toScreen(r.l + r.w * (fx ?? 0.5), r.t + r.h * (fy ?? 0.5));
          return { ...s, ok: window.__demo.hits(name, s.x, s.y) };
        }, { name: a.click, fx: a.fx, fy: a.fy });
        if (!p) throw new Error(`click target missing at ${t.toFixed(2)}s: ${a.click}`);
        if (!p.ok) throw new Error(`click target obscured or disabled at ${t.toFixed(2)}s: ${a.click}`);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.up();
        await page.evaluate((tt) => window.__demo.press(tt), t);
        events.push({ type: "click", t, target: a.click });
      } else if (a.char) {
        await page.keyboard.type(a.char);
        events.push({ type: "key", t });
      } else if (a.key) {
        await page.keyboard.press(a.key);
        events.push({ type: "enter", t });
      }
    }

    const step = clockRate(t) * dt * 1000;
    fake += step;
    if (step > 0) await page.clock.runFor(step);
    await page.waitForTimeout(4);

    const r = await page.evaluate(({ t, dt, snap }) => window.__demo.frame(t, dt, snap), { t, dt, snap: f === 0 });
    if (!r) throw new Error("director not ready");
    for (const e of r.events) events.push(e);
    if (r.visible && (!lastCursor || Math.hypot(r.cursor.x - lastCursor.x, r.cursor.y - lastCursor.y) > 0.5)) {
      await page.mouse.move(r.cursor.x, r.cursor.y);
      lastCursor = r.cursor;
    }

    if (PREVIEW) {
      if (f % 15 === 0) await page.screenshot({ type: "jpeg", quality: 80, path: join(previewDir, `t${t.toFixed(1).padStart(4, "0")}.jpg`) });
    } else {
      const buf = await page.screenshot({ type: "jpeg", quality: 95 });
      if (!ffmpeg.stdin.write(buf)) await new Promise((res) => ffmpeg.stdin.once("drain", res));
    }
    if (f % 60 === 0) console.log(`t=${t.toFixed(1)}s app=${(fake / 1000).toFixed(2)}s elapsed=${((Date.now() - started) / 1000).toFixed(0)}s`);
  }

  if (apiHits.length) throw new Error(`The page tried to call an API during the recording (${apiHits.join(", ")}). The requests were aborted and this run is discarded.`);
  writeFileSync(join(out, "events.json"), JSON.stringify(events, null, 2));
  console.log(`done: ${events.length} events, api calls: 0, url: ${PAGE}`);
  }
} finally {
  if (browser) await browser.close();
  if (ffmpeg) {
    if (!ffmpeg.stdin.destroyed) ffmpeg.stdin.end();
    const code = await new Promise((res) => ffmpeg.on("close", res));
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  }
}
