# 更新记录

## 2026-09-15 · Visual QA 闭环：帧采样 → 结构化 finding → 再生决策

补上评审标注的最后一项新能力：真实视觉质检闭环。依赖方明确——视觉判定需要真实多模态评测服务；本版本交付的是**工作台侧的完整闭环管线**与严格合同。

### 新增

- **帧采样**（`lib/studio/visual-qa.ts`）：FFmpeg 探测时长后抽取等间隔帧（默认 3 帧、480px），封装为 data URL；抽帧失败自动回退到 `videoUrl` 合同，不影响既有网关。
- **多模态审查合同**：`POST /review` 新增 `frames` 字段（含 timestampSec/dataUrl）；`reviewMediaFrames` 发送帧请求并按严格解析器校验结构化 findings（≤10 项，强制 code/severity/**帧时间戳**/建议四要素）——**没有帧证据的文字意见不能成为视觉缺陷**。
- **结构化 finding 贯通**：findings 存入该镜 QA 记录（`qa.findings`），返工请求经 `reflectionFindings` 传回生成端作为精确修复依据；`reviewForJob` 在采样模式与 URL 模式间优雅选择（`VISUAL_QA_SAMPLE_FRAMES=0` 关闭）。
- **闭环评测**（`scripts/visual-qa-eval.mjs`）：真实 FFmpeg 抽帧 + 本地 mock 视觉网关驱动完整回路——拒绝（带时间戳 finding）→ 再生决策（retryBudget 计 1）→ 复核通过，度量输出。

### 文档与验证

- 新增 visual-qa 测试（解析严格性、请求合同、帧上传、回退路径、真实抽帧——FFmpeg 缺失时安全跳过）；57 个测试文件、typecheck、lint、build 四 gate 全部通过。
- 网关协议文档补充帧级审查合同与 finding 格式。

## 2026-09-15 · 有限并行会审、重试预算形式化与不变量测试

落地评审标注的新能力中可安全实现的部分：只读任务有限并行（变更任务严格串行）、重试预算与轮询上限、不变量回归。

### 新增

- **有限并行 DAG**（`agent/batch.ts`）：Scheduler 返回 `batch` 结果——多个无依赖的独立 review 任务在**项目克隆上并发执行 LLM 会审**（每任务先过统一 Policy 门、复用各自任务记录），验证后的报告按批次顺序**串行合并**回项目；verify 闸门与所有变更任务（revise / write / design / stop）仍严格单任务串行。失败任务标记 failed，首个错误保留 run 失败语义。
- **重试预算形式化**：`Production.retryBudget { submission / polling / qualityRepair / llmRepair }`（默认 polling 60），`Job.pollCount` 计数——轮询超过预算即失败并明确提示核查供应商，不再无限查询。
- **不变量测试**（`tests/invariant.test.ts`）：revision 单调不降、非法生产状态跳转被拒、生成批准门禁下不存在任何任务。

### 文档与验证

- 新增批处理回归（2 个会审任务 2 次 worker 调用、0 次 supervisor 调用、报告按岗位合并、任务全部完成）；56 个测试文件、typecheck、lint、build 四 gate 全部通过。
- 架构文档补充有限并行与预算语义。

## 2026-09-15 · 运行时硬化：项目级锁、预算准入、可观测报告与批准事件

完成评审清单中剩余的运行时安全与可观测项。

### 新增

- **项目级互斥锁 + 合并保存**：`dispatch` 按项目加锁（不同项目可并发，全局命令用 '*' 锁冲突所有项目），项目命令保存时只把**本项目条目（及新建项目）合并回共享文件**——并发修改其他项目不再被覆盖；后台 worker 同样按项目加锁、忙时跳拍。锁与合并原语在 `commands/shared.ts`，报错语义不变。
- **预算准入门**：设置 `PROJECT_BUDGET_USD` 后，`enqueue` / `enqueue_group` / 重新生成在创建任务前用成本台账累计 + 本次估算做硬性预检，超限即拒绝（默认关闭，估算非发票）。
- **`runtime_report` 只读命令**：一次拿到运行状态、任务（含 blockedBy/result/verification）、成本摘要、产物 manifest（版本/状态）与批准事件状态——Agent Observability 的单一视图，不写不锁。
- **Approval 领域事件**：`production.approvalEvents` 只增有界记录剧本/资产/渲染/单镜 QA/终局批准（who/what/revision/at），状态按 revision 计算 approved / expired；布尔门保持权威执行语义不变。

