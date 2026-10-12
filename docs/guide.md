# 运行与复现指南

## 环境

需要 Node.js >=22.18、npm 和现代浏览器。服务端使用 Node 原生 TypeScript 类型剥离读取共享协议模块，不能降到旧 Node 版本直接运行。

```bash
npm ci
npm run dev
```

开发服务器默认仅绑定本机。生产启动先运行 `npm run build`，再运行 `npm start`；默认 `127.0.0.1:4173`，可用 `PORT` / `HOST` 明确指定监听地址。数据服务与页面同源。

仅部署 `dist/` 不包含 `/api/stream`，无法完成加载。生产运行需要保留 `server/`、共享协议源文件和 Node 运行时。

## 演示步骤

1. 默认使用 10 万设备点和 89 线、40 面；点击「开始流式加载」。
2. 选择 40 ms 每批间隔，观察首批绘制、已处理数量与读取进度。
3. 加载期间拖动平移、滚轮缩放，按住 Shift 拖动旋转；也可用视图工具按钮。
4. 暂停后 GPU 提交停止，继续后恢复；取消保留已绘制部分，清空释放图层 Buffer。
5. 勾选状态模拟，每秒通过真实 `bufferSubData` 改写最多 512 个已加载设备的颜色和尺寸。它是本地合成更新，不是生产传感器数据源。
6. 选择「海量混合」，加载 10 万条线与 1 万个面，独立观察点、线、面数量。
7. 切换四种处理模式重跑，最后导出当前会话 JSON。

首次绘制指标表示发出非零几何绘制命令的时间，不是显示器呈现时间。`streamConsumedMs` 表示应用读到 EOF，受暂停和背压影响，不是纯网络传输完成时间。3 ms 是批次间检查的软预算。

## 百度地图接入

点击「地图接入」可填写本人浏览器端 AK、加载公开 GL 基图并检测目标构造函数。配置值只留在会话中，不进入导出 JSON、应用地址或日志。

同一页面中的百度 SDK 无法在未核实合同的情况下安全切换 AK。如果第一次加载后换 AK，界面会要求刷新页面，避免静默使用旧凭据。

当前开发者认证需账号本人完成实名与协议步骤。AK 创建后将 `localhost`、`127.0.0.1` 和实际演示域名按平台规则加入 referer 白名单，避免使用不受限的通配来源。

主办方 [正式任务书](https://apiv1.oschina.net/api/files/fhhc7e8z6no3gyt/l6b4luq8g5y7v3y/ai_jsapi_xxcl7CJCuY.pdf) 未附 WebGLLayer 接口资料。真实接入还需主办方明确 SDK 版本、装载地址、AK 权限、回调和 matrix 语义。公开 GL 1.0 内部同名类不能作为稳定合同；详情见 [调研记录](research/webgllayer.md)。

## 自动验证

按项目约定，本地编辑和 Git 管理，远程构建、测试与基准。验证节点使用空间充足的 CPU 服务器，工作目录位于账号自己的项目目录，不修改系统配置。

维护者的实际远程执行配置保存在 `.agents/remote.local.toml`，被 Git 忽略；外部贡献者使用自己的服务器和工作目录。

```bash
npm test
npm run build
npx playwright install chromium
npm start
```

另一个终端：

```bash
npm run test:browser
npm run benchmark
SCALES=10000 LINE_COUNT=100000 AREA_COUNT=10000 ARTIFACT_DIR=artifacts/benchmark-mixed npm run benchmark
```

浏览器验证和基准均默认连接 `http://127.0.0.1:4173`，可通过 `APP_URL` 指定同源应用地址。`PLAYWRIGHT_BROWSERS_PATH` 可配置浏览器安装位置。

基准默认 3 个点规模 × 4 个模式 × 5 次重复；混合基准固定 10,000 点、100,000 线、10,000 面，4 个模式各 5 次。每次记录加载阶段，再在全部数据已提交后记录目标 2 秒的相同绝对相机轨迹；实际窗口时长一并保存。

原始数据写入 `artifacts/`（Git 忽略）。失败和中断也会保存当前参数、异常与可取的部分快照，再停止比较。正式审计数据另存入仓库的 `benchmarks/results/`。

硬件路径使用已有 GPU 驱动，不修改系统配置。依据 [Chrome 官方无头 GPU 指南](https://developer.chrome.com/blog/supercharge-web-ai-testing) 启用 Vulkan，并提供官方完整 Chromium 可执行文件：

```bash
GPU_BACKEND=hardware CHROMIUM_EXECUTABLE=/path/to/chrome SCALES=1000000 ARTIFACT_DIR=artifacts/hardware-points npm run benchmark
GPU_BACKEND=hardware CHROMIUM_EXECUTABLE=/path/to/chrome SCALES=2000000 LINE_COUNT=200000 AREA_COUNT=100000 ARTIFACT_DIR=artifacts/hardware-max npm run benchmark
GPU_BACKEND=hardware CHROMIUM_EXECUTABLE=/path/to/chrome ARTIFACT_DIR=artifacts/validation-hardware npm run test:browser
npm run test:scale
```

硬件测试需要核验原始记录中的实际 renderer。本轮为 NVIDIA A40，没有用请求硬件的启动参数替代实际能力证明。默认最大档位正确性探测仍使用软件 WebGL。

## 指标限制

- 软件 SwiftShader 验证可以证明处理与绘制链路可运行，不能作为硬件 GPU 的性能结论。
- JS 堆是可用时的快照，不是浏览器进程 RSS 峰值。
- GPU Buffer 字节是本图层分配量，不是 GPU 全部资源或系统显存占用。
- 应用自身不提供可归因的 CPU / GPU 使用率、纯网络结束时刻与实际呈现时间，导出中保持不可用；外部辅助采样另行说明。
- 报告另有 43 秒的外部资源辅助采样：只覆盖部分最大混合运行；CPU 进程出生/退出可能漏算，RSSsum 可能重复共享页，整卡 GPU 采样包含既有任务，不能归因 Chrome。
- `persisted pagehide` 事件保护检查不等于真实导航后退命中 BFCache 的完整验收。
