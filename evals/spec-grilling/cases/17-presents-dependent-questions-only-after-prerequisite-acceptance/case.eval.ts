import { it, expect } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Withholds a dependent question while its prerequisite is open", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 1 });
  const result = await turn.extract(z.object({
    recommended: z.array(z.enum(["identity", "key_scope", "other"]))
      .describe("All choices for which the response requests a decision, including choices bundled in one issue."),
  }));
  expect(result.recommended).toEqual(["identity"]);
});

it.concurrent("Presents a dependent question once its prerequisite is accepted", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "a I1", signal, [
    { role: "user", content: "Review the specification with the spec-grilling skill." },
    { role: "assistant", content: "I1 — Job identity. Recommend that a retry retain the same Job identity; an Attempt records each execution. The idempotency-key scope depends on this choice. accept · edit · out of scope" },
  ]);
  const turn = await review.run({ issuesMin: 1, issuesMax: 2 });
  const result = await turn.extract(z.object({
    identity: z.enum(["same_job", "new_job", "undecided"]).describe("Job identity on retry required by the updated SPEC.md."),
    keyScope: z.enum(["job", "attempt", "other_concrete_scope", "undecided"]).describe("The key scope proposed for acceptance in this response."),
    reversalCost: z.string().nullable().describe("Quote the stated cost of changing key scope after adoption, or null if absent."),
  }));
  expect(result.identity).toBe("same_job");
  expect(result.keyScope).not.toBe("undecided");
  expect(result.reversalCost).toEqual(expect.stringMatching(/\S/));
  expect(turn.output).toContain(result.reversalCost);
});
