# 媒体与视觉审查网关协议 v1

这是本项目定义的适配协议，不是任何供应商官方 API。真实接入需要实现网关，或修改 `providers.ts` 映射至供应商端点。默认演示不需要网关。

## 提交媒体任务

`POST {MEDIA_GATEWAY_URL}/jobs`

请求头：`Authorization: Bearer <MEDIA_API_KEY>`、`Content-Type: application/json`。

```json
{
  "kind": "video",
  "model": "configured-model-id",
  "idempotencyKey": "local-job-uuid",
  "prompt": "包含设定集、分镜、运镜与起止状态的 JSON 字符串",
  "reflection": "上一轮审查意见，或 null",
  "seed": 42,
  "duration": 6,
  "aspectRatio": "16:9",
  "referenceImages": ["https://.../current-reference.png", "https://.../previous-reference.png"],
  "continuity": {
    "previousVideoUrl": "https://.../previous.mp4",
    "requestPreviousLastFrame": true,
    "camera": {
      "movement": "push", "lens": 50,
      "start": {"x": 1, "y": 1.6, "z": 5},
      "end": {"x": 1, "y": 1.6, "z": 3},
      "easing": "ease-in-out"
    }
  }
}
```

返回 `{"id":"provider-or-gateway-task-id"}`。同一个幂等键即使多次提交，也必须返回同一个任务且不得重复计费。`kind: image` 使用相同结构；有参考图时由网关选择图生图，否则选择文生图。

## 查询

`GET {MEDIA_GATEWAY_URL}/jobs/{encodeURIComponent(id)}`

```json
{"status":"running"}
```

```json
{"status":"succeeded","outputUrl":"https://media.example/clip.mp4"}
```

```json
{"status":"failed"}
```

成功 URL 必须为 HTTPS，可由用户浏览器访问。网关应处理供应商签名 URL 续期；本工作台没有自动下载缓存。停止本地队列没有远端 cancel 语义。

## 视觉质量审查

可选 `POST {QA_GATEWAY_URL}/review`，使用 `QA_API_KEY` Bearer 认证。

请求包含 `videoUrl`、当前 `shot`、`bible`、`previousShot`、审查维度 `criteria` 与 `idempotencyKey`。网关负责读取实际素材、抽帧及调用多模态模型。

```json
{"verdict":"rejected","notes":"当前人物左手道具消失；保持上一镜末帧中的持物姿势。"}
```

或返回 `{"verdict":"passed","notes":"抽检关键帧符合镜头要求，仍需人工确认节奏。"}`。

只有 `passed` 与 `rejected` 合法，意见必须非空。网络错误不视为通过。拒绝会先阻止下游提交，将审查意见写入 `reflection` 后重新生成，最多 2 次自动返工。达到上限后要求编辑新版本。自动通过仍进入人工审片，不自动宣称成片符合艺术目标。

## 帧级视觉审查（工作台抽帧模式）

当本地 FFmpeg 可用且 `VISUAL_QA_SAMPLE_FRAMES` 未设为 `0`，工作台会先从生成视频中抽取等间隔帧（默认 3 帧，480px），再以同一 `POST /review` 端点发送 `frames` 字段（`videoUrl` 省略）：

```json
{
  "frames": [
    {"timestampSec": 1.0, "dataUrl": "data:image/png;base64,..."},
    {"timestampSec": 2.0, "dataUrl": "data:image/png;base64,..."}
  ],
  "shot": {},
  "bible": {},
  "previousShot": {},
  "criteria": ["identity","wardrobe","limbs","action_match","camera_motion","temporal_continuity"],
  "idempotencyKey": "job-uuid-qa-frames"
}
```

此时网关可返回结构化 findings（最多 10 项），每项必须带帧时间戳：

```json
{"verdict":"rejected","notes":"角色发色漂移。","findings":[
  {"code":"identity-change","severity":"error","timestamp":1.0,"evidence":"第 2 帧发色","suggestion":"保持发色与美术参考一致，重新生成本镜。"}
]}
```

findings 会存入该镜 QA 记录，并在返工请求中随 `reflectionFindings` 传回生成端，作为精确修复依据。**没有帧证据的文字意见不能成为视觉缺陷**——解析器强制 code/severity/帧时间戳/建议四要素。抽帧失败时自动回退到 `videoUrl` 合同，不影响既有网关。

## 供应商适配责任

- 云端：认证、具体模型名与合法片长/画幅、任务状态映射、图像 URL 或上传格式。
- 连续性：下载并提取前镜末帧、校验画幅与主体、按供应商能力传递首帧/末帧/多参考图。`requestPreviousLastFrame` 只是请求意图，不能冒充已经提取。
- 运镜：本项目坐标是相对主体的米制创作描述；普通视频模型通常不能逐点严格执行，网关应映射支持的运动参数或生成自然语言。
- 本地 ComfyUI：将协议映射到具体 workflow JSON、seed 与图像节点，排队执行并提供浏览器可访问的输出。
- 质量：网关必须确实抽帧或读取视频后返回审查结论，不可只读取提示词判定通过。

调试反思回路时可在开发环境设置 `DEMO_QA_REJECT_ONCE=shot-2`：仅为演示故障注入，不代表真实画面检测。


OpenAI 本地生成的参考图在 `referenceImages` 中以 `data:image/png;base64,...` 传入。网关需接受 HTTPS URL 和 PNG data URL，并将图片转换/上传为目标视频供应商所需格式。工作台本机图片地址不会作为远程可访问 URL 提交。
