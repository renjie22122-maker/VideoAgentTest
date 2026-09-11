# 更新记录

## 2026-09-13 · Runtime 收敛：单一动作事实源、通用 Policy 与严格依赖语义

按第三轮评审收敛，不再新增抽象：让已落地的骨架承担全部规则表达。

### 修复

- **单一动作事实源**：动作元数据新增 `approval`（批准/复核语义）与 `preconditions`（状态前置条件），Observation 的 `allowedActions` 全部由 ActionRegistry 动态派生；删除 `autoTaskContracts` 双源，supervisor 与 Policy Engine 看到同一份元数据。
- **Policy Engine 通用化**：前置条件与能力要求改为遍历动作元数据评估（`capabilityRequirement` 显式区分 `allOf`（须全部）与 `anyOf`（任一）），消除逐动作硬编码 if；历史违规顺序与报错信息保持不变。
- **Scheduler 依赖语义收紧**：依赖必须存在且 `completed` 才视为满足；缺失、运行中或 `cancelled` 一律阻塞（`blockedReason` 给出具体原因），防止截断或缺陷的任务图提前执行。
- **瘦身 supervisor prompt**：移除逐动作规则散文（动作事实改由 `allowedActions` 元数据承担），保留质量报告、未解决问题、媒体禁令与人工批准等安全不变量。
- 核实 GitHub 上 `autopilot.ts` 为纯门面（160 行，无旧执行逻辑）；评审读到的旧实现为缓存索引不同步，不存在 shadow architecture。

### 文档与验证

- 52 个测试文件全部通过（更新 policy/scheduler/runtime 契约测试），类型检查、代码规范与生产构建通过。
- 架构文档更新动作元数据、通用 Policy 与严格依赖语义。

## 2026-09-12 · Runtime 内核第二阶段：Capability 授权、Task 调度与 Policy Engine

延续上一版内核拆分，把 Task / Capability / Action 从“结构存在”变成“真正掌握运行权”。行为唯一有意的收紧：自定义岗位不再通过回退获得执行权限；被策略拒绝的决策不会触达任何模型调用。

### 新增

- **Capability 授权化**：每个动作声明 `requiredCapabilities / effects / requiresVerification`；Policy Engine（`agent/policy.ts`）成为允许/禁止的单一裁决点，岗位必须显式声明或内置默认授予所需能力，自定义岗位未声明即拒绝。`AgentConfig` 新增 `capabilities` 字段并严格校验。
- **Task Scheduler**（`agent/scheduler.ts`）：`dependsOn` 成为就绪判定标准，预规划的 `verify_storyboard` 任务在依赖满足后先于 LLM 调度执行；`Capability Router`（`agent/router.ts`）按能力授权挑选执行者，验证者选择顺序与历史行为一致（reviewer → continuity → director）。
- **Action 元数据化**：每个动作附带描述、能力、效果与复核要求，以 `availableActions`（含 allowed 与理由）注入 Observation，为瘦身 planner prompt 铺路。
- **Artifact Manifest**（`artifactManifest`）：依据失效血缘输出每个存续产物的 current / stale / archived 状态，历史不删除。

### 修复

- 未经授权的决策现在在 worker 模型调用之前被拒绝，不再产生任何费用。

### 文档与验证

- 新增 agent-policy、agent-scheduler 两组契约测试并更新既有 capability / autopilot 测试；52 个测试文件、类型检查、代码规范与生产构建全部通过。
- 架构文档补充 Policy Engine、Scheduler、能力授权与 manifest 状态语义；不变量新增“能力是授权不是描述”。

## 2026-09-12 · Agent Runtime 内核重构（Runtime Refactor v1）

本次不增加用户功能，只演进内部架构：把自动协作、命令处理和失效逻辑从两个巨型文件收敛为有边界的运行时模块，并引入 Task / Capability / Artifact 三个一等公民概念。所有既有测试保持通过，行为不变。

### 新增

