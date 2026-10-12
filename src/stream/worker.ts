/// <reference lib="webworker" />
import { FrameDecoder } from "../data/protocol.ts";

const context = self as unknown as DedicatedWorkerGlobalScope;
let credits = 2;
let paused = false;
let wake: (() => void) | null = null;
let running = false;

async function available() {
  while (paused || credits <= 0)
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
}

context.onmessage = (event) => {
  const message = event.data;
  if (message.type === "credit") credits++;
  if (message.type === "pause") paused = true;
  if (message.type === "resume") paused = false;
  if (message.type === "start" && !running) {
    running = true;
    void load(message.url);
  }
  const ready = wake;
  wake = null;
  ready?.();
};

async function load(url: string) {
  let bytes = 0,
    parseMs = 0,
    batches = 0;
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`数据服务返回 HTTP ${response.status}`);
    if (!response.body) throw new Error("浏览器未提供 Fetch Stream");
    const reader = response.body.getReader();
    const decoder = new FrameDecoder();
    while (true) {
      await available();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      const iterator = decoder.frames(value);
      while (true) {
        await available();
        const start = performance.now();
        const next = iterator.next();
        parseMs += performance.now() - start;
        if (next.done) break;
        const batch = next.value;
        credits--;
        batches++;
        context.postMessage({ type: "batch", batch, bytes, parseMs }, [
          batch.vertices.buffer,
        ]);
      }
    }
    decoder.finish();
    if (!batches) throw new Error("数据流为空");
    context.postMessage({
      type: "done",
      bytes,
      parseMs,
      streamEnd: performance.timeOrigin + performance.now(),
    });
  } catch (error) {
    context.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "流式处理失败",
    });
  }
}
