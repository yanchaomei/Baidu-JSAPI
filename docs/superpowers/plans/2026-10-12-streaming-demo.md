# 流式工业园区 Demo 实现计划

> 面向 AI 代理：在当前会话按模块执行，独立调研与数据协议任务使用子代理，根代理负责集成与验收。用户已授权持续推进。

**目标：** 交付可运行的流式点线面演示、真实控制与观测，以及可复现对照；百度地图接入保留明确证据门槛。

**架构：** 数据服务输出版本化二进制帧，Worker 增量解析并通过额度控制传输；主线程按帧预算写入 GPU 页，使用共享渲染器绘制点、线和面。

**技术栈：** TypeScript、Vite、Node HTTP、Web Worker、WebGL、Node 测试、Playwright。

## 1. 官方接口与环境

- [x] `docs/research/webgllayer.md` 保存官方合同、来源和未核实点。
- [x] 使用远程目录 `/home/kvgroup/chaomei/baidu-jsapi`；优先选空闲空间充足的 SKV 节点；Node 运行时置于自己的目录。
- [x] `package.json`、`tsconfig.json`、`vite.config.ts`、`index.html` 提供明确启动和构建入口。

## 2. 数据协议与服务

- [x] 创建 `src/data/protocol.ts`、`server/generator.mjs`、`server/stream.mjs`。
- [x] 先写 `tests/protocol.test.ts`，覆盖跨字节切分、混合类型、坏帧与截断；远程运行并保存失败证据后实现。
- [x] HTTP 流用 `res.write()` 的返回值与 `drain` 控制背压，关闭连接即退出生成。
- [x] 相同参数产生相同字节，限制规模与批大小，非法参数返回 400。

## 3. Worker 会话与 GPU

- [x] `src/stream/worker.ts`、`src/stream/session.ts`：处理暂停、恢复、取消、过期运行和提交额度。
- [x] `src/render/renderer.ts`：按页分配 Buffer，`bufferSubData` 增量上传；点、线、面共享顶点布局。
- [x] `src/render/offline.ts`：合成园区平面视图与缩放、平移、旋转；明确离线标识。
- [x] `src/map/baidu.ts`：凭据输入与 capability gate，只有已核实的适配器才能标为接入。

## 4. 场景界面与观测

- [x] `src/main.ts`、`src/style.css`：工业控制台、规模与模式切换、加载控制、图例、状态更新。
- [x] `src/metrics.ts`：阶段时间、帧时间分位数、长任务、队列峰值、GPU 分配及上传字节；导出真实 JSON。
- [x] 页面异常显示具体阶段，恢复操作不累积资源或继续接收旧运行数据。

## 5. 验证与交付

- [x] 远程运行 `npm test`、`npm run build`，确认原始输出。
- [x] 远程浏览器验证增量绘制、控制操作、截图与资源释放，保留 WebGL renderer 信息。
- [x] 至少 5 次重复测试全量、主线程分块和 Worker 流式模式，固定数据和视角。
- [x] 更新 README、路线图、运行指南和实测报告，清楚标注百度地图、CPU/GPU 利用率、目标设备验证缺口。
- [x] 规格与质量审查完成，发现的问题已修复并重验。
- [x] 推送并创建 [PR #1](https://github.com/yanchaomei/Baidu-JSAPI/pull/1)。

## 实施边界

独立 WebGL 和 NVIDIA A40 已验证，真实百度 WebGLLayer 仍待本人开发者认证与主办方 SDK 合同；不能把本计划的工程阶段完成当作赛事全部验收。
