import type { JudgeResult } from "vitest-evals";
import { z } from "zod";
import { gradeVerdict, verdictSchema } from "../../../scripts/skill-evals/rubric.ts";

const requiredScore = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const optionalScore = z.union([requiredScore, z.literal("N/A")]);
export const specGrillingVerdictSchema = verdictSchema.extend({
  critical_failure: z.boolean(),
  scores: z.object({
    classification: requiredScore,
    recommendation_ownership: requiredScore,
    frontier_discipline: requiredScore,
    scope_semantics: optionalScore,
    fact_discipline: requiredScore,
    cleanup_autonomy: requiredScore,
    ubiquitous_language: optionalScore,
    abstraction_level: requiredScore,
    knowledge_artifacts: optionalScore,
    author_learning: optionalScore,
  }),
  summary: z.string().min(1),
});

export function gradeSpecGrillingVerdict(value: unknown, assertions: string[]): JudgeResult {
  const verdict = specGrillingVerdictSchema.parse(value);
  const assertionResult = gradeVerdict({ assertions: verdict.assertions }, assertions);
  const scores = Object.values(verdict.scores).filter((score): score is 0 | 1 | 2 => score !== "N/A");
  const passes = !verdict.critical_failure && assertionResult.score === 1
    && verdict.scores.classification === 2
    && verdict.scores.recommendation_ownership >= 1
    && verdict.scores.frontier_discipline >= 1
    && scores.every(score => score >= 1)
    && scores.reduce<number>((sum, score) => sum + score, 0) / scores.length >= 1.6;
  return {
    score: passes ? 1 : 0,
    metadata: {
      rationale: verdict.summary,
      critical_failure: verdict.critical_failure,
      scores: verdict.scores,
      assertions: assertionResult.metadata?.assertions,
    },
  };
}
