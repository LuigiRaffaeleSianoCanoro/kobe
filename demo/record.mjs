// Deterministic frame-by-frame capture of the live Kobe app.
//   node record.mjs            full 1080p render -> out/video.mp4 + out/events.json
//   node record.mjs --preview  low-res stills every 0.5s -> out/preview/
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const PREVIEW = process.argv.includes("--preview");
const URL = process.env.KOBE_URL ?? "https://kobe-ashen-nu.vercel.app";
const CHROME = process.env.CHROME ?? "/usr/local/bin/google-chrome";
const FPS = 30;
const DURATION = 30;
const T0 = new Date("2026-10-04T09:12:00").getTime();

// Clicks and keystrokes, in video seconds.
const actions = [
  { at: 4.45, click: "mayaDraft" },
  { at: 7.15, click: "sendIG" },
  { at: 9.05, click: "input", fx: 0.25 },
  { at: 9.2, type: "Brief me on Marcus", cps: 24 },
  { at: 10.15, key: "Enter" },
  { at: 12.55, click: "fullReport" },
  { at: 14.95, click: "closeRecord" },
  { at: 15.8, click: "resolve" },
  { at: 18.45, click: "sendWA" },
  { at: 20.15, click: "integrations" },
  { at: 20.95, click: "linkedin", fx: 0.88 },
  { at: 21.5, click: "zoomSrc", fx: 0.88 },
  { at: 22.5, click: "tabChannels" },
  { at: 23.35, click: "sentCode" },
];

// Cursor glides onto each click target just before the click.
const moves = actions
  .filter((a) => a.click)
  .map((a) => {
    const dur = a.click === "input" ? 0.6 : 0.62;
    return { at: a.at - dur - 0.1, dur, target: a.click, fx: a.fx, fy: a.fy };
  });
moves.push({ at: 9.12, dur: 0.5, x: 1000, y: 690 });
for (const at of [4.45, 7.15, 15.8, 18.45, 23.35]) moves.push({ at: at + 0.2, dur: 0.7, rel: { dx: 36, dy: 70 } });

const camKeys = [
  { at: 0, z: 1 },
  { at: 2.95, target: "mayaAlert", z: 1.32 },
  { at: 4.55, target: "chatTail", z: 1.3 },
  { at: 7.3, target: "chatTail", z: 1.12, dx: 170 },
  { at: 8.85, target: "input", z: 1.28, dy: -170 },
  { at: 10.25, target: "chatTail", z: 1.28 },
  { at: 12.65, target: "modal", z: 1.14 },
  { at: 15.05, target: "conflictAlert", z: 1.3, dx: -60 },
  { at: 15.95, target: "chatTail", z: 1.24 },
  { at: 19.15, z: 1 },
  { at: 20.25, target: "modal", z: 1.1 },
  { at: 24.9, z: 1 },
];

// App clock (ms) advanced per video frame; the app's alert feed is keyed off it.
const clockRate = (t) => (t < 1.4 ? 0 : t >= 23.35 && t < 24.1 ? 2 : 1);

mkdirSync(out, { recursive: true });
const previewDir = join(out, "preview");
if (PREVIEW) {
  rmSync(previewDir, { recursive: true, force: true });
  mkdirSync(previewDir, { recursive: true });
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--hide-scrollbars", "--force-color-profile=srgb"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: PREVIEW ? 1 : 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await ctx.addInitScript({ content: readFileSync(join(here, "inject.js"), "utf8") });
await page.clock.install({ time: T0 });
await page.clock.pauseAt(T0 + 1);
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(async () => {
  await Promise.all(["800 48px Archivo", "600 13px 'JetBrains Mono'", "500 15px 'JetBrains Mono'"].map((f) => document.fonts.load(f)));
  await document.fonts.ready;
});
await page.waitForTimeout(800);
await page.evaluate((cfg) => window.__demo.configure(cfg), { camKeys, moves, show: [[3.25, 25.0]], cursorStart: { x: 760, y: 900 } });

let ffmpeg = null;
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
      if (!p.ok) throw new Error(`click target obscured at ${t.toFixed(2)}s: ${a.click}`);
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

writeFileSync(join(out, "events.json"), JSON.stringify(events, null, 2));
await browser.close();
if (ffmpeg) {
  ffmpeg.stdin.end();
  await new Promise((res, rej) => ffmpeg.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
}
console.log(`done: ${events.length} events`);
