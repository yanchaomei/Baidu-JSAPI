export const HEADER_BYTES = 24;
export const STRIDE_FLOATS = 7;
export const MAGIC = 0x42534731;
export const VERSION = 1;
export const MAX_FRAME_BYTES = 8 * 1024 * 1024;
export const GENERATION_LIMITS = {
  count: [1, 2_000_000],
  seed: [0, 0xffffffff],
  batch: [32, 16384],
  delay: [0, 1000],
  lines: [1, 200_000],
  areas: [1, 100_000],
} as const;

export type GeometryKind = 1 | 2 | 3;

export interface GeometryBatch {
  kind: GeometryKind;
  sequence: number;
  featureCount: number;
  vertices: Float32Array;
}

interface PendingFrame {
  kind: GeometryKind;
  sequence: number;
  featureCount: number;
  body: Uint8Array;
  received: number;
}

/** Consumes transport fragments without retaining earlier geometry frames. */
export class FrameDecoder {
  private readonly header = new Uint8Array(HEADER_BYTES);
  private headerUsed = 0;
  private pending: PendingFrame | null = null;
  private expectedSequence = 0;

  push(chunk: Uint8Array): GeometryBatch[] {
    return Array.from(this.frames(chunk));
  }

  /** Decode the next frame only when the consumer requests it. */
  *frames(chunk: Uint8Array): IterableIterator<GeometryBatch> {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.pending) {
        const count = Math.min(
          HEADER_BYTES - this.headerUsed,
          chunk.length - offset,
        );
        this.header.set(
          chunk.subarray(offset, offset + count),
          this.headerUsed,
        );
        this.headerUsed += count;
        offset += count;
        if (this.headerUsed < HEADER_BYTES) break;
        const view = new DataView(this.header.buffer);
        const kind = view.getUint16(6, true);
        const frameBytes = view.getUint32(8, true);
        const featureCount = view.getUint32(12, true);
        const vertexCount = view.getUint32(16, true);
        const sequence = view.getUint32(20, true);
        if (view.getUint32(0, true) !== MAGIC)
          throw new Error("Invalid geometry frame magic");
        if (view.getUint16(4, true) !== VERSION)
          throw new Error("Unsupported geometry protocol version");
        if (kind !== 1 && kind !== 2 && kind !== 3)
          throw new Error("Invalid geometry kind");
        if (frameBytes < HEADER_BYTES || frameBytes > MAX_FRAME_BYTES)
          throw new Error("Geometry frame exceeds its size limit");
        const verticesPerFeature = kind === 1 ? 1 : kind === 2 ? 2 : 6;
        if (
          featureCount === 0 ||
          vertexCount !== featureCount * verticesPerFeature
        )
          throw new Error("Geometry frame count mismatch");
        if (frameBytes !== HEADER_BYTES + vertexCount * STRIDE_FLOATS * 4)
          throw new Error("Geometry frame length mismatch");
        if (sequence !== this.expectedSequence)
          throw new Error("Geometry frame sequence is not continuous");
        this.pending = {
          kind,
          sequence,
          featureCount,
          body: new Uint8Array(frameBytes - HEADER_BYTES),
          received: 0,
        };
      }
      const frame = this.pending;
      const count = Math.min(
        frame.body.length - frame.received,
        chunk.length - offset,
      );
      frame.body.set(chunk.subarray(offset, offset + count), frame.received);
      frame.received += count;
      offset += count;
      if (frame.received === frame.body.length) {
        const view = new DataView(frame.body.buffer);
        const vertices = new Float32Array(frame.body.length / 4);
        for (let index = 0; index < vertices.length; index++) {
          const value = view.getFloat32(index * 4, true);
          const attribute = index % STRIDE_FLOATS;
          if (!Number.isFinite(value))
            throw new Error("Geometry contains a non-finite vertex attribute");
          if (attribute < 2 && (value < -1 || value > 1))
            throw new Error("Geometry coordinate is outside the local plane");
          if (attribute >= 2 && attribute <= 5 && (value < 0 || value > 1))
            throw new Error("Geometry color is outside [0,1]");
          if (attribute === 6 && value <= 0)
            throw new Error("Geometry vertex size must be positive");
          vertices[index] = value;
        }
        const batch = {
          kind: frame.kind,
          sequence: frame.sequence,
          featureCount: frame.featureCount,
          vertices,
        };
        this.expectedSequence++;
        this.pending = null;
        this.headerUsed = 0;
        yield batch;
      }
    }
  }

  finish(): void {
    if (this.headerUsed !== 0 || this.pending)
      throw new Error("Geometry stream ended with a truncated frame");
  }
}
