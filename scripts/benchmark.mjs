import { chromium } from "playwright";
import { mkdir, writeFile, rename, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const output = process.env.ARTIFACT_DIR || "artifacts/benchmark";
const scales = (process.env.SCALES || "10000,100000,1000000")
  .split(",")
  .map(Number);
const repeats = Number(process.env.REPEATS || 5);
const delay = Number(process.env.BATCH_DELAY || 8);
const geometry = {
  lines: Number(process.env.LINE_COUNT || 89),
  areas: Number(process.env.AREA_COUNT || 40),
};
const timeout = Number(process.env.RUN_TIMEOUT_MS || 120000);
const hardware = process.env.GPU_BACKEND === "hardware";
if (repeats < 5)
  throw new Error("Formal comparison requires at least 5 repeats");
await mkdir(output, { recursive: true });
const assets = [];
for (const filename of (await readdir("dist/assets")).sort()) {
  assets.push({
    filename,
    sha256: createHash("sha256")
      .update(await readFile(`dist/assets/${filename}`))
      .digest("hex"),
  });
}
const protocol = {
  repeats,
  scales,
  delay,
  ...geometry,
  seed: 42,
  batch: 4096,
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  trajectory:
    "absolute cameraAt(elapsedMs), 40 ms timer; steady window requested 2000 ms",
  context: hardware ? "offline WebGL / requested hardware Vulkan; verify renderer per run" : "offline WebGL / software ANGLE SwiftShader",
  assets,
  excludes: [
    "Baidu integration",
    "CPU utilization",
    "GPU utilization",
    ...(hardware ? [] : ["hardware GPU performance"]),
    "network-only transfer timing",
  ],
};
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: hardware ? ["--no-sandbox", "--headless=new", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-vulkan-surface"] : [
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const results = [];
const modes = ["full", "main", "worker-basic", "worker"];
let activePage = null;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  void activePage?.close().catch(() => {});
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
async function save() {
  await writeFile(
    `${output}/raw.tmp.json`,
    JSON.stringify({ protocol, results }, null, 2),
  );
  await rename(`${output}/raw.tmp.json`, `${output}/raw.json`);
}
try {
  for (const count of scales) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      for (let index = 0; index < modes.length; index++) {
        const mode = modes[(index + repeat) % modes.length];
        const run = {
          count,
          mode,
          repeat,
          valid: false,
          errors: [],
          startedAt: new Date().toISOString(),
        };
        try {
          if (interrupted) throw new Error("Benchmark interrupted");
          activePage = await browser.newPage({
            viewport: protocol.viewport,
            deviceScaleFactor: 1,
          });
          activePage.on("pageerror", (error) => run.errors.push(error.message));
          await activePage.goto(process.env.APP_URL || "http://127.0.0.1:4173");
          await activePage.waitForFunction(() => Boolean(window.__flow));
          await activePage.evaluate(
            ({ count, mode, delay, geometry }) => {
              window.__flow.start(count, mode, delay, geometry);
              window.__trajectoryStart = performance.now();
              window.__interactionTimer = setInterval(
                () =>
                  window.__flow.interact(
                    performance.now() - window.__trajectoryStart,
                  ),
                40,
              );
            },
            { count, mode, delay, geometry },
          );
          await activePage.waitForFunction(
            () =>
              ["complete", "error"].includes(
                window.__flow.progress().session.status,
              ),
            null,
            { timeout },
          );
          Object.assign(
            run,
            await activePage.evaluate(() => {
              clearInterval(window.__interactionTimer);
              return window.__flow.snapshot();
            }),
          );
          if (hardware && /SwiftShader|llvmpipe|softpipe/i.test(run.environment.webgl.renderer)) {
            throw new Error("Hardware requested but browser reports software rendering");
          }
          await activePage.evaluate(() => {
            window.__flow.observe();
            window.__trajectoryStart = performance.now();
            window.__interactionTimer = setInterval(
              () =>
                window.__flow.interact(
                  performance.now() - window.__trajectoryStart,
                ),
              40,
            );
          });
          await activePage.waitForTimeout(2000);
          run.steady = await activePage.evaluate(() => {
            clearInterval(window.__interactionTimer);
            return {
              durationMs: performance.now() - window.__trajectoryStart,
              ...window.__flow.snapshot(),
            };
          });
          run.valid =
            run.session.status === "complete" &&
            run.render.points === count &&
            run.render.lines === geometry.lines &&
            run.render.areas === geometry.areas &&
            run.errors.length === 0;
        } catch (error) {
          run.errors.push(
            error instanceof Error ? error.message : String(error),
          );
          if (activePage && !activePage.isClosed()) {
            try {
              run.partial = await activePage.evaluate(
                () => window.__flow?.snapshot() ?? null,
              );
            } catch {
              run.partial = null;
            }
          }
        } finally {
          results.push(run);
          await save();
          await activePage?.close().catch(() => {});
          activePage = null;
        }
        console.log(
          JSON.stringify({
            count,
            mode,
            repeat,
            valid: run.valid,
            firstDrawMs: run.session?.firstDrawMs,
            completeMs: run.session?.completeMs,
            p95Ms: run.frames?.p95Ms,
            errors: run.errors,
          }),
        );
        if (!run.valid)
          throw new Error(
            "Failed or interrupted run preserved in raw.json; comparison stopped",
          );
      }
    }
  }
} finally {
  await browser.close();
}

const median = (values) => {
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
const summary = scales.flatMap((count) =>
  modes.map((mode) => {
    const runs = results.filter(
      (run) => run.count === count && run.mode === mode,
    );
    const values = (read) => runs.map(read);
    return {
      count,
      mode,
      runs: runs.length,
      firstDrawMedianMs: median(values((run) => run.session.firstDrawMs)),
      firstDrawRangeMs: [
        Math.min(...values((run) => run.session.firstDrawMs)),
        Math.max(...values((run) => run.session.firstDrawMs)),
      ],
      completionMedianMs: median(values((run) => run.session.completeMs)),
      loadingP95MedianMs: median(values((run) => run.frames.p95Ms)),
      loadingP99MedianMs: median(values((run) => run.frames.p99Ms)),
      steadyP95MedianMs: median(values((run) => run.steady.frames.p95Ms)),
      steadyP99MedianMs: median(values((run) => run.steady.frames.p99Ms)),
      longTaskMedian: median(values((run) => run.frames.longTasks)),
      queuePeak: Math.max(...values((run) => run.session.queuePeak)),
      gpuBytes: runs[0].render.gpuBytes,
      downloadBytes: runs[0].session.bytes,
    };
  }),
);
await writeFile(
  `${output}/summary.json`,
  JSON.stringify({ protocol, summary }, null, 2),
);
console.log(`Saved ${results.length} runs to ${output}`);
