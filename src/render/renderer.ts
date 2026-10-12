import { STRIDE_FLOATS } from "../data/protocol.ts";
import type { GeometryBatch, GeometryKind } from "../data/protocol.ts";

const PAGE_VERTICES = 65532;
const STRIDE_BYTES = STRIDE_FLOATS * 4;

type Page = {
  kind: GeometryKind;
  buffer: WebGLBuffer;
  count: number;
  capacity: number;
};
export type RenderStats = {
  points: number;
  lines: number;
  areas: number;
  vertices: number;
  gpuBytes: number;
  uploadedBytes: number;
  drawCalls: number;
  updates: number;
};

const vertexSource = `
attribute vec2 a_position;
attribute vec4 a_color;
attribute float a_size;
uniform mat4 u_matrix;
uniform float u_pixelRatio;
uniform float u_pointScale;
varying vec4 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
  gl_PointSize = a_size * u_pixelRatio * u_pointScale;
  v_color = a_color;
}`;

const fragmentSource = `
precision mediump float;
varying vec4 v_color;
uniform float u_points;
void main() {
  float alpha = v_color.a;
  if (u_points > 0.5) {
    float radius = length(gl_PointCoord - vec2(0.5));
    if (radius > 0.5) discard;
    alpha *= 1.0 - smoothstep(0.30, 0.5, radius);
  }
  gl_FragColor = vec4(v_color.rgb, alpha);
}`;

function shader(gl: WebGLRenderingContext, type: number, source: string) {
  const result = gl.createShader(type);
  if (!result) throw new Error("无法分配 Shader");
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(`Shader 编译失败：${info}`);
  }
  return result;
}

/** Owns only its buffers/program. A future map adapter supplies the verified matrix/state contract. */
export class GeometryRenderer {
  private pages: Page[] = [];
  private program: WebGLProgram;
  private position: number;
  private color: number;
  private size: number;
  private matrix: WebGLUniformLocation | null;
  private points: WebGLUniformLocation | null;
  private pixelRatio: WebGLUniformLocation | null;
  private pointScale: WebGLUniformLocation | null;
  private sample: {
    page: Page;
    original: Float32Array;
    working: Float32Array;
  } | null = null;
  private counters = this.empty();
  visibility = { points: true, lines: true, areas: true };

