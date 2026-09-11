# 架构与扩展边界

## 分层

| 层 | 主要模块 | 责任 |
| --- | --- | --- |
| 创作状态 | types / screenplay / graph / story-context | 确认剧本、分镜、资产版本、跨幕资料和状态流转 |
| 专业合同 | director / shot-intent / narrative / performance / sound-plan | 验证引用、对白原文、镜内时间、叙事线和声音来源 |
| 质量诊断 | quality-report | 纯函数、稳定问题 ID、分级证据、岗位及修复建议；不调用模型 |
| 协作控制 | autopilot / agent（observation、scheduler、planner、policy、router、actions、run-controller、task、capabilities）/ auto-run-state / auto-progress / team-runtime | 限定工具动作、候选与修改、去重、无进展停止、独立复核、能力授权、任务调度与记录 |
| 语言适配 | provider-catalog / language-provider | 供应商元数据、协议转换、错误分类；不修改作品 |
| 媒体适配 | video-profile / video-text / minimax-video / fal-video / fal / openai-images | 能力预检、可见提示词、准备输入、提交和查询 |
| 工作台事务 | server / commands / command-policy / timeouts | 锁、载入、守卫、有序命令注册表、审批、修订备份、队列、步骤幂等与等待策略 |
| 资产依赖 | asset-policy / asset-catalog / artifact-graph | 实体与候选、等级、场次匹配、增量补充、定向媒体失效与失效血缘 |
| 界面 | production-diagnostics / auto-run-driver / auto-pilot / production-handoff / video-preflight | 只读回看、意见输入、协作推进、交接与批准 |
| 结果等待 | media-poll-driver / media-poll-state | 跨页面串行推进已授权队列并查询已有资产任务 |
| 完成提醒 | notification-events / notification-client / notification-center | 状态差分、通知分类、去重、权限与结果定位 |

专业规范位于 `production-skills/`，是产品运行时规范，不是 Codex 插件。修改规范需要同步 `skills.ts` 版本。新增知识不应只增加提示词长度：优先定义可检查输入、输出及真实失败样例。

## 不变量

1. 创意事实、已确认剧本与逐字对白是创作依据；视听表达不能通过私自改写剧情解决。
2. 播放顺序不等于故事时间。前镜状态按叙事线追踪；图像继承还需满足同场、连续时间条件。
3. 同一句台词由来源场次和对白编号识别，分段按实际时间排列；跨场声桥不自动把说话人加入画面。
4. 确定性错误与艺术风险分开。诊断通过不等于像素、声音、表演通过。
5. 修改在候选副本上执行，校验通过才应用；文本变更使对应下游批准和媒体失效。
6. 未批准候选不是资产替换；自动协作只生成文字，不自行调用付费图片或视频。
7. 外部提交不支持凭空幂等。先完成本地准备，再持久化提交标记；未知提交不重发，已有远端 ID 只查询。
8. 自动步骤携带 run ID 与 expectedStep。旧步骤只返回当前状态；网络失败后界面暂停，不因渲染再次提交。
9. 密钥留在服务端。有效目标域名变化时检查预设回退，不能绕过跨域密钥保护。
10. 每个自动步骤留下任务记录；分镜修订后的复核是显式 verify 任务，由 Scheduler 按 dependsOn 调度、只能由另一岗位关闭，作者不能自验。
11. 失效血缘只增不改、有界截断；旧产物以 stale / archived 表达，不物理删除历史。
12. 能力是授权不是描述：岗位必须显式声明或内置默认授予动作所需能力，自定义岗位不因回退获得权限；被策略拒绝的决策不会触达任何模型调用。

## Agent Runtime 内核

自动协作是一个分层运行时，`autopilot.ts` 只是门面：

```text
buildObservation   ObservationBuilder  确定性上下文投影，含数据驱动 availableActions
nextScheduledTask  Task Scheduler      dependsOn 满足的预规划任务先于 LLM 执行
planDecision       Planner             LLM 提议，运行时裁决（含强制独立复核）
policy             Policy Engine       允许/禁止/能力授权/失效的单一裁决点
getAgentAction     ActionRegistry      白名单动作执行器，每个动作是有界变更
beginStep/finish   RunController       步骤记账、指纹去重、预算耗尽、失败标记
```

