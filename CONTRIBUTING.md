# 贡献指南

欢迎通过 Issue 讨论需求、缺陷、测试方法和性能结果，通过 Pull Request 提交改进。

## 开发原则

- 优先完成百度地图 JSAPI WebGLLayer 集成和流式渲染核心链路。
- 技术决策服务于 [项目故事线](docs/story.md) 与 [验收要求](docs/requirements.md)。
- 新增优化应说明对应瓶颈、对照方案与验证方法。
- 性能结论附环境、数据规模、几何复杂度、原始记录和复现步骤。
- 公开数据应注明来源和许可；合成数据保留生成参数。
- 不提交真实凭据、本地配置和大型业务数据集。可审计的合成测试记录保存在 `benchmarks/results/`，临时轨迹留在被忽略的 `artifacts/`。

## 提交规范

使用有意义的 Conventional Commits，说明变更内容与动机，例如：

```text
docs(项目): 补充流式渲染验收与性能对照计划
feat(流式处理): 添加可取消的分块解析链路
perf(渲染): 复用点图层 Buffer 以降低增量上传开销
```

功能或行为变更应提供适当验证。仅有文档变更时检查内容、链接和状态描述。

开发与复现步骤见 [运行指南](docs/guide.md)。提交前至少通过 `npm test` 和 `npm run build`；修改 Worker、会话、GPU 或交互行为时运行 `npm run test:browser`。性能结论附逐次原始值，保留强基线和负结果。
