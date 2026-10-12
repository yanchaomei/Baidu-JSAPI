import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const output = process.env.ARTIFACT_DIR || "artifacts/validation";
const hardware = process.env.GPU_BACKEND === "hardware";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: hardware ? ["--no-sandbox", "--headless=new", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-vulkan-surface"] : [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(process.env.APP_URL || "http://127.0.0.1:4173", {
  waitUntil: "networkidle",
});
await page.waitForFunction(() => Boolean(window.__flow));
if (hardware) assert.match(await page.evaluate(() => window.__flow.snapshot().environment.webgl.renderer), /NVIDIA/);
await page.selectOption("#count", "100000");
await page.selectOption("#delay", "40");
await page.click("#start");
await page.waitForFunction(
  () =>
    window.__flow.progress().render.points > 0 &&
    window.__flow.progress().session.status === "loading",
);
const incremental = await page.evaluate(() => window.__flow.snapshot());
assert.equal(
  incremental.session.streamConsumedMs,
  null,
  "first draw must precede application stream consumption",
);
await page.click("#pause");
const paused = await page.evaluate(
  () => window.__flow.snapshot().render.points,
);
await page.screenshot({ path: `${output}/incremental.png` });
await page.waitForTimeout(250);
assert.equal(
  await page.evaluate(() => window.__flow.snapshot().render.points),
  paused,
  "pause must stop GPU submission",
);
await page.click("#pause");
await page.waitForFunction(
  () => window.__flow.snapshot().session.status === "complete",
);
const complete = await page.evaluate(() => window.__flow.snapshot());
assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'desktop workspace must fit the viewport');
assert.equal(complete.render.points, 100000);
assert.ok(complete.render.lines > 0 && complete.render.areas > 0);
assert.ok(complete.session.firstDrawMs < complete.session.streamConsumedMs);
assert.ok(
  complete.session.queuePeak <= 2,
  "worker credits should bound main queue",
);
await page.waitForFunction(() => document.querySelector('#points-value').textContent === '100,000' && document.querySelector('#status-label').textContent === '加载完成');
await page.screenshot({ path: `${output}/complete.png` });
await page.click("#updates");
await page.waitForFunction(() => window.__flow.snapshot().render.updates > 0);
await page.click("#updates");
await page.selectOption("#count", "1000000");
await page.click("#start");
await page.waitForFunction(() => window.__flow.snapshot().render.points > 0);
await page.click("#cancel");
const cancelled = await page.evaluate(() => window.__flow.snapshot());
await page.waitForTimeout(250);
assert.equal(
  await page.evaluate(() => window.__flow.snapshot().render.points),
  cancelled.render.points,
  "cancel must reject late batches",
);
await page.click("#clear");
const cleared = await page.evaluate(() => window.__flow.snapshot());
assert.equal(cleared.render.gpuBytes, 0, "clear must release GPU pages");
assert.equal(cleared.render.points, 0);
for (const mode of ["worker-basic", "main", "full"]) {
  await page.selectOption("#count", "10000");
  await page.selectOption("#mode", mode);
  await page.selectOption("#delay", "0");
  await page.click("#start");
  await page.waitForFunction(
    () => window.__flow.snapshot().session.status === "complete",
  );
  assert.equal(
    await page.evaluate(() => window.__flow.snapshot().render.points),
    10000,
  );
}
// Hidden layers must not manufacture a first drawing timestamp.
for (const kind of ["points", "lines", "areas"])
  await page.uncheck(`#show-${kind}`);
await page.click("#start");
await page.waitForFunction(
  () => window.__flow.progress().session.status === "complete",
);
assert.equal(
  await page.evaluate(() => window.__flow.snapshot().session.firstDrawMs),
  null,
);
for (const kind of ["points", "lines", "areas"])
  await page.check(`#show-${kind}`);
// BFCache pagehide must keep the application alive.
await page.evaluate(() =>
  dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })),
);
await page.click("#start");
await page.waitForFunction(
  () => window.__flow.progress().session.status === "complete",
);
assert.ok(
  await page.evaluate(() => window.__flow.progress().render.drawCalls > 0),
);
// Real context loss/restore, with a disabled layer, must preserve its visibility.
await page.uncheck("#show-points");
await page.evaluate(() => {
  window.__lossExtension = document
    .querySelector("#map-canvas")
    .getContext("webgl")
    .getExtension("WEBGL_lose_context");
  window.__lossExtension.loseContext();
});
await page.waitForFunction(() =>
  document.querySelector("#error-notice").textContent.includes("上下文丢失"),
);
await page.waitForTimeout(150);
await page.evaluate(() => window.__lossExtension.restoreContext());
await page.waitForFunction(
  () => window.__flow.progress().session.status === "idle",
);
await page.click("#start");
await page.waitForFunction(
  () => window.__flow.progress().session.status === "complete",
);
assert.equal(
  await page.evaluate(() => window.__flow.progress().render.drawCalls),
  2,
);
await page.check("#show-points");
// Exercise line and area batches across multiple GPU pages.
await page.selectOption("#profile", "mixed");
await page.selectOption("#mode", "worker");
await page.click("#start");
await page.waitForFunction(
  () => window.__flow.progress().session.status === "complete",
  null,
  { timeout: 120000 },
);
const mixed = await page.evaluate(() => window.__flow.snapshot());
assert.equal(mixed.render.lines, 100000);
assert.equal(mixed.render.areas, 10000);
assert.ok(mixed.render.drawCalls >= 6);
await page.screenshot({ path: `${output}/mixed.png`, fullPage: true });
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click("#export"),
]);
await download.saveAs(`${output}/export.json`);
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
assert.ok(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  "mobile layout must not overflow",
);
assert.deepEqual(errors, []);
await writeFile(
  `${output}/receipt.json`,
  JSON.stringify(
    {
      passed: true,
      incremental,
      complete,
      cancelled,
      cleared,
      mixed,
      browserErrors: errors,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      passed: true,
      incrementalPoints: incremental.render.points,
      complete: complete.render,
      context: complete.environment.webgl,
      output,
    },
    null,
    2,
  ),
);
await browser.close();
