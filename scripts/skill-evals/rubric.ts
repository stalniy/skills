import type { JudgeResult } from "vitest-evals";
import { z } from "zod";

export const verdictSchema = z.object({
  assertions: z.array(z.object({
    index: z.number().int().nonnegative(),
    status: z.enum(["pass", "fail", "not-observed"]),
    evidence: z.string().min(1),
  })).min(1),
});

export function gradeVerdict(value: unknown, assertions: string[]): JudgeResult {
  const verdict = verdictSchema.parse(value);
  const indices = verdict.assertions.map(item => item.index);
  if (indices.length !== assertions.length || new Set(indices).size !== assertions.length
    || indices.some(index => index >= assertions.length)) {
    throw new Error("Judge must return exactly one verdict for every assertion");
  }
  const failed = verdict.assertions.filter(item => item.status !== "pass");
  return {
    score: failed.length === 0 ? 1 : 0,
    metadata: {
      rationale: failed.length === 0
        ? `All ${assertions.length} assertions passed`
        : failed.map(item => `${assertions[item.index]}: ${item.status} — ${item.evidence}`).join("\n"),
      assertions: verdict.assertions.map(item => ({ ...item, assertion: assertions[item.index]! })),
    },
  };
}
