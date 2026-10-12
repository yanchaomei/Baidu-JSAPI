import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = process.env.ARTIFACT_DIR || 'artifacts/scale-probe';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let receipt = { passed: false, errors, requested: { points: 2000000, lines: 200000, areas: 100000 } };
try {
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:4173');
  await page.waitForFunction(() => Boolean(window.__flow));
  await page.evaluate(() => window.__flow.start(2000000, 'worker', 0, { lines: 200000, areas: 100000 }));
  await page.waitForFunction(() => ['complete', 'error'].includes(window.__flow.progress().session.status), null, { timeout: 180000 });
  const snapshot = await page.evaluate(() => window.__flow.snapshot());
  Object.assign(receipt, snapshot);
  assert.equal(snapshot.session.status, 'complete');
  assert.equal(snapshot.render.points, 2000000);
  assert.equal(snapshot.render.lines, 200000);
  assert.equal(snapshot.render.areas, 100000);
  assert.equal(snapshot.render.vertices, 3000000);
  assert.ok(snapshot.session.queuePeak <= 2);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.__flow.clear());
  assert.equal(await page.evaluate(() => window.__flow.progress().render.gpuBytes), 0);
  receipt.passed = true;
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  try { receipt.partial = await page.evaluate(() => window.__flow?.snapshot() ?? null); } catch { receipt.partial = null; }
} finally {
  await writeFile(`${output}/receipt.json`, JSON.stringify(receipt, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: receipt.passed, render: receipt.render, errors }, null, 2));
if (!receipt.passed) process.exitCode = 1;
