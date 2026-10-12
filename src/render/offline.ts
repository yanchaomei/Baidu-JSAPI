import { GeometryRenderer } from "./renderer.ts";

export class OfflineView {
  readonly gl: WebGLRenderingContext;
  renderer: GeometryRenderer;
  private zoom = 1;
  private angle = -0.1;
  private pan = { x: 0, y: 0 };
  private drag: { x: number; y: number; rotate: boolean } | null = null;
  private observer: ResizeObserver;
  private abort = new AbortController();
  private labels: HTMLElement;
  lost = false;
  onContextLost: () => void = () => {};
  onContextRestored: () => void = () => {};

  constructor(
    readonly canvas: HTMLCanvasElement,
    labels: HTMLElement,
  ) {
    this.labels = labels;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("当前浏览器无法创建 WebGL 上下文");
    this.gl = gl;
    this.renderer = new GeometryRenderer(gl);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    const options = { signal: this.abort.signal };
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.zoom = Math.max(
          0.35,
          Math.min(8, this.zoom * Math.exp(-event.deltaY * 0.001)),
        );
      },
      { ...options, passive: false },
    );
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        this.drag = {
          x: event.clientX,
          y: event.clientY,
          rotate: event.shiftKey || event.button === 2,
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.classList.add("dragging");
      },
      options,
    );
    canvas.addEventListener(
      "pointermove",
      (event) => {
        if (!this.drag) return;
        const dx = event.clientX - this.drag.x,
          dy = event.clientY - this.drag.y;
        if (this.drag.rotate) this.angle += dx * 0.006;
        else {
          this.pan.x += (dx * 2) / canvas.clientWidth;
          this.pan.y -= (dy * 2) / canvas.clientHeight;
        }
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
      },
      options,
    );
    const release = () => {
      this.drag = null;
      canvas.classList.remove("dragging");
    };
    canvas.addEventListener("pointerup", release, options);
    canvas.addEventListener("pointercancel", release, options);
    canvas.addEventListener(
      "contextmenu",
      (event) => event.preventDefault(),
      options,
    );
    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        this.lost = true;
        this.onContextLost();
      },
      options,
    );
    canvas.addEventListener(
      "webglcontextrestored",
      () => {
        const visibility = { ...this.renderer.visibility };
        this.renderer = new GeometryRenderer(gl);
        this.renderer.visibility = visibility;
        this.lost = false;
        this.onContextRestored();
      },
      options,
    );
    this.resize();
  }

  private resize() {
    const ratio = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.max(
      1,
      Math.round(this.canvas.clientWidth * ratio),
    );
    this.canvas.height = Math.max(
      1,
      Math.round(this.canvas.clientHeight * ratio),
    );
  }

  matrix() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const sx = Math.min(1, 1 / aspect) * this.zoom;
    const sy = Math.min(1, aspect) * this.zoom;
    const c = Math.cos(this.angle),
      s = Math.sin(this.angle);
    return new Float32Array([
      sx * c,
      sy * s,
      0,
      0,
      -sx * s,
      sy * c,
      0,
      0,
      0,
      0,
      1,
      0,
      this.pan.x,
      this.pan.y,
      0,
      1,
    ]);
  }

  draw() {
    if (this.lost) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const matrix = this.matrix();
    this.renderer.render(
      matrix,
      Math.min(devicePixelRatio, 2),
      Math.max(0.65, Math.sqrt(this.zoom)),
    );
    for (const label of this.labels.querySelectorAll<HTMLElement>("[data-x]")) {
      const x = Number(label.dataset.x),
        y = Number(label.dataset.y);
      const nx = matrix[0] * x + matrix[4] * y + matrix[12];
      const ny = matrix[1] * x + matrix[5] * y + matrix[13];
      label.style.left = `${(nx + 1) * 50}%`;
      label.style.top = `${(1 - ny) * 50}%`;
      label.style.opacity =
        Math.abs(nx) > 0.9 || Math.abs(ny) > 0.9 ? "0" : "1";
    }
  }

  fit() {
    this.zoom = 1;
    this.angle = -0.1;
    this.pan = { x: 0, y: 0 };
  }
  zoomBy(factor: number) {
    this.zoom = Math.max(0.35, Math.min(8, this.zoom * factor));
  }
  rotateBy(radians: number) {
    this.angle += radians;
  }
  panBy(x: number, y: number) {
    this.pan.x += x;
    this.pan.y += y;
  }
  cameraAt(elapsedMs: number) {
    const phase = elapsedMs / 1000;
    this.zoom = 1 + 0.08 * Math.sin(phase * 0.7);
    this.angle = -0.1 + 0.12 * Math.sin(phase * 0.6);
    this.pan = {
      x: 0.035 * Math.sin(phase * 0.5),
      y: 0.03 * Math.sin(phase * 0.8),
    };
  }
  deviceInfo() {
    const debug = this.gl.getExtension("WEBGL_debug_renderer_info");
    return {
      version: this.gl.getParameter(this.gl.VERSION),
      renderer: debug
        ? this.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : this.gl.getParameter(this.gl.RENDERER),
      vendor: debug
        ? this.gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
        : this.gl.getParameter(this.gl.VENDOR),
      width: this.canvas.width,
      height: this.canvas.height,
      devicePixelRatio,
    };
  }
  dispose() {
    this.observer.disconnect();
    this.abort.abort();
    this.renderer.dispose();
  }
}
