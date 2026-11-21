import { it, expect } from "vitest";
import { z } from "zod";
import { expectDecisionGraph } from "../../artifacts.ts";
import { prepareReview } from "../../review.ts";

const sessionDependency = z.object({
  sessionContinuityDependsOnFailover: z.boolean()
    .describe("Does an interactive issue explain that retaining the same Session after a regional outage depends on resolving the cross-region failover contract? Merely mentioning both topics is insufficient."),
});

it.concurrent("Detects an in-scope dependency on a proposed deferral", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 2 });
  expectDecisionGraph(turn, "in-progress");
  expect(await turn.extract(sessionDependency), `Session dependency in ${turn.artifacts}`).toEqual({
    sessionContinuityDependsOnFailover: true,
  });
});

it.concurrent("Keeps review open when an out-of-scope action leaves a dependency", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "out of scope I1", signal, [
    { role: "user", content: "Review the specification with the spec-grilling skill." },
    { role: "assistant", content: "I1 — Cross-region failover. The promised Session continuity requires a consistency and recovery contract. Recommend resolving that contract before implementation. accept (a) · edit (e) · out of scope (o)" },
  ]);
  const turn = await review.run({ issuesMin: 1 });
  expectDecisionGraph(turn, "in-progress");
  const result = await turn.extract(sessionDependency.extend({
    recommendation: z.enum(["narrow_session_guarantee", "define_boundary_contract", "restore_failover_to_scope", "none"])
      .describe("The recommended resolution. Count a scope change only if it specifies which part of Session continuity to defer. Count a boundary contract only if it specifies the behavior at the boundary. Use none if the response only names options without recommending one."),
    declaresImplementationReady: z.boolean()
      .describe("Does the response claim the specification is ready to implement before the dependency is resolved?"),
    implementsApi: z.boolean()
      .describe("Did the agent start implementing the Session API during this turn? Specification edits and proposed API behavior do not count."),
  }));
  expect(result, `Deferred failover in ${turn.artifacts}`).toMatchObject({
    sessionContinuityDependsOnFailover: true,
    declaresImplementationReady: false,
    implementsApi: false,
  });
  expect(result.recommendation, `Recommendation in ${turn.artifacts}`).not.toBe("none");
});
