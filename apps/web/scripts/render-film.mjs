// Renders the "How it works" film (app/film) to a 1920×1080 MP4, frame by frame.
//
//   node apps/web/scripts/render-film.mjs                 full film → apps/web/public/media/how-it-works.mp4
//   node apps/web/scripts/render-film.mjs --stills 3,12   PNG stills at those seconds (for checking)
//
// Needs the web dev server on http://localhost:3000 and an ffmpeg with libx264
// (FFMPEG_PATH, or ffmpeg on PATH).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const require = createRequire(resolve(repo, 'apps/worker/package.json'));
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(resolve(repo, '.playwright'))) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(repo, '.playwright');
}
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const FPS = Number(option('--fps') ?? 30);
const BASE = option('--url') ?? 'http://localhost:3000/film?render';
const OUT = resolve(option('--out') ?? resolve(here, '../public/media/how-it-works.mp4'));
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const stills = option('--stills');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.__film), null, { timeout: 60_000 });
await page.evaluate(() => document.fonts.ready);
const duration = await page.evaluate(() => window.__film.duration);

async function frameAt(t) {
  await page.evaluate((time) => window.__film.seek(time), t);
  return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080 } });
}

if (stills) {
  const dir = resolve(option('--dir') ?? resolve(here, '../.film-stills'));
  mkdirSync(dir, { recursive: true });
  for (const value of stills.split(',')) {
    const file = resolve(dir, `t${String(value).padStart(5, '0')}.png`);
    writeFileSync(file, await frameAt(Number(value)));
    console.log(file);
  }
  await browser.close();
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
const ffmpeg = spawn(
  FFMPEG,
  [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'animation',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
    OUT,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const done = new Promise((resolveDone, reject) => {
  ffmpeg.on('error', reject);
  ffmpeg.on('close', (code) => (code === 0 ? resolveDone() : reject(new Error(`ffmpeg exited with ${code}`))));
});

const frames = Math.round(duration * FPS);
const started = Date.now();
for (let index = 0; index < frames; index += 1) {
  const png = await frameAt(index / FPS);
  if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  if (index % FPS === 0) {
    const elapsed = (Date.now() - started) / 1000;
    console.log(`frame ${index}/${frames} · ${elapsed.toFixed(0)} s`);
  }
}
ffmpeg.stdin.end();
await done;

// A poster from the live-audit scene, for before the video loads.
const poster = OUT.replace(/\.mp4$/, '-poster.jpg');
await page.evaluate((time) => window.__film.seek(time), 15.2);
writeFileSync(poster, await page.screenshot({ type: 'jpeg', quality: 85, clip: { x: 0, y: 0, width: 1920, height: 1080 } }));
await browser.close();
console.log(`wrote ${OUT} and ${poster}`);
