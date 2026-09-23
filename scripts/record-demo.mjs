/**
 * Records README media from a running dev server.
 *   npx vite --port 5391   (in another terminal)
 *   node scripts/record-demo.mjs [baseUrl]
 * Writes lossless-ish WebP frames to media/raw/<scene>/ (+ timings.json) and PNG stills to media/.
 * Then: python scripts/frames-to-gif.py
 */
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5391';
const OUT = join(import.meta.dirname, '..', 'media');
const RAW = join(OUT, 'raw');
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 1 });
const cdp = await page.context().newCDPSession(page);
const wait = (ms) => page.waitForTimeout(ms);

async function record(name, ms, during) {
  const dir = join(RAW, name);
  mkdirSync(dir, { recursive: true });
  const times = [];
  const t0 = Date.now();
  let stop = false;
  const act = (async () => {
    await during?.();
    stop = true;
  })();
  while (Date.now() - t0 < ms || !stop) {
    const t = Date.now();
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'webp', quality: 100, optimizeForSpeed: false });
    writeFileSync(join(dir, `${String(times.length).padStart(4, '0')}.webp`), Buffer.from(data, 'base64'));
    times.push(t - t0);
    const left = 70 - (Date.now() - t);
    if (left > 0) await wait(left);
    if (Date.now() - t0 > ms && stop) break;
  }
  await act;
  writeFileSync(join(dir, 'timings.json'), JSON.stringify(times));
  console.log(`${name}: ${times.length} frames`);
}

const open = async (hash) => {
  await page.goto(`${BASE}/${hash}`);
  await page.waitForLoadState('networkidle');
  await wait(600);
};
const speed = (s) => page.getByRole('button', { name: `${s}×`, exact: true }).click();

// 1. landing hero
await open('#/');
await record('hero', 6000);

// 2. quick sort at 2×
await open('#/algo/quick-sort');
await speed(2);
await record('quick-sort', 9000, async () => {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await wait(8800);
});

// 3. dijkstra at 2×
await open('#/algo/dijkstra');
await speed(2);
await record('dijkstra', 10000, async () => {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await wait(9800);
});

// 4. custom test case → run
await open('#/algo/merge-sort');
await record('custom-input', 11000, async () => {
  await wait(500);
  await page.getByRole('button', { name: /Edit test case/ }).click();
  await wait(700);
  const box = page.locator('.text-input input');
  await box.click();
  await box.press('Control+a');
  await box.pressSequentially('42, 7, 19, 3, 88, 25, 11', { delay: 70 });
  await wait(400);
  await page.getByRole('button', { name: 'Run it' }).click();
  await wait(400);
  await page.getByRole('button', { name: /Close test case editor/ }).click();
  await speed(4);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await wait(6000);
});

// 5. scrubbing + breakpoints on huffman
await open('#/algo/huffman-coding');
await record('scrub', 8000, async () => {
  const track = await page.locator('.timeline-track').boundingBox();
  const y = track.y + track.height / 2;
  await page.mouse.move(track.x + 4, y);
  await page.mouse.down();
  for (let k = 0; k <= 60; k++) {
    await page.mouse.move(track.x + (track.width * 0.62 * k) / 60, y);
    await wait(55);
  }
  await page.mouse.up();
  await wait(700);
  for (let k = 0; k < 8; k++) {
    await page.keyboard.press('ArrowRight');
    await wait(420);
  }
});

// 6. lee algorithm wave at 4×
await open('#/algo/lee-algorithm');
await speed(4);
await record('lee', 9000, async () => {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await wait(8800);
});

// ---- crisp stills (2× DPR) ----
const hi = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const still = async (hash, file, at) => {
  await hi.goto(`${BASE}/${hash}`);
  await hi.waitForLoadState('networkidle');
  await hi.waitForTimeout(700);
  if (at !== undefined) {
    const b = await hi.locator('.timeline-track').boundingBox();
    await hi.mouse.click(b.x + b.width * at, b.y + b.height / 2);
    await hi.mouse.move(0, 0);
    await hi.waitForTimeout(1400);
  } else await hi.waitForTimeout(2500);
  await hi.screenshot({ path: join(OUT, file) });
  console.log('still', file);
};
await still('#/', 'home.png');
await still('#/algo/heap-sort', 'heap-sort.png', 0.4);
await still('#/algo/floyd-cycle', 'floyd-cycle.png', 0.55);
await still('#/algo/floyd-warshall', 'floyd-warshall.png', 0.55);
await still('#/algo/kmp', 'kmp.png', 0.55);
await still('#/algo/depth-first-search', 'dfs.png', 0.5);
await still('#/algo/euclid-gcd', 'euclid.png', 0.6);
await still('#/algo/boyer-moore-majority', 'boyer-moore.png', 0.55);

await browser.close();