### 文档与验证

- 新增 runtime-hardening 测试（锁冲突矩阵、合并保存保并发、预算门禁、批准事件、runtime_report）；55 个测试文件、typecheck、lint、build 四 gate 全部通过。

## 2026-09-15 · 任务恢复一致性收口：提交边界与状态冲突规则

按第六轮评审把"任务四阶段（开始执行 / 执行结束 / 结果提交 / 恢复重建）"定义清楚：模型执行结束 ≠ 创作结果已持久保存；账本里的 completed 不能单独证明依赖已满足。

### 修复

- **结果提交点**：`agent_runs` 增加 `commit_count / committed_fingerprint`，仅在命令处理器**成功保存项目后**递增；任务行记录"预测提交号"（当前提交数 +1）。恢复时若任务的预测提交号超过 run 的实际提交数——即完成从未伴随项目落盘——恢复为 failed，下游 verify 依赖随之阻断：**未提交的修改不会被复核放行**。
- **状态冲突规则**（项目 vs 账本，双向不盲信）：项目中的旧 pending/verification 遇到账本中的 running 或未提交完成 → 标记中断失败，**绝不静默重执行**；账本中已提交的终态可采纳升级项目旧状态。项目已提交完成而账本落后时不会被回退。
- **JSONL 查询语义对齐**：`agentTasks` / `generationJobs` 按 id 归并到最新状态（与 SQLite UPSERT 等价），恢复循环防御重复 ID；新增 `LEDGER_BACKEND` 环境变量强制后端以便测试降级路径。
- **评测指标真实化**：`scripts/eval-runtime.mjs` 的 supervisor 调用数从调用记录统计，复核指标改为检查 verify 任务**完成状态**而非仅存在。

### 文档与验证

- 新增冲突回归：pending+running → failed 且 Scheduler idle、completed 未提交 → failed 且 verify 阻断、committed 完成 → 正常恢复且 verify ready、JSONL 三次状态变更 → 单条最新记录；54 个测试文件、typecheck、lint、build 四 gate 全部通过。

## 2026-09-15 · Runtime V2 收口：Capability-first 路由与迁移一致性核对

回应"新旧接口迁移未收口"的评审意见：逐条核对了 `requiredCapabilities ↔ capabilityRequirement`、`taskId` 传递、`AutoRun.tasks`、`server.ts` 体积——经查均为评审读到旧缓存快照，当前 main 无残留（`requiredCapabilities` 引用 0 处、`taskId` 已传入执行上下文、`AutoRun.tasks` 已定义、`server.ts` 209 行）。本轮完成评审列表中唯一真实剩余的收口项：

### 新增

- **Capability-first 路由**：Planner 决策的 `roleId` 变为可选——仅提供 `capability` 时由 Policy Engine 校验该能力满足动作要求后，经 Capability Router 指派第一个合格岗位（决策归一化为带岗位的最终形态，下游零改动）；既无岗位也无能力时保留历史报错语义。Planner prompt 同步更新为"roleId 与 capability 至少其一"。
- 评审提及的其余收口项核实结论：`capabilityRequirement / preconditions / effects / approval` 已是 Policy 与 Registry 的唯一契约；命令注册表迁移已完成（server.ts 仅 209 行，只负责锁/载入/守卫/分发/持久化）；planner prompt 已瘦身（604 字）并保留安全不变量。

### 文档与验证

- 新增 capability-first 路由测试（仅能力 → 路由到导演 / 能力不满足 → 拒绝 / 双缺 → 历史报错）；54 个测试文件、typecheck、lint、build 四 gate 全部通过。

## 2026-09-15 · 后台推进、账本对账与固定场景评测

补齐评审标注"尚未完成"的执行底座：脱离页面请求推进、执行账本与项目状态对账、可重复的运行质量评测。

