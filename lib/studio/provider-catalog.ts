/** Browser-safe provider metadata. Protocol implementations live in language-provider.ts. */
export const languageProtocols = [
  { id: 'openai', label: 'OpenAI 兼容 · Chat Completions' },
  { id: 'anthropic', label: 'Anthropic · Messages' },
  { id: 'gemini', label: 'Google Gemini · generateContent' },
] as const;
export type LanguageProtocol = typeof languageProtocols[number]['id'];
export type LanguagePreset = {
  id: string; name: string; protocol: LanguageProtocol; baseUrl: string;
  description: string; docs: string; modelHint: string;
};
export const languagePresets: readonly LanguagePreset[] = [
  { id:'custom', name:'自定义 / 保留现有设置', protocol:'openai', baseUrl:'', description:'使用兼容接口或代理服务，手动填写协议、基础地址和账户可用模型。', docs:'', modelHint:'供应商提供的完整模型 ID' },
  { id:'deepseek', name:'DeepSeek', protocol:'openai', baseUrl:'https://api.deepseek.com', description:'DeepSeek 官方语言模型接口；使用 DeepSeek 独立 API 密钥。', docs:'https://api-docs.deepseek.com/guides/json_mode/', modelHint:'DeepSeek 控制台可用的模型 ID' },
  { id:'minimax', name:'MiniMax 国际站 · 语言模型', protocol:'openai', baseUrl:'https://api.minimax.io/v1', description:'MiniMax 国际站语言模型接口。视频 H3 在视频服务中单独选择。', docs:'https://platform.minimax.io/docs/api-reference/text-openai-api', modelHint:'MiniMax 控制台的语言模型 ID，不能填写视频 H3' },
  { id:'openai', name:'OpenAI', protocol:'openai', baseUrl:'https://api.openai.com/v1', description:'使用支持 Chat Completions 的 OpenAI 模型。ChatGPT 订阅与 API 账单分开。', docs:'https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create', modelHint:'支持 Chat Completions 的模型 ID' },
  { id:'anthropic', name:'Anthropic · Claude', protocol:'anthropic', baseUrl:'https://api.anthropic.com/v1', description:'直接使用 Claude Messages 接口；使用 Anthropic API 密钥。', docs:'https://platform.claude.com/docs/en/api/http/messages/create', modelHint:'Anthropic 控制台可用的完整模型 ID' },
  { id:'gemini', name:'Google · Gemini', protocol:'gemini', baseUrl:'https://generativelanguage.googleapis.com/v1beta', description:'Google AI Studio 的 Gemini Developer API，支持返回结构化文本的模型。', docs:'https://ai.google.dev/api/generate-content?hl=en', modelHint:'Gemini 模型 ID，可省略 models/ 前缀' },
  { id:'openrouter', name:'OpenRouter · 多模型入口', protocol:'openai', baseUrl:'https://openrouter.ai/api/v1', description:'通过 OpenRouter 选择其目录中的模型；使用 OpenRouter 密钥和带组织前缀的模型 ID。', docs:'https://openrouter.ai/docs/api_reference/overview', modelHint:'组织/模型 ID（以 OpenRouter 模型目录为准）' },
  { id:'qwen', name:'阿里云百炼 · Qwen', protocol:'openai', baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1', description:'默认北京地域共享地址。其他地域或工作区专属域名请在下方修改基础地址，密钥必须与地域和计费方案匹配。', docs:'https://www.alibabacloud.com/help/en/model-studio/base-url', modelHint:'百炼控制台可用的通用语言模型 ID' },
  { id:'ollama', name:'Ollama · 本地模型', protocol:'openai', baseUrl:'http://localhost:11434/v1', description:'使用已安装并运行的 Ollama 模型。本机地址可不填密钥，远程服务仍须配置鉴权。', docs:'https://docs.ollama.com/api/openai-compatibility', modelHint:'本机已下载的模型名，包含版本标签（如有）' },
];
export function languagePreset(id:string):LanguagePreset {
  return languagePresets.find(p=>p.id===id)??languagePresets[0];
}
export function detectLanguagePreset(baseUrl:string):string {
  try {
    const target=new URL(baseUrl);
    const found=languagePresets.find(p=>p.baseUrl&&new URL(p.baseUrl).origin===target.origin);
    return found?.id??'custom';
  } catch { return 'custom'; }
}
export function isLocalLanguageUrl(baseUrl:string):boolean {
  try { return ['localhost','127.0.0.1','[::1]'].includes(new URL(baseUrl).hostname); } catch { return false; }
}
