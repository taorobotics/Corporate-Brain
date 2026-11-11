export type CommunityPlugin = {
  id: string;
  name: string;
  description: string;
  author: string;
  repository: string;
  category: string;
  version: string;
  license: string;
  revision?: string;
  availability: "adapted" | "pending";
  installed: boolean;
  enabled: boolean;
};

export const COMMUNITY_ADAPTERS = [
  {
    id: "calculator",
    name: "数学计算器",
    description:
      "在 AI 对话中准确计算四则运算、幂、开方和常用函数。表达式在公司服务内处理，无需额外 API。采用浮点数计算，不用于财务精确结算。",
    author: "omdsh-dev / whiteicey",
    repository: "https://github.com/omdsh-dev/dsh-tool-calculator",
    category: "工具与能力",
    version: "1.0.0",
    license: "MIT",
    revision: "b2007a13f06bcf75bf07b9d277ee8d434a316490",
  },
  {
    id: "pace-calc",
    name: "跑步配速计算",
    description:
      "根据跑步距离与时间计算配速和速度。在对话中提出相关问题即可按需调用。",
    author: "uckkk / istone",
    repository: "https://github.com/uckkk/dsh-pace-calc",
    category: "工具与能力",
    version: "1.0.0",
    license: "MIT",
    revision: "npm:dsh-pace-calc@0.1.1",
  },
] as const;

export type CommunityPluginPage = {
  items: CommunityPlugin[];
  total: number;
  categories: string[];
  fetchedAt: string | null;
  warning?: string;
  source: string;
};
