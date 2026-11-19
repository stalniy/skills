import { z } from "zod";

export const harnessSchema = z.enum(["pi", "codex", "copilot"]);

// https://docs.github.com/en/copilot/reference/ai-models/supported-models
// GitHub Copilot models available in both CLI and VS Code agent mode, using CLI model IDs.
export const copilotModelSchema = z.enum([
  "claude-haiku-4.5",
  "claude-haiku-5.5",
  "claude-sonnet-4.6",
  "claude-sonnet-5",
  "claude-sonnet-5.5",
  "gemini-3.8-flash",
  "gemini-4-hydrogen",
  "gpt-5.3-codex",
  "gpt-5.6-luna",
  "gpt-6-luna",
  "gpt-6.1-terra",
  "grok-4.5",
  "grok-4.6",
  "grok-4.7",
  "kimi-k3",
  "mai-code-1.1-flash",
  "mai-code-2",
  "mai-code-2-flash",
]);

export function evalConfigSchema(judgeThinking: "medium" | "high") {
  return z.object({
    SKILL_HARNESS: harnessSchema.default("pi"),
    SKILL_MODEL: z.string().default("openrouter/deepseek/deepseek-v4.1-flash"),
    SKILL_MODEL_THINKING: z.string().default("medium"),
    SKILL_RUN_DIR: z.string().optional(),
    JUDGE_HARNESS: harnessSchema.default("codex"),
    JUDGE_MODEL: z.string().default("gpt-6-sol"),
    JUDGE_MODEL_THINKING: z.string().default(judgeThinking),
  }).superRefine((config, context) => {
    for (const [harness, model, field] of [
      [config.SKILL_HARNESS, config.SKILL_MODEL, "SKILL_MODEL"],
      [config.JUDGE_HARNESS, config.JUDGE_MODEL, "JUDGE_MODEL"],
    ] as const) {
      if (harness === "copilot" && !copilotModelSchema.safeParse(model).success) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `Unsupported Copilot model ${JSON.stringify(model)}. Choose a VS Code agent-mode model: ${copilotModelSchema.options.join(", ")}`,
        });
      }
    }
  });
}
