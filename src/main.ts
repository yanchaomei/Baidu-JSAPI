import "./style.css";
import { OfflineView } from "./render/offline.ts";
import { StreamSession } from "./stream/session.ts";
import type { Mode } from "./stream/session.ts";
import { FrameMetrics } from "./metrics.ts";
import { checkBaidu } from "./map/baidu.ts";

const icon = (path: string, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const icons = {
  layers: icon(
    '<path d="m12 3 10 5-10 5L2 8l10-5Z"/><path d="m2 12 10 5 10-5M2 16l10 5 10-5"/>',
  ),
  arrow: icon('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  download: icon('<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', 17),
  settings: icon(
    '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3" fill="currentColor"/><circle cx="16" cy="17" r="3" fill="currentColor"/>',
    17,
  ),
  play: icon('<path d="m9 5 10 7-10 7V5Z"/>', 18),
  pause: icon('<path d="M8 5v14M16 5v14"/>', 17),
  cube: icon(
    '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10v10M3 7l9 5 9-5M7 4l10 6"/>',
    22,
  ),
};

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="流境首页"><span class="brandmark">${icons.layers}</span><strong>流境<span>FLOWSCAPE</span></strong></a>
    <nav class="topnav" aria-label="主导航"><span class="active">空间实验台</span><a href="https://github.com/yanchaomei/Baidu-JSAPI#readme" target="_blank" rel="noopener noreferrer">项目文档 ↗</a></nav>
    <div class="top-actions"><span class="version">EXPERIMENT / 0.1</span><button id="map-config" class="quiet">${icons.settings}<span>地图接入</span><i class="amber-dot"></i></button><button id="export" class="quiet">${icons.download}<span>导出记录</span></button></div>
  </header>
  <div class="workspace">
    <aside class="controls panel">
      <div class="section-head"><span class="eyebrow">SCENARIO</span><span class="tiny-number">01 / 03</span></div>
      <h2>工业园区运行态势</h2><p class="muted intro">设备、管网与区域数据，<br>从流入到可见。</p>
      <div class="scenario-card"><div class="scenario-icon">${icons.cube}</div><div><strong>智造园区 · 合成场景</strong><span>固定种子 42 / 局部平面坐标</span></div><span class="scenario-selected">✓</span></div>
      <div class="rule"></div>
      <div class="section-head"><span class="eyebrow">DATA SOURCE</span><span class="micro-badge">二进制流</span></div>
      <label class="field" for="count">设备点规模<select id="count"><option value="10000">10,000 · 小规模验证</option><option value="100000" selected>100,000 · 十万级</option><option value="1000000">1,000,000 · 百万级</option><option value="2000000">2,000,000 · 压力测试</option></select></label>
      <label class="field" for="mode">处理模式<select id="mode"><option value="worker">Worker 流式 · 帧预算</option><option value="worker-basic">Worker 流式 · 无帧预算基线</option><option value="main">主线程分块 · 基线</option><option value="full">全量下载解析 · 基线</option></select></label>
      <label class="field" for="delay">服务端每批间隔<select id="delay"><option value="0">0 ms · 无人为等待</option><option value="8" selected>8 ms · 连续数据流</option><option value="40">40 ms · 渐进展示</option></select></label>
      <label class="field" for="profile">线面数据规模<select id="profile"><option value="standard">场景级 · 89 线 / 40 面</option><option value="mixed">海量混合 · 10 万线 / 1 万面</option></select></label>
      <button id="start" class="primary">${icons.play}<span>开始流式加载</span>${icons.arrow}</button>
      <div class="secondary-actions"><button id="pause" disabled>${icons.pause}<span>暂停</span></button><button id="cancel" disabled><span class="stop-icon"></span>取消</button><button id="clear" title="清空数据并释放 GPU 资源">清空</button></div>
      <div class="rule"></div>
      <div class="section-head"><span class="eyebrow">LAYER CONTROL</span><span class="tiny-number">03</span></div>
      <label class="layer-row"><span class="legend-dot green"></span><span>设备与车辆</span><small id="layer-points">—</small><input id="show-points" type="checkbox" checked aria-label="显示设备与车辆"></label>
      <label class="layer-row"><span class="legend-line"></span><span>管网与路径</span><small id="layer-lines">—</small><input id="show-lines" type="checkbox" checked aria-label="显示管网与路径"></label>
      <label class="layer-row"><span class="legend-area"></span><span>厂房与分区</span><small id="layer-areas">—</small><input id="show-areas" type="checkbox" checked aria-label="显示厂房与分区"></label>
      <label class="update-row"><input id="updates" type="checkbox"><span>模拟设备状态更新<small>每秒更新最多 512 个已加载点</small></span></label>
      <div class="control-footer"><span class="small-signal"></span><p>数据逐批进入，地图持续响应。<br><span>合成演示 · 非真实工业资产</span></p></div>
    </aside>
    <main class="main-panel">
      <div class="view-heading"><div><span class="eyebrow">INDUSTRIAL SPATIAL STREAM</span><h1>看见数据的流动<span> / Live workspace</span></h1></div><div class="connection"><i></i>离线 WebGL 验证</div></div>
      <div class="metric-strip">
        <div><span>已绘制设备点</span><strong id="points-value">0</strong><small id="progress-caption">等待数据流</small></div>
        <div><span>首批数据绘制</span><strong id="first-value">—<em>ms</em></strong><small>请求发起 → 首次绘制调用</small></div>
        <div><span>当前帧率</span><strong id="fps-value">—<em>FPS</em></strong><small>最近 60 帧 · requestAnimationFrame</small></div>
        <div><span>GPU Buffer 分配</span><strong id="gpu-value">0<em>MB</em></strong><small>图层分配量 · 非系统显存</small></div>
      </div>
      <section class="map-stage" aria-label="可交互的合成工业园区地图">
        <div class="stage-grid"></div>
        <canvas id="map-canvas" aria-label="拖动平移，滚轮缩放，Shift 拖动旋转" tabindex="0"></canvas>
        <div class="map-labels" id="map-labels"><span data-x="-0.62" data-y="0.48">装备制造区<span>MANUFACTURING</span></span><span data-x="0.34" data-y="0.48">精密加工区<span>PRECISION</span></span><span data-x="-0.62" data-y="-0.45">能源与仓储<span>ENERGY & STORAGE</span></span><span data-x="0.45" data-y="-0.45">物流与调度<span>LOGISTICS</span></span></div>
        <div class="map-topline"><span class="stage-tag"><span class="small-signal"></span>合成园区 / SYNTHETIC SITE</span><span class="stage-tag muted">点 · 线 · 面 / WebGL</span></div>
        <div class="map-empty" id="map-empty"><span class="empty-graphic">${icons.layers}</span><h3>让第一批数据先到达</h3><p>选择数据规模，开始观察渐进绘制。<br>无需等待整个数据集下载完成。</p><button id="empty-start">开始实验 ${icons.arrow}</button></div>
        <div id="error-notice" class="error-notice" role="alert" hidden></div>
        <div class="map-tools"><button id="zoom-in" aria-label="放大">+</button><button id="zoom-out" aria-label="缩小">−</button><span></span><button id="rotate" aria-label="旋转视图">↻</button><button id="fit" aria-label="恢复视图">${icon('<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="3"/>', 17)}</button></div>
        <div class="map-legend"><span><i class="legend-dot green"></i>正常</span><span><i class="legend-dot amber"></i>关注</span><span><i class="legend-dot coral"></i>异常</span></div>
        <div class="map-hint">拖动平移 <b>·</b> 滚轮缩放 <b>·</b> Shift 拖动旋转</div>
        <div class="coordinate-tag">LOCAL PLANE <span>−1 / +1</span></div>
      </section>
      <section class="timeline"><div class="timeline-top"><span><i class="small-signal"></i>数据处理进度</span><strong id="status-label" role="status" aria-live="polite">等待开始</strong><span id="elapsed">00:00.0</span></div><div class="progress-track"><div id="progress-bar"></div></div><div class="timeline-bottom"><span id="loaded-caption">下载 0 MB</span><span id="batch-caption">队列 0 / 2</span><span id="complete-caption">可取消 · 可恢复 · 增量显示</span></div></section>
    </main>
    <aside class="telemetry panel">
      <div class="section-head"><span class="eyebrow">OBSERVABILITY</span><span class="live-tag"><i></i>LIVE</span></div>
      <h2>渲染观测</h2><p class="muted">每个数字来自当前运行。</p>
      <div class="spark-card"><div><span>帧时间 / ms</span><strong id="frame-p95">—</strong></div><canvas id="sparkline" width="420" height="140" aria-label="最近帧时间走势"></canvas><div class="spark-labels"><span>最近 120 帧</span><span>P95</span></div></div>
      <dl class="stat-list"><div><dt>帧时间 P99</dt><dd id="frame-p99">—</dd></div><div><dt>主线程长任务</dt><dd id="long-tasks">0</dd></div><div><dt>绘制调用 / 帧</dt><dd id="drawcalls">0</dd></div><div><dt>累计上传</dt><dd id="upload-bytes">0 MB</dd></div><div><dt>解析耗时</dt><dd id="parse-time">—</dd></div><div><dt>CPU 提交耗时</dt><dd id="upload-time">—</dd></div><div><dt>JS 堆占用</dt><dd id="heap">不可用</dd></div></dl>
      <div class="rule"></div>
      <div class="section-head"><span class="eyebrow">STREAM PIPELINE</span><span class="tiny-number">4 STAGES</span></div>
      <ol class="pipeline"><li><i>01</i><div><strong>获取数据流</strong><span id="pipe-fetch">Fetch ReadableStream</span></div><b id="fetch-state">待命</b></li><li><i>02</i><div><strong>增量解析</strong><span id="pipe-parse">Worker / TypedArray</span></div><b id="parse-state">待命</b></li><li><i>03</i><div><strong>有界提交</strong><span id="pipe-upload">2 批额度 / 3 ms 帧预算</span></div><b id="upload-state">待命</b></li><li><i>04</i><div><strong>GPU 批量绘制</strong><span>Buffer 页 / 点线面</span></div><b id="render-state">待命</b></li></ol>
      <div class="evidence-note"><span>证据边界</span><p>当前为独立 WebGL 验证。百度 WebGLLayer 集成待 SDK 合同与实机联调。</p><p>CPU / GPU 使用率需系统工具采集，当前不可用。</p></div>
    </aside>
  </div>
  <footer class="footer"><span>FLOWSCAPE <b>·</b> 工业空间数据流式渲染</span><span>百度地图赛题 / 工程验证版 <b>·</b> <a href="https://github.com/yanchaomei/Baidu-JSAPI" target="_blank" rel="noopener noreferrer">OPEN SOURCE ↗</a></span></footer>
  <dialog id="map-dialog"><div class="dialog-heading"><div><span class="eyebrow">BAIDU MAPS SDK</span><h2>真实地图接入检查</h2></div><button id="dialog-close" aria-label="关闭">×</button></div><p>填写本人浏览器端 AK，并将当前来源加入 referer 白名单。AK 仅用于本次页面会话，不写入导出记录。</p><label class="field" for="ak">浏览器端 AK<input id="ak" type="password" autocomplete="off" spellcheck="false" placeholder="输入项目 AK"></label><button id="check-map" class="primary">加载基图并检查 SDK</button><p id="map-result" role="status">未接入。目标 WebGLLayer 的回调与坐标合同仍待主办方资料确认。</p><div id="baidu-preview"></div><p class="dialog-note">基图可见不代表业务图层已接通。主视图仍为明确标注的离线合成园区。</p></dialog>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const format = new Intl.NumberFormat("en-US");
const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
const milliseconds = (value: number | null, suffix = true) =>
  value === null ? "—" : `${value.toFixed(1)}${suffix ? " ms" : ""}`;
const session = new StreamSession();
const frames = new FrameMetrics();
let view: OfflineView;
let startTime = 0;
let lastUI = 0;
let lastUpdate = 0;
let updateTick = 0;
let animation = 0;
let mapDestroy: (() => void) | null = null;
let mapBusy = false;

try {
  view = new OfflineView($<HTMLCanvasElement>("map-canvas"), $("map-labels"));
} catch (error) {
  $("error-notice").hidden = false;
  $("error-notice").textContent =
    error instanceof Error ? error.message : "WebGL 初始化失败";
  $<HTMLButtonElement>("start").disabled = true;
  $<HTMLButtonElement>("empty-start").disabled = true;
  throw error;
}

function begin(
  count?: number,
  mode?: Mode,
  delay?: number,
  geometry?: { lines: number; areas: number },
) {
  if (view.lost) return;
  view.renderer.clear();
  frames.reset();
  view.fit();
  $<HTMLInputElement>("updates").checked = false;
  lastUpdate = 0;
  updateTick = 0;
  startTime = performance.now();
  const selected = $<HTMLSelectElement>("profile").value;
  session.start(
    count ?? Number($<HTMLSelectElement>("count").value),
    mode ?? ($<HTMLSelectElement>("mode").value as Mode),
    delay ?? Number($<HTMLSelectElement>("delay").value),
    geometry ??
      (selected === "mixed"
        ? { lines: 100000, areas: 10000 }
        : { lines: 89, areas: 40 }),
  );
  $("map-empty").hidden = true;
  updateUI();
}

function clear() {
  session.reset();
  view.renderer.clear();
  frames.reset();
  startTime = 0;
  $<HTMLInputElement>("updates").checked = false;
  $("map-empty").hidden = false;
  updateUI();
}

const heapUsage = () =>
  (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize ?? null;
function snapshot() {
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    evidence: {
      scene: "synthetic-local-plane",
      baiduWebGLLayerAccepted: false,
      firstDrawIsPresentationTime: false,
      cpuUtilization: null,
      gpuUtilization: null,
    },
    data: {
      seed: 42,
      batch: 4096,
      format: "BGS1",
      requestedPoints: session.stats().target,
      requestedLines: session.stats().lineTarget,
      requestedAreas: session.stats().areaTarget,
      batchDelayMs: session.stats().delay,
    },
    session: session.stats(),
    render: view.renderer.stats(),
    frames: frames.snapshot(),
    environment: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      webgl: view.deviceInfo(),
      jsHeapBytes: heapUsage(),
      visibility: document.visibilityState,
    },
  };
}

const progress = () => ({
  session: session.stats(),
  render: view.renderer.stats(),
});
declare global {
  interface Window {
    __flow: {
      snapshot: typeof snapshot;
      progress: typeof progress;
      start: typeof begin;
      clear: typeof clear;
      observe: () => void;
      interact: (elapsedMs: number) => void;
    };
  }
}
window.__flow = {
  snapshot,
  progress,
  start: begin,
  clear,
  observe() {
    frames.reset();
    view.fit();
  },
  interact(elapsedMs) {
    view.cameraAt(elapsedMs);
  },
};

function sparkline(values: number[]) {
  const canvas = $<HTMLCanvasElement>("sparkline");
  const context = canvas.getContext("2d")!;
  const width = canvas.width,
    height = canvas.height;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#203043";
  context.lineWidth = 1;
  for (let y = 20; y < height; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  if (values.length < 2) return;
  const max = Math.max(33.4, ...values);
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#43d4ab40");
  gradient.addColorStop(1, "#43d4ab00");
  context.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * width,
      y = height - 8 - (v / max) * (height - 16);
    if (!i) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.strokeStyle = "#67dfbd";
  context.lineWidth = 2;
  context.stroke();
  context.lineTo(width, height);
  context.lineTo(0, height);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
}

function updateUI() {
  const s = session.stats(),
    r = view.renderer.stats(),
    f = frames.snapshot();
  $("points-value").textContent = format.format(r.points);
  $("progress-caption").textContent = s.target
    ? `${((r.points / s.target) * 100).toFixed(1)}% / 目标 ${format.format(s.target)}`
    : "等待数据流";
  $("first-value").innerHTML =
    `${s.firstDrawMs === null ? "—" : s.firstDrawMs.toFixed(0)}<em>ms</em>`;
  $("fps-value").innerHTML =
    `${f.fps === null ? "—" : f.fps.toFixed(0)}<em>FPS</em>`;
  $("gpu-value").innerHTML = `${mb(r.gpuBytes)}<em>MB</em>`;
  $("layer-points").textContent = format.format(r.points);
  $("layer-lines").textContent = format.format(r.lines);
  $("layer-areas").textContent = format.format(r.areas);
  $("frame-p95").textContent = milliseconds(f.p95Ms, false);
  $("frame-p99").textContent = milliseconds(f.p99Ms);
  $("long-tasks").textContent =
    f.longTasks === null ? "不可用" : `${f.longTasks} 次`;
  $("drawcalls").textContent = String(r.drawCalls);
  $("upload-bytes").textContent = `${mb(r.uploadedBytes)} MB`;
  $("parse-time").textContent = milliseconds(s.target ? s.parseMs : null);
  $("upload-time").textContent = milliseconds(s.target ? s.uploadMs : null);
  const heap = heapUsage();
  $("heap").textContent = heap === null ? "不可用" : `${mb(heap)} MB`;
  const statuses = {
    idle: "等待开始",
    loading: "持续加载中",
    paused: "已暂停",
    complete: "加载完成",
    cancelled: "已取消",
    error: "加载异常",
  };
  $("status-label").textContent = statuses[s.status];
  $("status-label").dataset.state = s.status;
  const elapsed = startTime
    ? (s.completeMs ?? performance.now() - startTime)
    : 0;
  $("elapsed").textContent =
    `${String(Math.floor(elapsed / 60000)).padStart(2, "0")}:${((elapsed / 1000) % 60).toFixed(1).padStart(4, "0")}`;
  const totalTarget = s.target + s.lineTarget + s.areaTarget;
  $("progress-bar").style.width =
    `${totalTarget ? Math.min(100, ((r.points + r.lines + r.areas) / totalTarget) * 100) : 0}%`;
  $("loaded-caption").textContent = `下载 ${mb(s.bytes)} MB`;
  $("batch-caption").textContent = `队列 ${s.queue} / 2 · 峰值 ${s.queuePeak}`;
  $("complete-caption").textContent =
    s.streamConsumedMs === null
      ? "数据流未读完"
      : `读取结束 ${s.streamConsumedMs.toFixed(0)} ms`;
  $<HTMLButtonElement>("pause").disabled = !["loading", "paused"].includes(
    s.status,
  );
  $("pause").innerHTML =
    `${s.status === "paused" ? icons.play : icons.pause}<span>${s.status === "paused" ? "继续" : "暂停"}</span>`;
  $<HTMLButtonElement>("cancel").disabled = !["loading", "paused"].includes(
    s.status,
  );
  $("start").innerHTML =
    `${icons.play}<span>${s.status === "idle" ? "开始流式加载" : "重新加载"}</span>${icons.arrow}`;
  $("pipe-fetch").textContent = s.bytes
    ? `${mb(s.bytes)} MB 已接收`
    : "Fetch ReadableStream";
  $("pipe-parse").textContent = s.target
    ? `${format.format(s.parsed)} 要素 / ${s.mode.startsWith("worker") ? "Worker" : "主线程"}`
    : "Worker / TypedArray";
  $("pipe-upload").textContent =
    s.mode === "worker" ? "2 批额度 / 3 ms 帧预算" : "分块提交 / 无帧预算";
  $("fetch-state").textContent =
    s.streamConsumedMs !== null
      ? "完成"
      : s.status === "loading"
        ? "流入"
        : "待命";
  $("parse-state").textContent = s.parsed ? "已解析" : "待命";
  $("upload-state").textContent = s.submitted ? "已提交" : "待命";
  $("render-state").textContent = r.points ? "绘制中" : "待命";
  $("error-notice").hidden = !s.error && !view.lost;
  $("error-notice").textContent = view.lost
    ? "WebGL 上下文丢失，数据加载已取消。恢复后请重新加载。"
    : s.error;
  sparkline(f.frameTimesMs.slice(-120));
}

function frame(now: number) {
  if (!view.lost) {
    session.consume(view.renderer);
    if ($<HTMLInputElement>("updates").checked && now - lastUpdate >= 1000) {
      view.renderer.updateDevices(++updateTick);
      lastUpdate = now;
    }
    view.draw();
    if (view.renderer.stats().drawCalls > 0) session.drew();
  }
  frames.tick(now);
  if (now - lastUI > 250) {
    updateUI();
    lastUI = now;
  }
  animation = requestAnimationFrame(frame);
}
animation = requestAnimationFrame(frame);

$("start").onclick = () => begin();
$("empty-start").onclick = () => begin();
$("pause").onclick = () => {
  if (session.stats().status === "paused") session.resume();
  else session.pause();
  updateUI();
};
$("cancel").onclick = () => {
  session.cancel();
  updateUI();
};
$("clear").onclick = clear;
$("zoom-in").onclick = () => view.zoomBy(1.25);
$("zoom-out").onclick = () => view.zoomBy(0.8);
$("rotate").onclick = () => view.rotateBy(Math.PI / 12);
$("fit").onclick = () => view.fit();
for (const name of ["points", "lines", "areas"] as const) {
  $<HTMLInputElement>(`show-${name}`).onchange = (event) => {
    view.renderer.visibility[name] = (event.target as HTMLInputElement).checked;
  };
}
$("export").onclick = () => {
  const blob = new Blob([JSON.stringify(snapshot(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `flowscape-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const dialog = $<HTMLDialogElement>("map-dialog");
$("map-config").onclick = () => dialog.showModal();
function closeDialog() {
  dialog.close();
  mapDestroy?.();
  mapDestroy = null;
  $("baidu-preview").replaceChildren();
  $<HTMLInputElement>("ak").value = "";
}
$("dialog-close").onclick = closeDialog;
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
$("check-map").onclick = async () => {
  if (mapBusy) return;
  mapBusy = true;
  $<HTMLButtonElement>("check-map").disabled = true;
  $("map-result").textContent = "正在加载本人授权的 SDK…";
  try {
    mapDestroy?.();
    const result = await checkBaidu(
      $<HTMLInputElement>("ak").value.trim(),
      $("baidu-preview"),
    );
    if (!dialog.open) {
      result.map.destroy();
      return;
    }
    mapDestroy = () => result.map.destroy();
    $("map-result").textContent = result.status;
  } catch (error) {
    $("map-result").textContent =
      error instanceof Error ? error.message : "地图接入检查失败";
  } finally {
    mapBusy = false;
    $<HTMLButtonElement>("check-map").disabled = false;
  }
};
view.onContextLost = () => {
  session.cancel();
  updateUI();
};
view.onContextRestored = () => {
  session.reset();
  $<HTMLInputElement>("updates").checked = false;
  $("map-empty").hidden = false;
  updateUI();
};
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  cancelAnimationFrame(animation);
  session.dispose();
  frames.dispose();
  view.dispose();
  mapDestroy?.();
});
updateUI();
