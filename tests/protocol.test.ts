import assert from "node:assert/strict";
import test from "node:test";
import { FrameDecoder } from "../src/data/protocol.ts";

// A worked wire example from data-protocol.md, independent of the generator.
function wireFrame(
  kind: number,
  sequence: number,
  featureCount: number,
  vertices: number[],
): Uint8Array {
  const bytes = new Uint8Array(24 + vertices.length * 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x42534731, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, kind, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, featureCount, true);
  view.setUint32(16, vertices.length / 7, true);
  view.setUint32(20, sequence, true);
  vertices.forEach((value, index) =>
    view.setFloat32(24 + index * 4, value, true),
  );
  return bytes;
}

test("decoder preserves geometry when network chunks split headers, vertices and frame boundaries", () => {
  const point = wireFrame(1, 0, 1, [0.25, -0.5, 0, 1, 0.5, 1, 3]);
  const line = wireFrame(
    2,
    1,
    1,
    [-1, 0, 0, 0.5, 1, 1, 2, 1, 0, 0, 0.5, 1, 1, 2],
  );
  const stream = new Uint8Array(point.length + line.length);
  stream.set(point);
  stream.set(line, point.length);
  const decoder = new FrameDecoder();
  const output = [];
  let offset = 0;
  for (const length of [1, 7, 13, 2, 25, 9, 3, 1, 1000]) {
    const end = Math.min(offset + length, stream.length);
    output.push(...decoder.push(stream.subarray(offset, end)));
    offset = end;
  }
  decoder.finish();
  assert.deepEqual(
    output.map(({ kind, sequence, featureCount, vertices }) => ({
      kind,
      sequence,
      featureCount,
      vertices: [...vertices],
    })),
    [
      {
        kind: 1,
        sequence: 0,
        featureCount: 1,
        vertices: [0.25, -0.5, 0, 1, 0.5, 1, 3],
      },
      {
        kind: 2,
        sequence: 1,
        featureCount: 1,
        vertices: [-1, 0, 0, 0.5, 1, 1, 2, 1, 0, 0, 0.5, 1, 1, 2],
      },
    ],
  );
});

test("decoder rejects malformed headers, inconsistent counts and unsafe vertex values", () => {
  const valid = [0.25, -0.5, 0, 1, 0.5, 1, 3];
  const headers: Array<[string, (view: DataView) => void]> = [
    ["magic", (view) => view.setUint32(0, 0, true)],
    ["version", (view) => view.setUint16(4, 2, true)],
    ["kind", (view) => view.setUint16(6, 4, true)],
    ["length smaller than header", (view) => view.setUint32(8, 23, true)],
    [
      "frame above 8 MiB",
      (view) => view.setUint32(8, 8 * 1024 * 1024 + 1, true),
    ],
    ["zero features", (view) => view.setUint32(12, 0, true)],
    ["feature count mismatch", (view) => view.setUint32(12, 2, true)],
    ["vertex count mismatch", (view) => view.setUint32(16, 2, true)],
    ["sequence must start at zero", (view) => view.setUint32(20, 1, true)],
  ];
  for (const [name, change] of headers) {
    const frame = wireFrame(1, 0, 1, valid);
    change(new DataView(frame.buffer));
    assert.throws(() => new FrameDecoder().push(frame), Error, name);
  }
  for (const [name, index, value] of [
    ["infinite coordinate", 0, Infinity],
    ["NaN coordinate", 1, NaN],
    ["outside local plane", 0, 1.01],
    ["negative color", 2, -0.01],
    ["color above one", 4, 1.01],
    ["infinite alpha", 5, Infinity],
    ["zero size", 6, 0],
    ["negative size", 6, -1],
  ] as const) {
    const vertices = [...valid];
    vertices[index] = value;
    assert.throws(
      () => new FrameDecoder().push(wireFrame(1, 0, 1, vertices)),
      Error,
      name,
    );
  }
  const decoder = new FrameDecoder();
  decoder.push(wireFrame(1, 0, 1, valid));
  assert.throws(
    () => decoder.push(wireFrame(1, 0, 1, valid)),
    Error,
    "duplicate sequence",
  );
});

test("finish rejects a truncated header or a truncated vertex payload", () => {
  const frame = wireFrame(1, 0, 1, [0.25, -0.5, 0, 1, 0.5, 1, 3]);
  for (const incomplete of [
    frame.subarray(0, 11),
    frame.subarray(0, frame.length - 1),
  ]) {
    const decoder = new FrameDecoder();
    decoder.push(incomplete);
    assert.throws(() => decoder.finish(), Error);
  }
  assert.doesNotThrow(() => new FrameDecoder().finish());
});

test("frame iterator yields one completed frame before inspecting the next frame in the same chunk", () => {
  const valid = wireFrame(1, 0, 1, [0.25, -0.5, 0, 1, 0.5, 1, 3]);
  const invalid = wireFrame(1, 1, 1, [-0.25, 0.5, 0, 1, 0.5, 1, 3]);
  new DataView(invalid.buffer).setUint32(0, 0, true);
  const chunk = new Uint8Array(valid.length + invalid.length);
  chunk.set(valid);
  chunk.set(invalid, valid.length);
  const decoder = new FrameDecoder();
  const frames = decoder.frames(chunk);
  const first = frames.next();
  assert.equal(first.done, false);
  assert.deepEqual(first.value, {
    kind: 1,
    sequence: 0,
    featureCount: 1,
    vertices: new Float32Array([0.25, -0.5, 0, 1, 0.5, 1, 3]),
  });
  // The yielded frame is complete even while its consumer pauses the iterator.
  assert.doesNotThrow(() => decoder.finish());
  assert.throws(() => frames.next(), /magic/);
});