- 动作契约在 `agent/actions/types.ts`：每个动作声明 `description / approval / capabilityRequirement(anyOf|allOf) / preconditions / effects / requiresVerification`；这些元数据以 `allowedActions` 注入 Observation，是 supervisor 的**单一动作事实源**（prompt 不再用散文重复动作规则），也是 Policy Engine 的评估输入。Policy Engine（agent/policy.ts）是通用评估器：仅白名单、岗位成员与理由形状是固定检查，前置条件与能力要求全部来自动作元数据，无逐动作硬编码。
- **统一执行前 Policy 门**：无论决策来自 LLM、用户指定还是 Scheduler 预排，`autoStep()` 都在所有路径汇合后、`beginStep()` 之前统一执行 `evaluateAutoDecision`。Scheduler 返回判别结果（ready / blocked / waiting / idle）：blocked 与 waiting 直接进入等待状态，**绝不回退 Planner 重建执行路径**；旧 `pendingReview` 在步首迁移为显式 verify 任务，此后只有调度器拥有复核的放行权。
- `AgentTask`（agent/task.ts）记录每一步的岗位、能力、输入版本与结果；分镜修订把 `pendingReview` 镜像为 `verify_storyboard` 复核任务，Scheduler 按 `dependsOn` 判定就绪后强制安排独立复核（作者不能自验）。就绪语义严格：依赖必须存在且 completed，缺失、未完成或 cancelled 一律阻塞；调度任务被复用时，步骤的任务记录就是调度任务本身（同一 task id 走完 verification → completed）。任务记录只增不改，超限截断。
- 能力模型（agent/capabilities.ts）把“岗位身份”与“能干什么”分开：`capabilityForDecision` 只是描述性元数据，**授权是严格的一等行为**。`satisfiesCapabilityRequirement` 是能力要求的唯一解释器（Policy 与动作目录共用，杜绝漂移）；`allOf` 须全部满足、`anyOf` 须至少一项；`capabilities: []` 是显式撤销全部权限而非回退默认；`selectVerifier` 先按 `verify_storyboard` 授予筛选（导演已显式默认授予）、排除作者，再应用岗位优先级。自定义岗位不声明能力就拒绝，绝不因回退获得权限（agent/policy.ts）。
- 规划器永远不直接拥有昂贵副作用：媒体生成、批准与队列仍在命令层，动作白名单只覆盖文字协作。

## 命令注册表

`lib/studio/commands/` 按原始分发链的精确顺序组织为四组处理器（全局 → 项目只读 → 核心 → 后置），处理器可返回 `NEXT_HANDLER` 落到下一处理器。`server.ts` 只负责锁、载入、revision / autoRun 守卫、分发、持久化与错误边界。新增命令 = 新增一个带 `matches/run` 的处理器并放进对应阶段数组，不再向网关追加分支。

## 失效血缘与 Artifact 图

生产 FSM（graph.ts）、任务图（agent/task.ts）与产物依赖图（artifact-graph.ts）是三个独立模型。`buildArtifactGraph` 从作品推导 script → shot → prompt → video → qa 与资产引用，节点携带可得的版本身份（资产 version、提示词编译 revision、视频来自 job、QA attempt）与 producedAt；`downstreamClosure` 给出变更的传递下游，`artifactManifest` 据此输出每个存续产物的 current / stale / archived 状态——**判定以产物自身的生产时间与失效事件比较为准**，失效后重新生成的产物为 current。`invalidateFrom` 与 `invalidateAssetMedia` 在原有清理之外追加 `production.artifactEvents` 血缘记录（只增、有界），回答“为什么这份素材被重新生成”。旧产物用 stale / archived 语义表达（资产 `retired`、任务 `cancelled`），不物理删除历史。

## 持久化执行账本与生成队列

创作状态仍由 `projects.json` 原子文件承载；**执行状态**由 `lib/studio/durable/ledger.ts` 持久化（runs / tasks / generation_jobs / usage_records），Node ≥ 23.4 用内建 node:sqlite，旧运行时自动降级为等价 JSONL。关键语义：

