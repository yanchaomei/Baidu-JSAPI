# 合成园区二进制协议 v1

HTTP 路径：`/api/stream?count=100000&seed=42&batch=4096&delay=8&lines=89&areas=40`。参数均为整数，count 范围 1–2000000，lines 范围 1–200000（默认 89），areas 范围 1–100000（默认 40），seed 范围 0–4294967295，batch 范围 32–16384，delay 范围 0–1000 ms。非法、未知或重复参数返回 400。count 仅指点，同参数字节必须一致。

每帧头 24 字节，小端序：magic(u32, 0x42534731)、version(u16, 1)、kind(u16, 1/2/3)、frameBytes(u32)、featureCount(u32)、vertexCount(u32)、sequence(u32)。kind=1 点、2 独立线段、3 三角化矩形面。每点一个顶点，每线段两个顶点，每面六个顶点。

每顶点 7 个 Float32：x、y、r、g、b、a、size。坐标为固定园区局部平面 [-1,1]，颜色通道 [0,1]，size 为正数。园区坐标绝不是经纬度。帧不超过 8 MiB，序号从零连续递增，帧内数量和长度必须完全一致。网络分片可以切断任何头或顶点。

公开解码接口：`new FrameDecoder()`，`frames(Uint8Array): IterableIterator<GeometryBatch>`，`push(Uint8Array): GeometryBatch[]`，`finish(): void`。流式调用方先等待额度，再请求 frames 迭代器的下一帧；push 全量返回语义专供全量基线。输出 `GeometryBatch={kind:1|2|3, sequence:number, featureCount:number, vertices:Float32Array}`。常量导出 `HEADER_BYTES=24`、`STRIDE_FLOATS=7`。非法帧抛出 Error；finish 拒绝未完成帧；空流由会话层拒绝。

生成器接口：`generateFrames({count,seed,batch,lines=89,areas=40})` 返回同步 iterable 的 Uint8Array；先产出全部区域面，再产出全部管网线，最后输出设备点。基础 40 面 / 89 线保留原数据；扩展几何按索引即时生成，不保存全量数组。数据服务接口：`streamMiddleware(req,res,next?)`；非 /api/stream 调用 next 或返回 404；连接断开停止生成，写入遇到背压等待 drain。

两批额度限制主线程待提交队列，单帧限制约束解析中的几何分配；浏览器网络缓冲和当前原始 read chunk 不等于该队列，不能声称整个浏览器内存只占两帧。

生成数据只用于性能与场景演示，不代表真实工业设施或资产位置。
