import { FrameDecoder } from "../data/protocol.ts";
import type { GeometryBatch } from "../data/protocol.ts";
import type { GeometryRenderer } from "../render/renderer.ts";

export type Mode = "worker" | "worker-basic" | "main" | "full";
export type Status =
  | "idle"
  | "loading"
  | "paused"
  | "complete"
  | "cancelled"
  | "error";
export type SessionStats = {
  status: Status;
  mode: Mode;
  target: number;
  lineTarget: number;
  areaTarget: number;
  delay: number;
  bytes: number;
  parsed: number;
  submitted: number;
  queue: number;
  queuePeak: number;
  parseMs: number;
  uploadMs: number;
  firstDrawMs: number | null;
  streamConsumedMs: number | null;
  completeMs: number | null;
  error: string | null;
};

export class StreamSession {
  private worker: Worker | null = null;
  private abort: AbortController | null = null;
  private queue: GeometryBatch[] = [];
  private generation = 0;
  private ended = false;
  private startTime = 0;
  private startEpoch = 0;
  private wake: (() => void) | null = null;
  private state: SessionStats = this.empty();

  private empty(): SessionStats {
    return {
      status: "idle",
      mode: "worker",
      target: 0,
      lineTarget: 0,
      areaTarget: 0,
      delay: 0,
      bytes: 0,
      parsed: 0,
      submitted: 0,
      queue: 0,
      queuePeak: 0,
      parseMs: 0,
      uploadMs: 0,
      firstDrawMs: null,
      streamConsumedMs: null,
      completeMs: null,
      error: null,
    };
  }
  stats() {
    return { ...this.state, queue: this.queue.length };
  }

  start(
    count: number,
    mode: Mode,
    delay = 8,
    geometry = { lines: 89, areas: 40 },
  ) {
    this.stop();
    const generation = this.generation;
    this.state = {
      ...this.empty(),
      status: "loading",
      mode,
      target: count,
      lineTarget: geometry.lines,
      areaTarget: geometry.areas,
      delay,
    };
    this.startTime = performance.now();
    this.startEpoch = performance.timeOrigin + this.startTime;
    this.ended = false;
    const url = `/api/stream?count=${count}&seed=42&batch=4096&delay=${delay}&lines=${geometry.lines}&areas=${geometry.areas}`;
    if (mode === "worker" || mode === "worker-basic") {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (event) => {
        if (generation !== this.generation) return;
        const message = event.data;
        if (message.type === "batch") {
          this.accept(message.batch);
          this.state.bytes = message.bytes;
          this.state.parseMs = message.parseMs;
        } else if (message.type === "done") {
          this.state.bytes = message.bytes;
          this.state.parseMs = message.parseMs;
          this.state.streamConsumedMs = message.streamEnd - this.startEpoch;
          this.ended = true;
        } else if (message.type === "error") this.fail(message.message);
      };
      this.worker.onerror = () => {
        if (generation === this.generation) this.fail("Worker 启动或执行失败");
      };
      this.worker.postMessage({ type: "start", url });
    } else {
      this.abort = new AbortController();
      void this.loadMain(url, generation, mode, this.abort.signal);
    }
  }

  private accept(batch: GeometryBatch) {
    this.queue.push(batch);
    this.state.parsed += batch.featureCount;
    this.state.queuePeak = Math.max(this.state.queuePeak, this.queue.length);
  }
  private async available(generation: number) {
    while (
      generation === this.generation &&
      (this.state.status === "paused" || this.queue.length >= 2)
    ) {
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
    return generation === this.generation;
  }
  private release() {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private async loadMain(
    url: string,
    generation: number,
    mode: Mode,
    signal: AbortSignal,
  ) {
    try {
      const response = await fetch(url, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`数据服务返回 HTTP ${response.status}`);
      const decoder = new FrameDecoder();
      let batches = 0;
      if (mode === "full") {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (generation !== this.generation) return;
        this.state.bytes = bytes.byteLength;
        this.state.streamConsumedMs = performance.now() - this.startTime;
        const start = performance.now();
        const decoded = decoder.push(bytes);
        this.state.parseMs += performance.now() - start;
        decoder.finish();
        for (const batch of decoded) {
          if (!(await this.available(generation))) return;
          this.accept(batch);
          batches++;
        }
      } else {
        if (!response.body) throw new Error("浏览器未提供 Fetch Stream");
        const reader = response.body.getReader();
        while (true) {
          if (!(await this.available(generation))) return;
          const { done, value } = await reader.read();
          if (generation !== this.generation) return;
          if (done) break;
          this.state.bytes += value.byteLength;
          const iterator = decoder.frames(value);
          while (true) {
            if (!(await this.available(generation))) return;
            const start = performance.now();
            const next = iterator.next();
            this.state.parseMs += performance.now() - start;
            if (next.done) break;
            const batch = next.value;
            this.accept(batch);
            batches++;
          }
        }
        decoder.finish();
        this.state.streamConsumedMs = performance.now() - this.startTime;
      }
      if (generation === this.generation) {
        if (!batches) throw new Error("数据流为空");
        this.ended = true;
      }
    } catch (error) {
      if (generation === this.generation && !signal.aborted)
        this.fail(error instanceof Error ? error.message : "加载失败");
    }
  }

  consume(renderer: GeometryRenderer) {
    if (this.state.status !== "loading") return;
    const begin = performance.now();
    const budget = this.state.mode === "worker" ? 3 : Number.POSITIVE_INFINITY;
    while (this.queue.length) {
      const batch = this.queue.shift()!;
      try {
        renderer.append(batch);
      } catch (error) {
        this.fail(error instanceof Error ? error.message : "GPU 提交失败");
        return;
      }
      this.state.submitted += batch.featureCount;
      this.worker?.postMessage({ type: "credit" });
      this.release();
      if (performance.now() - begin >= budget) break;
    }
    this.state.uploadMs += performance.now() - begin;
    if (this.ended && this.queue.length === 0) {
      this.state.status = "complete";
      this.state.completeMs = performance.now() - this.startTime;
      this.worker?.terminate();
      this.worker = null;
    }
  }
  drew() {
    if (this.state.submitted > 0 && this.state.firstDrawMs === null)
      this.state.firstDrawMs = performance.now() - this.startTime;
  }
  pause() {
    if (this.state.status !== "loading") return;
    this.state.status = "paused";
    this.worker?.postMessage({ type: "pause" });
  }
  resume() {
    if (this.state.status !== "paused") return;
    this.state.status = "loading";
    this.worker?.postMessage({ type: "resume" });
    this.release();
  }
  cancel() {
    this.stop();
    this.state.status = "cancelled";
  }
  reset() {
    this.stop();
    this.state = this.empty();
  }
  private stop() {
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
    this.abort?.abort();
    this.abort = null;
    this.queue = [];
    this.release();
  }
  private fail(message: string) {
    this.stop();
    this.state.status = "error";
    this.state.error = message;
  }
  dispose() {
    this.stop();
  }
}