### 新增

- **后台媒体 Worker**（`commands/background.ts` + `startBackgroundWorker`）：开发服务器启动后按节拍推进**用户已提交**的资产生成与媒体队列（含长镜头分段），关闭标签页仍继续；与请求共用全局写锁，忙时跳拍；`STUDIO_BACKGROUND_WORKER=0` 可关闭。Worker 永不启动新工作、不跑 Agent 步骤、不产生额外模型调用。
- **执行账本自动对账**（`reconcileRunTasks`）：`autoStep` 步首从账本补齐项目丢失的任务（崩溃于账本写入与项目保存之间），现有记录优先；账本中"运行中"的遗留步骤恢复为 failed——被中断的步骤绝不静默续跑。
- **固定场景评测**（`scripts/eval-runtime.mjs`）：模拟供应商下度量三类场景——修订+强制独立复核（调用数/闸门/成本）、多步计划执行（supervisor 只问一次）、被阻塞复核（0 调用 0 成本）。文本指标不替代画面质量的人工/视觉评测。

### 修复

- 测试全文件级隔离 `STUDIO_DATA_DIR`（autopilot / agent-task / agent-runtime），demo 测试不再把账本写入真实 `.studio`，消除跨轮次对账污染。

### 文档与验证

- 54 个测试文件全部通过，类型检查、代码规范与生产构建通过；README 与架构文档更新后台推进、对账与评测边界。

## 2026-09-14 · 恢复语义与计划语义收敛：无重复提交、无提前完成、无错误归属

按第五轮评审把执行链上的状态转换、持久化时机和恢复顺序做一致。

### 修复

- **统一付费提交入口**（`commands/jobs.ts`）：首次提交与崩溃恢复共用 `submitJob`，提交前检查点成为契约而非可选参数——准备校验 → 持久状态确认 → 检查点落盘 → 发送 → 远端 ID 落盘；`unknown` 状态永不重发，`submitted` 缺失 ID 视为异常而非重试。
- **先对账、后租约**：账本中已确认的 provider ID 在租约处理前合并进当前状态；旧 unknown/空状态不再覆盖 submitted/已知 ID（SQLite/JSONL 双后端 UPSERT 防降级）。租约过期只表示本地工作者死亡，绝不使远端任务失效。
- **多步计划语义**：`requiredReview` 仅对 `verify_storyboard` 任务启用；普通预排会审不再把整轮标为 completed——仍有 pending 任务时继续执行；`plan` 条目省略 `roleId` 时按动作的完整 `capabilityRequirement`（anyOf/allOf）路由，不再进入 waiting 死路。
- **任务最小恢复闭环**：决策物化、后续计划与 verify 任务创建时即写入持久账本（新增 reason / verification_author 列，旧库自动 ALTER 兼容），重启后 pending/running/failed/待复核状态可识别。
- **产物与成本数据源**：Prompt 记录 `compiledAt`、QA 记录 `at` 作为 producedAt——重新编译/复审的产物正确标为 current；`observation` 注入 `projectId`，`roleJSON` 全链传递归属，LLM 花费进入项目摘要；`costSummary` 以账本累计为准（不随项目镜像截断减少），估算按 4 位小数取整。

### 文档与验证

- 新增组合回归：租约过期+已知 ID 续查、UPSERT 防降级、普通会审+无 roleId 后续任务、重新编译/复审产物 current、LLM 归属进项目摘要；54 个测试文件、类型检查、代码规范与生产构建全部通过。
- 架构文档更新提交边界、恢复顺序与成本归属语义。

## 2026-09-14 · 执行底座五件套：Task-first、Durable Runtime、Generation Queue、Artifact 版本与 Cost Ledger

按评审排序完成基础设施阶段：不再新增抽象，让抽象承担生产负载。

### 新增

