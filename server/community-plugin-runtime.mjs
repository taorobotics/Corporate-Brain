// Company adapters retain upstream MIT notices in server/vendor and THIRD_PARTY_NOTICES.txt.
import { defineTool } from "@deepseek-ai/dsh-tools";
import { evaluate } from "./vendor/calculator.mjs";

export const name = "corporate-community-plugins";
export const inject = ["tools"];

export function paceResult({ distance, minutes, seconds = 0 }) {
  if (
    !Number.isFinite(distance) ||
    distance <= 0 ||
    distance > 10000 ||
    !Number.isFinite(minutes) ||
    minutes < 0 ||
    minutes > 100000 ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds >= 60 ||
    minutes * 60 + seconds <= 0
  )
    throw Error("请提供有效距离与时间。");
  const total = minutes * 60 + seconds;
  const pace = Math.round(total / distance);
  return {
    distanceKm: distance,
    pace: `${Math.floor(pace / 60)}分${String(pace % 60).padStart(2, "0")}秒/公里`,
    speedKmh: Math.round((distance / (total / 3600)) * 100) / 100,
  };
}

export function apply(ctx, config) {
  const ids = new Set(config?.plugins ?? []);
  if ([...ids].some((id) => !["calculator", "pace-calc"].includes(id)))
    throw Error("Unsupported company plugin adapter");
  const definitions = [];
  if (ids.has("calculator"))
    definitions.push(
      defineTool({
        name: "calculator",
        description:
          "公司大脑开源社区插件：计算数学表达式。支持 + - * / % **、括号、sqrt、pow、abs、round、min、max、log 等函数及 PI、E。浮点运算，不用于财务精确结算。",
        parameters: {
          expression: {
            type: "string",
            required: true,
            description: "最多500字符，例如 (15+27)*sqrt(9)",
          },
        },
        output: {
          schema: { type: "number" },
          render: (_args, value) => [{ type: "text", text: String(value) }],
        },
        execute: async ({ expression }) => evaluate(expression),
        timeoutMs: 1000,
      }),
    );
  if (ids.has("pace-calc"))
    definitions.push(
      defineTool({
        name: "pace_calc",
        description: "公司大脑开源社区插件：根据跑步距离和时间计算配速与速度。",
        parameters: {
          distance: {
            type: "number",
            required: true,
            description: "距离，公里，必须大于0",
          },
          minutes: {
            type: "number",
            required: true,
            description: "分钟数，不小于0",
          },
          seconds: { type: "number", description: "剩余秒数，0至59，默认0" },
        },
        output: {
          schema: { type: "json" },
          render: (_args, value) => [
            { type: "text", text: JSON.stringify(value) },
          ],
        },
        execute: async (args) => paceResult(args),
        timeoutMs: 1000,
      }),
    );
  for (const definition of definitions)
    ctx.effect(() => ctx.tools.register(definition));
}
