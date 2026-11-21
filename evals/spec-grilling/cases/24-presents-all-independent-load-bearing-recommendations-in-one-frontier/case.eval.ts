import { it, expect } from "vitest";
import { expectDecisionGraph } from "../../artifacts.ts";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Presents all independent load-bearing recommendations in one frontier", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Stress-test SPEC.md. Show the decisions we need to settle first.", signal);
  const turn = await review.run({ issuesMin: 2, issuesMax: 2 });
  expectDecisionGraph(turn, "in-progress");
  const topic = z.enum(["identifier_scope", "read_authorization", "historical_identifier_resolution", "timeout", "error_copy", "other"]);
  const result = await turn.extract(z.object({
    decisions: z.array(z.object({
      topic,
      proposal: z.string().nullable().describe("Quote the concrete proposed contract, or null if absent."),
      cost: z.string().nullable().describe("Quote the later change cost for this decision, or null if absent."),
    })).describe("Every choice recommended for acceptance in the response, including bundled choices. Exclude mentions of deferred topics."),
    adopted: z.array(topic).describe("Previously open choices written as settled requirements in SPEC.md."),
  }));
  expect(result.decisions.map(decision => decision.topic).sort()).toEqual(["identifier_scope", "read_authorization"]);
  for (const { proposal, cost } of result.decisions) {
    for (const quote of [proposal, cost]) {
      expect(quote).toEqual(expect.stringMatching(/\S/));
      expect(turn.output).toContain(quote);
    }
  }
  expect(result.adopted).toEqual([]);
});
