# 语言模型接入与扩展

工作台在 API 配置中支持 DeepSeek、MiniMax 国际站、OpenAI、Anthropic Claude、Google Gemini、OpenRouter、阿里云百炼 Qwen、Ollama 以及自定义服务。选择预设后填写账户实际可用的模型 ID 和对应密钥；模型名称不锁死。图像、视频和审片保持独立服务配置。

## 三种协议

| 协议 | 基础地址后的路径 | 身份验证 | 结构化输出 |
| --- | --- | --- | --- |
| OpenAI 兼容 | `/chat/completions` | Bearer API Key | `response_format: json_object`；MiniMax 使用 `reasoning_split` 和 JSON 提示词 |
| Anthropic Messages | `/messages` | `x-api-key`、`anthropic-version`，按需工作区 ID | 提示词要求 JSON，工作台解析并执行各节点业务校验 |
| Gemini generateContent | `/models/{model}:generateContent` | `x-goog-api-key` 请求头 | `generationConfig.responseMimeType: application/json` |

这三种实现负责文本创作与审查，不代表其所有图像、工具调用或实时音频能力都已接入。OpenAI 预设使用 Chat Completions，选用支持该接口的模型；不自动切换至 Responses。自定义网关可选择匹配的协议。

## 长文本与失败处理

- “单次输出上限”是可选 Token 预算。留空沿用供应商默认；Anthropic 的 `max_tokens` 必填，工作台默认 16384。用户填写的上限仍需符合具体模型范围；更大上限不能消除上下文窗口限制。
- OpenAI 官方接口采用 `max_completion_tokens`；其他兼容服务采用 `max_tokens`；Gemini 使用 `maxOutputTokens`。
- “仅通过提示词约束 JSON”关闭可选的结构化参数，用于不支持 JSON 参数的兼容服务。返回结果仍必须通过工作台的结构和业务检查。
- 区分认证、限流、网络中断、响应截断、拒绝、空结果和格式错误。发现长度截断时不应用部分结果。
- 传输层不自动重试，也不自动切换供应商。超时不代表没有处理或没有计费。业务节点已有的有限结构修复与网络重试是不同机制。

## 本地模型与密钥

Ollama 使用 `http://localhost:11434/v1`，填写本机已经安装的模型名称。本机 OpenAI 兼容服务可以不填密钥；远程服务仍需要密钥。HTTP 仅允许 loopback 地址。

密钥由本机服务端保存且不回显。切换服务地址或预设导致实际目标域名变化时，必须重新填写或明确清除原密钥，防止将上一家服务的密钥发送到另一家。语言请求拒绝 HTTP 重定向，密钥不放在 URL 中。API 配置保存本身不发起模型生成。

## 开发边界

- `provider-catalog.ts`：可供浏览器使用的供应商元数据、协议、基础地址和官方文档链接；扩展现有协议下的新服务通常只需添加预设。
- `language-provider.ts`：协议转换、请求、响应解析和分类错误。`languageText` 保留可供节点有限修复的原始最终文本；`languageJSON` 返回 JSON 对象。二者不修改作品。
- `settings.ts`：配置验证与存储；`api-settings.tsx`：供应商选择和高级设置。
- 岗位模型覆盖当前只改变模型 ID，使用同一个已配置语言服务与密钥。不能将另一家服务的裸模型 ID 直接填入当前供应商；OpenRouter 可使用其目录中的组织/模型 ID。
- 新协议需要新增请求和响应适配，并增加不联网的认证、消息顺序、截断、错误脱敏测试；不要把协议分支散落在各专业 Agent 中。

## 核对的官方接口文档

实现于 2026-09-10 核对：[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[MiniMax OpenAI SDK](https://platform.minimax.io/docs/api-reference/text-openai-api)、[Anthropic Messages](https://platform.claude.com/docs/en/api/http/messages/create)、[Gemini generateContent](https://ai.google.dev/api/generate-content?hl=en)、[OpenRouter](https://openrouter.ai/docs/api_reference/overview)、[百炼地域与地址](https://www.alibabacloud.com/help/en/model-studio/base-url)、[Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)。供应商模型、账户权限与限制以其控制台和当前文档为准。