  constructor(private gl: WebGLRenderingContext) {
    const vs = shader(gl, gl.VERTEX_SHADER, vertexSource);
    let fs: WebGLShader | null = null;
    let program: WebGLProgram | null = null;
    try {
      fs = shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      if (!program) throw new Error("无法分配 WebGL Program");
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Program 链接失败：${gl.getProgramInfoLog(program)}`);
      }
    } catch (error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
    }
    this.program = program;
    this.position = gl.getAttribLocation(program, "a_position");
    this.color = gl.getAttribLocation(program, "a_color");
    this.size = gl.getAttribLocation(program, "a_size");
    this.matrix = gl.getUniformLocation(program, "u_matrix");
    this.points = gl.getUniformLocation(program, "u_points");
    this.pixelRatio = gl.getUniformLocation(program, "u_pixelRatio");
    this.pointScale = gl.getUniformLocation(program, "u_pointScale");
  }

  private empty(): RenderStats {
    return {
      points: 0,
      lines: 0,
      areas: 0,
      vertices: 0,
      gpuBytes: 0,
      uploadedBytes: 0,
      drawCalls: 0,
      updates: 0,
    };
  }

  append(batch: GeometryBatch) {
    const gl = this.gl;
    const total = batch.vertices.length / STRIDE_FLOATS;
    let source = 0;
    while (source < total) {
      let page = this.pages.findLast((item) => item.kind === batch.kind);
      if (!page || page.count === page.capacity) {
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error("无法分配 GPU Buffer");
        const capacity =
          batch.kind !== 1 &&
          !this.pages.some((item) => item.kind === batch.kind)
            ? Math.min(PAGE_VERTICES, Math.max(510, Math.ceil(total / 6) * 6))
            : PAGE_VERTICES;
        page = { kind: batch.kind, buffer, count: 0, capacity };
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          capacity * STRIDE_BYTES,
          gl.DYNAMIC_DRAW,
        );
        if (gl.getError() !== gl.NO_ERROR) {
          gl.deleteBuffer(buffer);
          throw new Error("GPU Buffer 分配失败，请减小数据规模");
        }
        this.pages.push(page);
        this.counters.gpuBytes += capacity * STRIDE_BYTES;
      }
      const count = Math.min(page.capacity - page.count, total - source);
      const values = batch.vertices.subarray(
        source * STRIDE_FLOATS,
        (source + count) * STRIDE_FLOATS,
      );
      gl.bindBuffer(gl.ARRAY_BUFFER, page.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, page.count * STRIDE_BYTES, values);
      if (batch.kind === 1 && !this.sample) {
        const original = values.slice(0, Math.min(512, count) * STRIDE_FLOATS);
        this.sample = { page, original, working: original.slice() };
      }
      page.count += count;
      source += count;
    }
    this.counters.vertices += total;
    this.counters.uploadedBytes += batch.vertices.byteLength;
    if (batch.kind === 1) this.counters.points += batch.featureCount;
    if (batch.kind === 2) this.counters.lines += batch.featureCount;
    if (batch.kind === 3) this.counters.areas += batch.featureCount;
  }

  /** Synthetic device-state changes: a bounded real bufferSubData update, not a measured sensor feed. */
  updateDevices(tick: number) {
    if (!this.sample) return;
    const { page, original, working } = this.sample;
    working.set(original);
    for (let i = 0; i < working.length; i += STRIDE_FLOATS) {
      if ((i / STRIDE_FLOATS + tick) % 31 === 0) {
        working[i + 2] = 1;
        working[i + 3] = 0.4;
        working[i + 4] = 0.32;
        working[i + 6] = original[i + 6] + 1;
      }
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, page.buffer);
    this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, working);
    this.counters.uploadedBytes += working.byteLength;
    this.counters.updates += working.length / STRIDE_FLOATS;
  }

  render(matrix: Float32Array, pixelRatio = 1, pointScale = 1) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(this.matrix, false, matrix);
    gl.uniform1f(this.pixelRatio, pixelRatio);
    gl.uniform1f(this.pointScale, pointScale);
    let draws = 0;
    for (const kind of [3, 2, 1] as const) {
      if (
        !this.visibility[kind === 1 ? "points" : kind === 2 ? "lines" : "areas"]
      )
        continue;
      gl.uniform1f(this.points, kind === 1 ? 1 : 0);
      for (const page of this.pages) {
        if (page.kind !== kind || page.count === 0) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, page.buffer);
        gl.enableVertexAttribArray(this.position);
        gl.vertexAttribPointer(
          this.position,
          2,
          gl.FLOAT,
          false,
          STRIDE_BYTES,
          0,
        );
        gl.enableVertexAttribArray(this.color);
        gl.vertexAttribPointer(this.color, 4, gl.FLOAT, false, STRIDE_BYTES, 8);
        gl.enableVertexAttribArray(this.size);
        gl.vertexAttribPointer(this.size, 1, gl.FLOAT, false, STRIDE_BYTES, 24);
        gl.drawArrays(
          kind === 1 ? gl.POINTS : kind === 2 ? gl.LINES : gl.TRIANGLES,
          0,
          page.count,
        );
        draws++;
      }
    }
    this.counters.drawCalls = draws;
  }

  stats(): RenderStats {
    return { ...this.counters };
  }
  clear() {
    for (const page of this.pages) this.gl.deleteBuffer(page.buffer);
    this.pages = [];
    this.sample = null;
    this.counters = this.empty();
  }
  dispose() {
    this.clear();
    this.gl.deleteProgram(this.program);
  }
}
