# 百度地图 WebGLLayer 官方接口核验

核验日期：2026-10-12（Asia/Shanghai）。本文区分公开合同、官方交付源码观察与尚未验证的比赛扩展。没有使用第三方或官方示例中的真实 AK，也没有进行带有效 AK 的地图渲染验收。

## 结论与实现边界

**目前不能依据公开资料宣称已接通 `BMapGL.WebGLLayer`。** 官方 GL 类参考未列出此公开类；本次下载的官方 GL 1.0 SDK 包含一个名为 `WebGLLayer` 的内部基类，但没有将其导出为 `BMapGL.WebGLLayer`。源码存在内部类不等于用户可以依赖它。带比赛权限的 AK、指定 SDK 或附件是否提供该公开扩展，仍待核验。

`onInitialize`、`onRender(gl, matrix)`、`getCustomLayerTransformMatrix` 不能视为已经证实的百度 `WebGLLayer` 合同。本次取得的 SDK 没有 `onInitialize` 或 `getCustomLayerTransformMatrix` 符号；内部基类使用 `onAdd`、`render` 等方法覆盖方式。不能照搬 Mapbox、Azure Maps 或其他地图产品的接口。[官方 SDK 入口](https://api.map.baidu.com/api?v=1.0&type=webgl)、[官方 GL 类参考](https://lbsyun.baidu.com/cms/jsapi/reference/jsapi_webgl_1_0.html)。

官方 JSAPI 4.0 文档提供的是 **`BMap.WebGLCustomLayer`**。这是另一个公开接口，不能自动等同赛题所称 `WebGLLayer`，也不能把在它上面的验收算成 `BMapGL.WebGLLayer` 验收。赛题扩展合同未闭合时，共享 GPU 内核和流式处理链路可以在明确标记的离线模式中开发；实际百度图层集成应保留阻断状态。[官方 4.0 类参考](https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.WebGLCustomLayer.html)。

## 最小可实施合同

| 项目 | 本次核验结果 | 实施决定 |
| --- | --- | --- |
| GL 基图入口 | 官方示例使用 `https://api.map.baidu.com/api?v=1.0&type=webgl&ak=…`，命名空间 `BMapGL` | 只装载用户本人配置的浏览器端 AK |
| 初始化地图 | `new BMapGL.Map(container)` 后调用 `centerAndZoom(point, zoom)` | 容器先挂入 DOM，尺寸非零，再初始化 |
| 赛题层构造函数 | 未获得公开 `BMapGL.WebGLLayer` 文档或完整官方样例 | 检测实际 SDK 能力；缺失时显示明确状态，不能假造同名类 |
| 初始化 / 渲染回调 | 未证实 `onInitialize/onRender` 参数和 `this` 绑定 | 获取比赛 SDK 合同后单独实现适配器 |
| 坐标 / matrix | GL 地图有公开 `lnglatToMercator`；赛题层 matrix 语义未知 | 不把标准 EPSG:3857 公式或其他 SDK matrix 直接用于百度 |
| 图层添加 / 移除 | 覆盖物的 `addOverlay/removeOverlay` 已公开；不代表适用于目标类 | 赛题图层的挂载方式保持待核验 |
| 生命周期 | 地图有 `destroy()`；目标图层销毁、context restore 行为未知 | 核心模块自行维护资源所有权，适配器待合同闭合 |

基图初始化来自 [官方 Hello World](https://lbsyun.baidu.com/docs/jsapi?title=jspopularGL/guide/helloworld)。地图投影和生命周期来自 [官方 GL 类参考](https://lbsyun.baidu.com/cms/jsapi/reference/jsapi_webgl_1_0.html)。表中的实施决定是本项目的工程选择，不是百度 API 承诺。

下面是依据公开基图合同编写的最小检查页面。它只验证地图入口与目标构造函数是否可见，**不会把“构造函数存在”当作自定义图层已绘制**。

```html
<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>百度 SDK 能力检查</title>
<style>html,body,#map{height:100%;margin:0}#status{position:fixed;top:0;background:white;z-index:1}</style>
<div id="map"></div><output id="status"></output>
<!-- 用本人浏览器端 AK 替换占位符，并配置当前来源的 referer 白名单。 -->
<script src="https://api.map.baidu.com/api?v=1.0&type=webgl&ak=YOUR_BROWSER_AK"></script>
<script>
  const sdk = window.BMapGL;
  const status = document.querySelector('#status');
  if (!sdk || typeof sdk.Map !== 'function') {
    status.textContent = 'SDK 未就绪：检查网络、浏览器 AK 与来源权限';
  } else {
    const map = new sdk.Map('map');
    map.centerAndZoom(new sdk.Point(121.50, 31.25), 14);
    map.enableScrollWheelZoom();
    status.textContent = typeof sdk.WebGLLayer === 'function'
      ? '目标构造函数可见；回调、坐标、绘制与生命周期仍待验收'
      : '当前 SDK 未导出 BMapGL.WebGLLayer';
    window.addEventListener('pagehide', () => map.destroy(), {once:true});
  }
</script>
</html>
```

## 官方交付源码观察记录

本节只记录本次返回内容，不将内部符号作为稳定 API。入口不携带 AK，能够取得 JavaScript 并不证明服务鉴权通过，也不证明真实地图可用。

| 证据 | URL / 内容摘要 |
| --- | --- |
| SDK 引导脚本 | [GL 1.0 入口](https://api.map.baidu.com/api?v=1.0&type=webgl)，2026-10-12 返回 `getscript` 版本标记 `20261008104535` |
| SDK 主体 | [本次 getscript URL](https://api.map.baidu.com/getscript?type=webgl&v=1.0&ak=&services=&t=20261008104535)，解码后 1,127,486 个字符；UTF-8 SHA-256：`261382008fd29230f42038bb9819586568c4d12c31388cc912f0d6f9f9d9388d` |
| 异步视觉模块 | [模块 URL](https://api.map.baidu.com/getmodules?v=1.0&type=webgl&mod=visual_cv434z)，解码后 115,692 个字符；UTF-8 SHA-256：`f100ea73491550cc346f1eda65cb66bc149c1fd490db39228073927849ae49a4` |

主脚本中的内部基类读取 `visible`、`opacity`、`zIndex`、`minZoom`、`maxZoom`、`referCenter`、`renderStage`，没有把 `onInitialize/onRender` 配置复制为回调。其原型列出以下方法形态：

```text
onAdd(map, gl)
preRender(arg0, arg1)
render(arg0, arg1)
afterRender(arg0, arg1)
onShow(map, gl)
onHide(map, gl)
onDestroy(map, gl)
getMVPMatrix()
triggerRepaint()
addTo(map) / remove()
```

内部 attach 逻辑等待模块与 GL 就绪后调用 `onAdd(map, gl)`。内部视觉层 manager 通过 `map.addLayer/removeLayer` 接入，并在移除时调用 `onDestroy(map, gl)`。但公共导出区没有 `WebGLLayer`；`WebGLCustomLayer` 只在 API 版本为非 GL 时导出。本次未完整核实内部 `render` 调用处的参数语义，所以保留 `arg0/arg1`，不推断它就是标准 clip-space matrix。

以上均来自前述两个官方源码 URL。不要从原型链取内部构造函数、访问私有 painter，或手工设置 `isWebGLLayer` 来绕过公开接口缺口。

## 坐标、精度与共享 GL 状态

官方 GL 坐标说明区分 `bd09ll` 与 `bd09mc`；国内业务数据不能把 WGS84、GCJ02、BD09 当作同一坐标。官方要求其他坐标使用官方转换能力。本项目的合成数据必须标记为合成 BD09 场景数据，真实工业数据需保留来源坐标系和转换记录。[官方坐标说明](https://lbsyun.baidu.com/docs/jsapi?title=jspopularGL/guide/coorinfo)。

公开 GL `map.lnglatToMercator(lng, lat)` 是可用投影接口，但不能据此确认目标层采用绝对墨卡托、参考中心偏移、标准 Web Mercator 归一化或其他空间。Worker 端自建标准墨卡托只能用于离线场景，不能标为真实百度坐标对齐。[官方 Map 类参考](https://lbsyun.baidu.com/cms/jsapi/reference/jsapi_webgl_1_0.html)。

另一个公开接口 `BMap.WebGLCustomLayer` 使用相对 `referCenter` 的局部百度墨卡托米和 `u_mvpMatrix`。官方提醒 float32 的约 `1e7` 绝对坐标会损失精度，并要求通过 `renderState` 设置深度、混合、剔除，以免与底图状态缓存冲突。它的 `onRender(ctx)` 接收绘制上下文；`unsafeGL` 属于显式高风险入口。这些结论只适用于该 4.0 接口，不能外推为赛题层合同。[官方 WebGLCustomLayer 文档](https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.WebGLCustomLayer.html)、[官方 CustomRenderContext 文档](https://lbs.baidu.com/jsapi/refdoc/v4/interfaces/BMap.CustomRenderContext.html)。

GPU 内核可据此采用局部坐标、明确的输入 matrix、增量 buffer 和自有资源释放；百度适配器还需实测平移、缩放、旋转、倾斜下的坐标对齐、前后 GL 状态及 context 丢失恢复。

## AK、HTTPS 与验收条件

JSAPI 需要**浏览器端 AK**，官方要求配置 referer 白名单。普通 Web 服务端 AK 不能当作浏览器 AK 使用。公开仓库只提交占位符和配置说明；不要复制官方 Demo 的真实 AK。当前来源和正式域名都需由 AK 所有者配置白名单。[官方账号和获取密钥说明](https://lbsyun.baidu.com/docs/jsapi?title=193)。

官方 GL 服务介绍说明支持 HTTP 和 HTTPS；因此不能宣称百度基图本身强制 HTTPS。此项目应统一使用 HTTPS SDK URL，部署时使用 HTTPS，避免混合内容与浏览器能力差异。离线实验中的本地来源和远程正式来源要分开记录。[官方服务介绍](https://lbsyun.baidu.com/docs/jsapi?title=jspopularGL/index)。

目标集成验收至少需要：

1. 本人授权 AK、来源白名单、准确 SDK URL / 版本与公开 `WebGLLayer` 文档或主办方完整样例。
2. 在真实 SDK 上记录构造配置、回调实际参数、初始化时机、坐标与 matrix 语义、重绘入口、添加移除及恢复流程。
3. 点、线、面在已知坐标上正确显示，并通过地图平移、缩放、旋转、倾斜检查。
4. 持续增量上传时底图文字、POI、覆盖物不被破坏；移除、重新添加、销毁与 context restore 后资源可回收。
5. 性能报告记录真实百度模式及离线模式，二者结果分开，未授权或能力缺失必须为未验收状态。

## 检索范围与负结果

- Context7：已解析 `/websites/lbsyun_baidu_jsapi` 并查询目标构造、回调、matrix；只得到入口级资料，没有目标接口合同。
- 官方 GL 类参考全文、GL 示例中心、GL 升级说明与实际官方 SDK：未取得可直接运行的公开 `BMapGL.WebGLLayer` 完整样例。
- 官方 4.0 类参考：取得 `BMap.WebGLCustomLayer` 的构造、渲染和局部坐标合同；与目标类保持区分。
- 官方 getscript / visual 模块：找到内部基类与视觉流水线，但公共导出缺口未闭合。
- 未取得主办方专用 SDK 附件；以上负结果不证明比赛扩展不存在，也不证明带权限 AK 与本次无 AK 返回内容完全一致。

完整官方基图样例可见 [Hello World](https://lbsyun.baidu.com/docs/jsapi?title=jspopularGL/guide/helloworld)；4.0 着色器样例可见 [WebGLCustomLayer](https://lbs.baidu.com/jsapi/refdoc/v4/classes/BMap.WebGLCustomLayer.html)。目标 `BMapGL.WebGLLayer` 样例仍缺失。

## 主办方公开资料追加核验（2026-10-12）

本轮已取得主办方正式**赛题任务书 PDF**，补足了上节“未取得主办方附件”的检索范围；**该附件不是 SDK 或接口文档**，目标 API 合同仍未闭合。以下链接均由官方网页已引用的脚本、公开内容记录或正文链接定位，没有猜测比赛包地址。

| 资料 | 已核实的链接与范围 |
| --- | --- |
| 大赛官网 | [2026 上海开源软件应用创新大赛](https://www.oschina.net/os2026/)，官方动态赛题列表包含目标命题 |
| 目标赛题 PDF | [百度地图海量空间数据流式高性能渲染技术任务书](https://apiv1.oschina.net/api/files/fhhc7e8z6no3gyt/l6b4luq8g5y7v3y/ai_jsapi_xxcl7CJCuY.pdf)，2026-10-12 实际下载，282,037 字节、3 页 |
| 命题公告 | [从导航工具到 AI 基础设施，上海开源大赛百度地图命题公布](https://www.oschina.net/news/502131)，正文可通过官网前端调用的公开只读接口取得 |
| 会务咨询 | [官网“合作与咨询”](https://www.oschina.net/os2026/#contact) 公布赛事会务邮箱 `oscc@oschina.cn`；它是会务入口，未标为百度技术支持邮箱 |

PDF 的 SHA-256 为 `b0ee738297c3acdc68d04148bbee8f3389a86f192e0c6b00a76d8c6c8f7d2866`。已提取全部 3 页文本、检查 PDF 链接注释与嵌入附件，并查看第 3 页渲染。任务书内容与本项目收到的赛题说明一致：第 1 页说明背景和目标，第 2 页列出交付物和性能指标，第 3 页给出四项评分标准。**没有 SDK 下载地址、构造参数、回调签名、矩阵语义、代码样例、技术支持群或嵌入文件；3 页均无 URI 链接注释，嵌入附件为空。**[任务书 PDF](https://apiv1.oschina.net/api/files/fhhc7e8z6no3gyt/l6b4luq8g5y7v3y/ai_jsapi_xxcl7CJCuY.pdf)。

命题公告介绍两道赛题，重申 `WebGLLayer` 与流式渲染目标，但正文外链只有大赛官网和两张配图，没有目标 SDK、接口文档或代码仓库链接。公告的历史赛事日期与当前官网可能不一致，本文不采用公告日期作为当前提交安排。[官方命题公告](https://www.oschina.net/news/502131)。

可复核的公开数据来源：

- 官网入口引用 [主应用脚本](https://www.oschina.net/os2026/assets/index-4a6974b5.js)，其 `corporateTopics` 数据来源为 [公开赛题记录](https://apiv1.oschina.net/api/collections/ai2026_corporate_topics/records?page=1&perPage=50&sort=sort)。目标记录 ID 为 `l6b4luq8g5y7v3y`，`pdf` 字段为 `ai_jsapi_xxcl7CJCuY.pdf`；该记录没有额外 SDK 附件字段。
- 命题新闻的官方前端通过 [公开新闻详情接口](https://apiv1.oschina.net/oschinapi/new/detail?id=502131) 读取正文，本轮返回 `success: true`。接口路径依据该新闻页面所引用的前端脚本确定。
- 官网 [公开配置记录](https://apiv1.oschina.net/api/collections/ai2026_config/records?page=1&perPage=100&sort=key) 有一张文件名含 `os2026_assistant_qr` 的 [微信二维码图片](https://apiv1.oschina.net/api/files/lf52jd3w1lt1esz/i22ngjg1nai1swp/os2026_assistant_qr_lhf6VDPcx3.jpg)。已查看图片，但记录名称仅为“上海邮箱内图片”，没有标注百度技术支持、WebGLLayer 资料群或群用途。因此**不能把它认定为技术支持群入口**；未扫码、未加好友、未联系任何人。

HTTP 读取这些公开 API 和 PDF 时使用了正常的浏览器 `Accept`、`Origin: https://www.oschina.net` 与 `Referer: https://www.oschina.net/` 请求头。缺少请求头的首次读取返回 404 HTML；该失败不能当作附件不存在。用户可优先从大赛官网点击赛题标题进入任务书。

据本轮已核实资料，下一步需要向官方取得的具体信息为：

1. 赛题所称 `WebGLLayer` 对应哪个 JSAPI 版本、公开类名及官方装载 URL。
2. 是否需比赛专用 SDK、AK 白名单权限或灰度版本，以及本人浏览器 AK 的开通方式。
3. 可运行的最小官方样例，明确构造、初始化、逐帧绘制、重绘、移除和销毁方法。
4. 业务坐标系、参考中心、渲染 matrix 和共享 GL 状态约定。
5. 赛题技术答疑入口，以及是否认可当前公开 4.0 自定义图层作为指定扩展的正式接口。

这些是资料缺口清单，不代表已经联系官方或获得认可。当前未发现公开 SDK 技术附件，普通地图 AK 的申请配置与比赛扩展合同核验应分别跟踪。
