export class FrameMetrics {
  private frames: number[] = [];
  private cursor = 0;
  private last = 0;
  private observer: PerformanceObserver | null = null;
  readonly longTasksSupported =
    typeof PerformanceObserver !== "undefined" &&
    (PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false);
  private visibilityChanged = () => {
    this.last = 0;
  };
  longTasks = 0;
  longTaskMs = 0;

  constructor() {
    document.addEventListener("visibilitychange", this.visibilityChanged);
    if (this.longTasksSupported) {
      this.observer = new PerformanceObserver((list) => {
        for (const item of list.getEntries()) {
          this.longTasks++;
          this.longTaskMs += item.duration;
        }
      });
      this.observer.observe({ type: "longtask", buffered: false });
    }
  }
  tick(now: number) {
    if (this.last && document.visibilityState === "visible") {
      const delta = now - this.last;
      if (delta > 0) {
        if (this.frames.length < 18000) this.frames.push(delta);
        else {
          this.frames[this.cursor] = delta;
          this.cursor = (this.cursor + 1) % 18000;
        }
      }
    }
    this.last = document.visibilityState === "visible" ? now : 0;
  }
  reset() {
    this.frames = [];
    this.cursor = 0;
    this.last = 0;
    this.longTasks = 0;
    this.longTaskMs = 0;
  }
  snapshot() {
    const raw =
      this.frames.length === 18000
        ? [
            ...this.frames.slice(this.cursor),
            ...this.frames.slice(0, this.cursor),
          ]
        : this.frames.slice();
    const sorted = raw.slice().sort((a, b) => a - b);
    const q = (p: number) =>
      sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
    const recent = raw.slice(-60);
    return {
      samples: raw.length,
      fps: recent.length
        ? (1000 * recent.length) / recent.reduce((a, b) => a + b, 0)
        : null,
      p50Ms: q(0.5),
      p95Ms: q(0.95),
      p99Ms: q(0.99),
      maxMs: sorted.at(-1) ?? null,
      longTasksSupported: this.longTasksSupported,
      longTasks: this.longTasksSupported ? this.longTasks : null,
      longTaskMs: this.longTasksSupported ? this.longTaskMs : null,
      frameTimesMs: raw,
    };
  }
  dispose() {
    this.observer?.disconnect();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
  }
}
