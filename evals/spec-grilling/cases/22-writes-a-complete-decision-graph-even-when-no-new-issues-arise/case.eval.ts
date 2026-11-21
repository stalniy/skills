import { it, expect } from "vitest";
import { expectDecisionGraph, graphNodes } from "../../artifacts.ts";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Writes a complete decision graph when no new issues arise", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 0 });
  const graph = expectDecisionGraph(turn, "complete");
  const nodes = graphNodes(graph.contents);
  expect(nodes.length).toBeGreaterThan(0);
  expect(nodes.every(node => node.status === "accepted" || node.status === "out-of-scope")).toBe(true);
  const result = await turn.extract(z.object({
    authority: z.enum(["auth_service", "other", "unspecified"]).describe("Owner of refresh-token state required by the spec."),
    successes: z.number().nullable().describe("Maximum successes for concurrent requests using the same refresh token in SPEC.md."),
    reusedTokenError: z.string().nullable().describe("Public error code required for a reused token."),
  }));
  expect(result).toEqual({
    authority: "auth_service",
    successes: 1,
    reusedTokenError: "TOKEN_ALREADY_USED"
  });
});