- 任务/运行在 beginStep / finishStep 同步写入，账本故障不阻断命令（`safely()`）。
- 生成任务的 `submission`（unsent / submitted / unknown）是持久化提交边界：**结果未知的付费提交永不重发**；本地崩溃后，未发送的工作按租约（`leaseExpiresAt`）重排，已提交的按账本中的 provider job id 继续查询；`fal-pending` 标记可被账本真实 ID 接管。
- 成本台账：LLM 与媒体提交双入口按文档化估算记录，projects.json 保留有界镜像，Observation 注入 `costSummary` 供预算感知规划。估算不是发票，真实费率可用环境变量配置。

## 扩展语言服务

现有协议下的新供应商添加 catalog 预设即可；新协议在 language-provider 定义 wire request 和 response parser，禁止在每个 Agent 中复制认证和网络分支。以模拟响应测试多轮消息、截断、拒绝、认证、重定向和密钥隔离。

## 扩展视频服务

先定义 video-profile 的实际模式、时长、参考数量及声音能力，再实现纯准备函数、提交与查询。videoPreview 必须与真实提交共享准备函数。新 endpoint 没有 adapter 时不能宣称兼容；不要通过截断对白或改写创作时长来适配供应商。render-timing 可将请求时长向上取整并保留原剪辑时长；超过单次上限的单镜由 long-take 串行接续并本地组装，预检、提交和恢复共用这些规则。

提交前回调仅在本地校验完成后运行。回调持久化失败时不得发送 HTTP；网络结果未知则保留标记。不能把“超时”当作“供应商没有收费”。

## 测试策略

- 场景测试：A→B→A、同场多线、声音跨场、同一人物跨空间说话、重复对白、时窗倒序、主观镜头与有动机固定镜头。
- 工作流测试：修订原子性、待确认候选、修订后独立复核、预算耗尽、无进展、重复步骤、旧运行标识。
- 适配测试：输入模式与时长、首尾帧映射、认证、响应格式、拒绝/截断、任务恢复、本地失败无请求、提交边界。
- 真实画面评估需另建经用户批准的样本集与人工标签，文字单测不能替代。

## 已知工程边界

当前仍是本地单进程文件存储与页面推进。没有持久后台 Worker、数据库事务、多用户权限和自动分轨音频合成。扩展这些能力应通过明确迁移与兼容测试完成，而不是把更多副作用放入一个 Agent 的提示词。

## 资产就绪与状态失效

asset-policy 按实体与当前服装选择查询就绪状态。同一实体的原始记录保存身份、等级和场次范围，批准变体提供实际参考图；退休原始记录仍可作为活跃变体的身份元数据。跨幕清除旧场次编号范围，再按新剧本匹配。

asset-catalog 负责来源校验、增量去重和媒体依赖失效。新文字候选不覆盖原批准图，不等待出图即可继续文本协作。必备主图仅在关联镜头提交媒体前检查；推荐和可选资产缺图时把文字设计传给媒体适配器，但不绕过供应商最少输入要求。

确认替代图会失效关联镜头、共享联合片段及接续依赖，保留用户上传首帧与无关任务；不增加创作 revision。旧任务以 assetSuperseded 标记，保留历史输出、排除旧恢复入口和旧版本重试预算。关联远端任务结果未收回或提交未知时，禁止用替换参考图绕过查询与重复计费保护。

## 页面等待与结果通知

MediaPollDriver 常驻 Home，串行交替处理已有图片资产任务和已授权生成队列；不会因打开另一工作台页面而卸载。AutoRunDriver 独立推进白名单文字协作。媒体回写只更新保存状态，不用完整 sync 覆盖用户编辑中的草稿。

studioRequest 的成功与异常出口连接 notification-client；纯 notification-events 比较已保存状态。排队、提交、上传、取消均不是生成完成。真实素材需成功状态和输出地址，长镜头还需最终组装完成；自动协作以实际状态与步骤为准，不以 HTTP 200 推断成功。

页面提醒按标签页去重；桌面提醒用共享记录与 Web Locks 去重，记录仅保存压缩事件标识与时间。首次读取项目建立基线，不批量重发历史结果。通知许可失败、用户关闭提醒和通知构造异常均不改变请求结果。权限由用户点击开启，关闭标签页后没有后台推送服务。
