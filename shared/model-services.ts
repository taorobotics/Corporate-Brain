export const modelProviders = [
  {
    id: "linoroute",
    name: "LinoRoute",
    baseUrl: "https://linoroute.com/v1",
    recommended: true,
    hint: "一次配置，选择多个模型",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    hint: "DeepSeek 官方",
  },
  {
    id: "kimi",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    hint: "月之暗面官方",
  },
  {
    id: "qwen",
    name: "千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    hint: "阿里云百炼 · 北京",
  },
  {
    id: "hunyuan",
    name: "腾讯混元",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    hint: "腾讯混元官方",
  },
  {
    id: "zhipu",
    name: "智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    hint: "智谱开放平台",
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    hint: "MiniMax 中国区官方",
  },
  {
    id: "openai",
    name: "OpenAI / GPT",
    baseUrl: "https://api.openai.com/v1",
    hint: "OpenAI 官方",
  },
  {
    id: "gemini",
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    hint: "Google 官方兼容接口",
  },
  {
    id: "claude",
    name: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    hint: "Anthropic 官方兼容接口",
  },
  { id: "custom", name: "自定义服务", baseUrl: "", hint: "OpenAI 兼容接口" },
] as const;
export type ModelProviderId = (typeof modelProviders)[number]["id"];
export type ServiceModel = { model: string; kind: "chat" | "image" };
export type ModelService = {
  personal?: boolean;
  sourceServiceId?: string;
  id: string;
  provider: ModelProviderId;
  name: string;
  baseUrl: string;
  hasKey: boolean;
  departments: string[];
  models: ServiceModel[];
};