- **Task-first 全量迁移**：每个决策在执行前物化为 pending 任务，执行器复用同一任务记录走完 proposal → task → scheduler → policy → executor → completed；决策可携带 `capability / targets / plan`（最多 3 项后续任务），计划物化为带依赖链的任务序列由 Scheduler 顺序执行，不再重复询问 LLM；Scheduler 通用化——任意 pending 任务按依赖就绪后路由到授权岗位执行。
- **SQLite Durable Runtime**（`lib/studio/durable/ledger.ts`）：runs / tasks / generation_jobs / usage_records 四表持久化执行状态，Node ≥ 23.4 用内建 `node:sqlite`，旧运行时自动降级为等价语义的 JSONL 追加日志；所有写入经 `safely()` 包裹，账本故障不阻断命令。
- **Generation Queue 升级**：`Job.submission`（unsent / submitted / unknown）成为持久化提交边界，`leaseExpiresAt` 租约标记本地工作者所有权；进程重启后——未发送的工作安全重排、结果未知的提交**永不重发**、已提交的按账本恢复的 provider job id 继续查询。`fal-pending` 标记可被账本中的真实 ID 接管恢复。
- **Artifact 版本化**：节点携带 `version / producedAt`（资产版本、提示词编译 revision、视频来自 job、QA attempt），`artifactManifest` 以 producedAt 与最近失效事件比较判定 current/stale，失效后重新生成的产物正确标为 current。
- **Cost Ledger**：`durable/pricing.ts` 文档化估算（LLM 按 tokens、视频按秒、图像按张，环境变量可覆盖）；LLM 调用与媒体提交双入口记录，projects.json 保留有界镜像（`production.costLedger`），Observation 注入 `costSummary`（分类花费、预算上限）供 cost-aware 规划。

### 文档与验证

- 新增 durable-runtime、cost-ledger 两组回归（跨进程提交边界、崩溃恢复、租约重占、估算与镜像）；54 个测试文件、类型检查、代码规范与生产构建全部通过。
- 架构文档与 README 更新存储与队列边界说明。

## 2026-09-13 · 执行链封口：统一 Policy 门、调度放行权与状态语义修正

按第四轮评审修复两个执行链旁路与三个边界问题。核心原则：权限、依赖与版本状态必须在**所有执行路径**上成立，而不是只在单点成立。

### 修复

- **Scheduler 旁路封口**：`autoStep()` 在全部决策路径（LLM / 用户指定 / Scheduler 预排）汇合后、`beginStep()` 前统一执行 Policy 检查；Scheduler 返回判别结果（ready / blocked / waiting / idle），blocked 与 waiting 直接进入等待状态，**不再回退 Planner**——被阻塞的复核无法通过兼容分支绕过依赖。
- **复核人能力驱动**：`selectVerifier` 先按 `verify_storyboard` 授予筛选（导演已显式默认授予，不再靠岗位名隐式获得）、排除作者，再应用 reviewer → continuity → director 优先级；无审查能力的自定义 QA 岗位不会再被选中执行复核。
- **单一调度记录**：调度任务被复用时，步骤的任务记录就是 verify 任务本身（同一 task id 走完 verification → completed）；演示复核未过时任务回到 verification 状态，闸门保持打开。
- **移除 planner 的 pendingReview 兼容分支**：旧 `pendingReview` 在步首迁移为显式 verify 任务，此后只有调度器拥有复核放行权（单规则集）。
- **`capabilities: []` 语义修正**：显式空数组 = 撤销全部权限，不再回退内置默认（按字段存在性判断，而非数组长度）。
- **能力条件统一解释**：新增 `satisfiesCapabilityRequirement` 作为 allOf/anyOf 的唯一解释器，Policy 与动作目录共用，修复“仅有 allOf 时目录误判不允许”的漂移。
- **Artifact Manifest 再生判定**：以再生任务完成时间与最近失效事件比较——失效后重新生成的视频为 current，旧历史仍保留；不再把“历史上发生过失效”误标为新产物。

### 文档与验证

- 新增完整路径回归：无权限复核人零 worker 调用、被阻塞复核零 planner/worker 调用（live 模式验证）、空权限撤销、allOf 一致性、再生产物 current；52 个测试文件、类型检查、代码规范与生产构建全部通过。
- 架构文档更新统一 Policy 门、调度放行权与严格依赖语义。

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
