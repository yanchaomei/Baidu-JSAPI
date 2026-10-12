import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { createServer, get } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { FrameDecoder } from "../src/data/protocol.ts";

const middlewarePath = "../server/stream.mjs";
const generatorPath = "../server/generator.mjs";
const { streamMiddleware } = await import(middlewarePath);
const { generateFrames } = await import(generatorPath);

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => {
    void streamMiddleware(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("HTTP produces identical complete industrial geometry for the same seed and parameters", async () => {
  await withServer(async (base) => {
    const load = async (seed: number) => {
      const response = await fetch(
        `${base}/api/stream?count=57&seed=${seed}&batch=32&delay=0`,
      );
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/octet-stream/,
      );
      return new Uint8Array(await response.arrayBuffer());
    };
    const first = await load(42);
    assert.equal(
      createHash("sha256").update(first).digest("hex"),
      "5b44a3979522c701bde3127c7bd7e386bd782f1f056953af436e782c0b521956",
    );
    assert.deepEqual(await load(42), first);
    assert.notDeepEqual(await load(43), first);
    const decoder = new FrameDecoder();
    const batches = decoder.push(first);
    decoder.finish();
    assert.deepEqual(
      batches.map(({ kind, featureCount }) => [kind, featureCount]),
      [
        [3, 40],
        [2, 89],
        [1, 32],
        [1, 25],
      ],
    );
  });
});

test("HTTP rejects invalid, unknown or duplicate parameters before streaming", async () => {
  await withServer(async (base) => {
    for (const query of [
      "count=0",
      "count=-1",
      "count=2000001",
      "count=1.5",
      "count=1e3",
      "count=",
      "count=%201",
      "seed=-1",
      "seed=4294967296",
      "batch=31",
      "batch=16385",
      "delay=-1",
      "delay=1001",
      "delay=1.5",
      "count=1&count=2",
      "seed=1&seed=2",
      "batch=32&batch=64",
      "delay=1&delay=2",
      "unexpected=1",
      "lines=0",
      "lines=200001",
      "lines=1.5",
      "areas=0",
      "areas=100001",
      "areas=-1",
      "lines=1&lines=2",
      "areas=1&areas=2",
    ]) {
      const response = await fetch(`${base}/api/stream?${query}`);
      assert.equal(response.status, 400, query);
      assert.match(await response.text(), /error/i);
    }
    const zeroSeed = await fetch(
      `${base}/api/stream?count=1&seed=0&batch=32&delay=0`,
    );
    assert.equal(zeroSeed.status, 200);
    await zeroSeed.arrayBuffer();
    assert.equal((await fetch(`${base}/not-the-stream`)).status, 404);
  });
});

test(
  "a real HTTP client can cancel before the full geometry response is generated",
  { timeout: 3000 },
  async () => {
    let received = 0;
    let stoppedBeforeFinish = false;
    let resolveClose: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      resolveClose = resolve;
    });
    const server = createServer((req, res) => {
      res.once("close", () => {
        stoppedBeforeFinish = !res.writableFinished;
        resolveClose();
      });
      void streamMiddleware(req, res);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const request = get(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/stream?count=2000000&batch=32&delay=10`,
        (response) => {
          response.once("data", (chunk: Buffer) => {
            received += chunk.length;
            request.destroy();
          });
          response.on("error", () => {});
        },
      );
      request.on("error", () => {});
      await closed;
      assert.equal(stoppedBeforeFinish, true);
      assert.ok(received > 0 && received < 2_000_000 * 28);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

class SlowNetworkResponse extends Writable {
  statusCode = 200;
  headersSent = false;
  frameCount = 0;
  private releaseWrite: (() => void) | null = null;

  constructor() {
    super({ highWaterMark: 1 });
  }
  setHeader(): this {
    return this;
  }
  _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.headersSent = true;
    this.frameCount++;
    this.releaseWrite = callback;
    this.emit("frame");
  }
  release(): void {
    const callback = this.releaseWrite;
    this.releaseWrite = null;
    callback?.();
  }
}

test(
  "stream waits for HTTP drain and stops writing when the network closes",
  { timeout: 3000 },
  async () => {
    const request = Object.assign(new EventEmitter(), {
      url: "/api/stream?count=2000000&batch=32&delay=0",
      method: "GET",
      aborted: false,
    });
    const response = new SlowNetworkResponse();
    const streaming = streamMiddleware(request, response);
    await setImmediate();
    assert.equal(
      response.frameCount,
      1,
      "a blocked connection must not accumulate more geometry",
    );
    const nextFrame = once(response, "frame");
    response.release();
    await nextFrame;
    assert.equal(response.frameCount, 2);
    response.destroy();
    await streaming;
    assert.equal(
      response.frameCount,
      2,
      "closing a blocked connection must end generation",
    );
  },
);

test("generator exposes bounded frames at maximum scale and rejects invalid counts", () => {
  const iterator = generateFrames({ count: 2_000_000, seed: 42, batch: 16384 })[
    Symbol.iterator
  ]();
  const decoder = new FrameDecoder();
  for (let index = 0; index < 5; index++) {
    const next = iterator.next();
    assert.equal(next.done, false);
    assert.ok(next.value.byteLength <= 8 * 1024 * 1024);
    const [batch] = decoder.push(next.value);
    if (batch.kind === 1) assert.equal(batch.featureCount, 16384);
  }
  iterator.return?.();
  for (const count of [0, -1, 1.5, 2_000_001, NaN, Infinity]) {
    assert.throws(
      () =>
        generateFrames({ count, seed: 42, batch: 32 })
          [Symbol.iterator]()
          .next(),
      Error,
    );
  }
});

test(
  "HTTP streams requested mixed geometry counts through several bounded frames",
  { timeout: 10000 },
  async () => {
    await withServer(async (base) => {
      const response = await fetch(
        `${base}/api/stream?count=57&seed=42&batch=4096&delay=0&lines=100000&areas=10000`,
      );
      assert.equal(response.status, 200);
      assert.ok(response.body);
      const decoder = new FrameDecoder();
      const totals = { 1: 0, 2: 0, 3: 0 };
      const frames = { 1: 0, 2: 0, 3: 0 };
      const order = [];
      const reader = response.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const batch of decoder.frames(value)) {
          totals[batch.kind] += batch.featureCount;
          frames[batch.kind]++;
          order.push(batch.kind);
          assert.ok(batch.vertices.byteLength + 24 <= 8 * 1024 * 1024);
        }
      }
      decoder.finish();
      assert.deepEqual(totals, { 1: 57, 2: 100000, 3: 10000 });
      assert.ok(frames[2] > 1 && frames[3] > 1);
      assert.deepEqual(
        order,
        [...order].sort((left, right) => right - left),
      );
      const minimal = await fetch(
        `${base}/api/stream?count=1&seed=0&batch=32&delay=0&lines=1&areas=1`,
      );
      assert.equal(minimal.status, 200);
      const minimumDecoder = new FrameDecoder();
      assert.deepEqual(
        minimumDecoder
          .push(new Uint8Array(await minimal.arrayBuffer()))
          .map(({ kind, featureCount }) => [kind, featureCount]),
        [
          [3, 1],
          [2, 1],
          [1, 1],
        ],
      );
      minimumDecoder.finish();
    });
  },
);

test(
  "maximum mixed geometry is generated lazily without retaining all requested features",
  { timeout: 20000 },
  () => {
    const probe = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--expose-gc",
        "--input-type=module",
        "-e",
        `
    import assert from 'node:assert/strict';
    const { generateFrames } = await import(process.argv[1]);
    globalThis.gc();
    const baseline = process.memoryUsage();
    const iterator = generateFrames({ count: 2000000, seed: 42, batch: 16384, lines: 200000, areas: 100000 })[Symbol.iterator]();
    let areas = 0;
    let lines = 0;
    let peakBuffers = 0;
    let peakHeap = 0;
    for (;;) {
      const next = iterator.next();
      assert.equal(next.done, false);
      assert.ok(next.value.byteLength <= 8 * 1024 * 1024);
      const view = new DataView(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      const kind = view.getUint16(6, true);
      const features = view.getUint32(12, true);
      if (kind === 3) areas += features;
      if (kind === 2) lines += features;
      globalThis.gc();
      const memory = process.memoryUsage();
      peakBuffers = Math.max(peakBuffers, memory.arrayBuffers - baseline.arrayBuffers);
      peakHeap = Math.max(peakHeap, memory.heapUsed - baseline.heapUsed);
      if (kind === 1) break;
    }
    iterator.return?.();
    assert.equal(areas, 100000);
    assert.equal(lines, 200000);
    assert.ok(peakBuffers < 8 * 1024 * 1024, 'live geometry buffers exceed one frame budget: ' + peakBuffers);
    assert.ok(peakHeap < 16 * 1024 * 1024, 'retained feature objects exceed the bounded generator budget: ' + peakHeap);
    process.stdout.write(JSON.stringify({ peakBuffers, peakHeap }));
  `,
        new URL(generatorPath, import.meta.url).href,
      ],
      { encoding: "utf8", timeout: 18000 },
    );
    assert.equal(probe.status, 0, probe.stderr || probe.error?.message);
    assert.match(probe.stdout, /peakBuffers/);
  },
);
