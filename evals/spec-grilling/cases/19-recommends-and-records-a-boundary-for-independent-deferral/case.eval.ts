import { it, expect } from "vitest";
import { z } from "zod";
import { expectClosingSections, expectDecisionGraph, graphNodes } from "../../artifacts.ts";
import { prepareReview } from "../../review.ts";

const reviewPrompt = "Review the specification with the spec-grilling skill. Treat cross-region failover as a design concern that has not yet been scoped.";

it.concurrent("Recommends a boundary for an independently deferrable concern", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, reviewPrompt, signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 2 });
  const result = await turn.extract(z.object({
    failoverScope: z.enum(["later_release", "current_release", "unspecified"])
      .describe("The scope recommended for cross-region failover in an interactive issue. Use unspecified if there is no such recommendation."),
    exportScope: z.enum(["single_region", "multi_region", "unspecified"])
      .describe("The recommended scope for export in the initial release."),
    exportDependsOnFailover: z.boolean().nullable()
      .describe("Whether the initial release needs cross-region failover to export correctly, as stated or implied by the recommendation. Use null if the recommendation leaves that dependency unclear."),
  }));
  expect(result, `Recommended scope in ${turn.artifacts}`).toEqual({
    failoverScope: "later_release",
    exportScope: "single_region",
    exportDependsOnFailover: false,
  });
});

it.concurrent("Records an out-of-scope action and completes behind its boundary", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "o I1", signal, [
    { role: "user", content: reviewPrompt },
    { role: "assistant", content: "🔎 **I1 — Cross-region failover**. A later failover design would affect replication and consistency. Recommend limiting this release to one region and deferring cross-region failover. accept (a) · edit (e) · out of scope (o)" },
  ]);
  const turn = await review.run({ issuesMax: 0 });
  expectClosingSections(turn);
  const graph = expectDecisionGraph(turn, "complete");
  expect(graphNodes(graph.contents), `Deferred decision in ${turn.artifacts}`).toContainEqual({
    id: "I1",
    status: "out-of-scope",
    dependsOn: [],
  });

  const result = await turn.extract(z.object({
    deferredConcerns: z.array(z.enum(["cross_region_failover", "other"]))
      .describe("Concerns listed as deferred in the Out of scope section of SPEC.md."),
    exportScope: z.enum(["single_region", "multi_region", "unspecified"])
      .describe("The initial release's export scope stated in the requirements of SPEC.md, excluding its closing sections."),
  }).describe("Extract the scope from the updated SPEC.md in the workspace."));
  expect(result, `Written scope in ${turn.artifacts}`).toEqual({
    deferredConcerns: ["cross_region_failover"],
    exportScope: "single_region",
  });
});