- Agent Runtime 四层拆分：`lib/studio/agent/` 下 ObservationBuilder（上下文投影）、Planner（提案与决策校验）、ActionRegistry（白名单动作执行器）、RunController（步骤记账、去重、预算、失败标记）；`autopilot.ts` 收敛为门面，公共导出保持不变。
- Command Registry：`lib/studio/commands/` 按阶段与领域拆分为全局、只读、核心、后置四组有序处理器；`server.ts` 只保留锁、载入、revision 守卫、分发、持久化与错误边界。
- `AgentTask` 一等公民：每个自动步骤产生任务记录（岗位、能力、依赖、输入版本、结果），`pendingReview` 镜像为显式 `verify_storyboard` 复核任务（AUTHOR != VERIFIER 成为任务策略而非特殊字段）。
- Role → Capability 解耦：`agent/capabilities.ts` 定义能力目录与默认岗位授权；决策仍输出 roleId 保持兼容，运行时派生 capability 用于任务记录与后续路由；自定义岗位安全回退到动作能力。
- Artifact 依赖图：`artifact-graph.ts` 从作品推导 script → shot → prompt → video → qa 依赖与资产引用，提供传递下游闭包；`invalidateFrom` 与 `invalidateAssetMedia` 追加式记录失效血缘（artifactEvents），不改变原有清理行为。

### 修复

- 存储根目录改为按调用时环境解析，避免模块缓存把 `STUDIO_DATA_DIR` 钉死在首次加载值。

### 文档与验证

- 新增 agent-runtime、command-registry、agent-task、agent-capability、artifact-graph 五组契约测试；50 个测试文件、类型检查、代码规范与生产构建全部通过。
- 架构文档补充 Runtime 内核分层、任务模型、能力模型与失效血缘说明。

## 2026-09-11 · 增量资产、协作交接与完成提醒

### 新增

- 全流程快速补充资产：手动建立文字设计，或基于最新分镜增量查漏补缺；保留已有批准版本。
- 不可或缺、建议增加、可选三级参考图依赖，可设置适用场次。缺少非必需参考图时仍传递文字设计，继续后续制作。
- 生成前交接面板：展示实际剩余问题，支持输入自己的处理意见、继续协作、场记检查、编译和前往批准。
- 页面内与 Windows 桌面完成提醒，语言、图像和视频分类开关、测试通知、点击定位、跨标签页桌面去重。
- 常驻媒体等待驱动，统一串行查询图片资产和推进已授权视频 / 分镜队列，工作台内切页继续等待。

### 修复

- 自动协作锁定创作字段时，查看衔接意见、历史步骤和具体镜头的入口保持可用。
- 总 Agent 停止日志保留模型原理由，同时展示真实状态；有未解决问题不能显示为通过。
- 新建资产文字候选不再强制停止文字协作等待图片，也不将同名设计变体重复当成必备实体。
- 替换参考版本保留文字分镜与生成批准，只处理关联媒体及共享依赖；上传首帧、无关结果与恢复记录保留。
- 旧资产任务失效后不会错误恢复其已组装长镜头，也不会通过改变创作 revision 绕过其他任务的未知提交保护。
- 下一幕继承已批准变体与原始身份资料，清除上一幕场次编号限制。
- 排队、上传、取消、HTTP 200 下的协作失败和长镜头分段返回，不再被通知为整项生成成功；0 步等待用户也会提醒。

### 文档与验证

- 重整 README、架构、岗位扩展、团队职责和完整制作指南。
- 新增增量资产、完成提醒与常见问题说明，解释审批、局部媒体失效、后台运行及请求恢复边界。
- 150 项本地回归测试通过，包括 FFmpeg、状态事务、任务恢复、资产兼容与通知；类型、代码规范及构建检查通过。
- API 测试使用模拟响应；未执行新的收费模型测试。Windows 实际横幅需用户允许通知后用测试按钮确认。

本次保留现有项目数据结构的可选字段兼容；旧资产缺少等级时，人物默认不可或缺，场景和道具默认建议增加。没有后台推送或持久任务服务，关闭工作台不保证继续推进。图像和视频仍需用户显式发起生成。

## 此前已提交能力

- [00181cb](https://github.com/renjie22122-maker/VideoAgentTest/commit/00181cb)：长镜头串行接续、分段恢复、原声保留、本地组装与预检。
- [48824a1](https://github.com/renjie22122-maker/VideoAgentTest/commit/48824a1)：Agent 协作、更多服务适配及专业制作校验。
- [4753563](https://github.com/renjie22122-maker/VideoAgentTest/commit/4753563)：跨幕与叙事线连续性、视听设计及灵活视频输入。
- [ef4c03c](https://github.com/renjie22122-maker/VideoAgentTest/commit/ef4c03c)：可配置岗位与自动协作流程。
