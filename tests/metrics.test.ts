import test from "node:test";
import assert from "node:assert/strict";

const events = new EventTarget();
const documentState = {
  visibilityState: "visible",
  addEventListener: events.addEventListener.bind(events),
  removeEventListener: events.removeEventListener.bind(events),
};
Object.defineProperty(globalThis, "document", {
  value: documentState,
  configurable: true,
});
Object.defineProperty(globalThis, "PerformanceObserver", {
  value: { supportedEntryTypes: [] },
  configurable: true,
});
const metricsModule = process.env.METRICS_MODULE ?? "../src/metrics.ts";
const { FrameMetrics } = await import(metricsModule);

test("unsupported long-task collection remains unavailable rather than a measured zero", () => {
  const metrics = new FrameMetrics();
  assert.equal(metrics.snapshot().longTasks, null);
  assert.equal(metrics.snapshot().longTasksSupported, false);
  metrics.dispose();
});

test("returning from a hidden tab excludes the background interval from frame times", () => {
  const metrics = new FrameMetrics();
  metrics.tick(10);
  metrics.tick(26);
  documentState.visibilityState = "hidden";
  events.dispatchEvent(new Event("visibilitychange"));
  documentState.visibilityState = "visible";
  events.dispatchEvent(new Event("visibilitychange"));
  metrics.tick(10016);
  metrics.tick(10032);
  assert.deepEqual(metrics.snapshot().frameTimesMs, [16, 16]);
  metrics.dispose();
});

test("a wrapped frame history exports chronological recent samples", () => {
  const metrics = new FrameMetrics();
  let now = 1;
  metrics.tick(now);
  for (let duration = 1; duration <= 18005; duration++) {
    now += duration;
    metrics.tick(now);
  }
  const result = metrics.snapshot();
  assert.equal(result.samples, 18000);
  assert.equal(result.frameTimesMs[0], 6);
  assert.equal(result.frameTimesMs.at(-1), 18005);
  assert.ok(Math.abs(result.fps! - 1000 / 17975.5) < 0.000001);
  metrics.dispose();
});
