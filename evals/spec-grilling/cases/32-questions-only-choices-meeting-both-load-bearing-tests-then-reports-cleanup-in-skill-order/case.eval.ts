import { expect, it } from "vitest";
import { expectClosingSections, expectDecisionGraph, graphNodes } from "../../artifacts.ts";
import { z } from "zod";
import { expectIssueActions, prepareReview } from "../../review.ts";

it.concurrent("Questions only choices meeting both load-bearing tests, then reports cleanup in skill order", {
  tags: ["must-have"],
  timeout: 2 * 540_000,
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review SPEC.md before implementation.", signal);
  const first = await review.run({ issuesMin: 1, issuesMax: 1 });
  expectIssueActions(first);
  const [ownership] = graphNodes(expectDecisionGraph(first, "in-progress").contents).filter(node => node.status === "provisional");
  expect(ownership).toBeDefined();

  const final = await review.run({ issuesMax: 0 }, `a ${ownership!.id}`);
  expectClosingSections(final, { noDeferrals: true });
  expectDecisionGraph(final, "complete");
  const topic = z.enum(["ownership", "threshold", "layout", "placeholder", "other"]);
  const owner = z.enum(["accounting", "intake", "other", "unspecified"]);
  const result = await final.extract(z.object({
    prematureCleanup: z.array(topic).describe("Cleanup items resolved in SPEC.md or the response BEFORE ownership was accepted. Exclude original fixture facts and pending items."),
    frontier: z.array(topic).describe("Every choice put to the user in the FIRST response, including bundled choices."),
    recommendation: owner.describe("Authoritative owner recommended in the first response."),
    applied: owner.describe("Authoritative owner required by the final SPEC.md."),
    impact: z.string().nullable().describe("Quote the first response's explanation of what required behavior or component responsibility changes with ownership."),
    cost: z.string().nullable().describe("Quote the first response's explanation of the cost of reversing ownership."),
    groups: z.array(z.object({
      criterion: z.enum(["strategic_only", "cost_only", "neither", "other"]),
      resolved: z.array(topic).describe("Issues for which this group reports a disposition."),
    })).describe("Cleanup groups in the FINAL RESPONSE, in printed order."),
    summary: z.array(topic).describe("Issues with a recorded disposition in the Cleanup summary of SPEC.md."),
    graphDecisions: z.array(topic).describe("Topics recorded as decision nodes in the final graph. Ignore supporting mentions."),
  }).describe(`First response before acceptance:\n${first.output}\nSPEC.md before review:\n${first.before["SPEC.md"]}\nSPEC.md before acceptance:\n${first.after["SPEC.md"]}`));
  expect(result.prematureCleanup).toEqual([]);
  expect(result.frontier).toEqual(["ownership"]);
  expect(result.recommendation).not.toBe("unspecified");
  expect(result.applied).toBe(result.recommendation);
  for (const quote of [result.impact, result.cost]) {
    expect(quote).toEqual(expect.stringMatching(/\S/));
    expect(first.output).toContain(quote);
  }
  expect(result.groups).toEqual([
    { criterion: "strategic_only", resolved: ["threshold"] },
    { criterion: "cost_only", resolved: ["layout"] },
    { criterion: "neither", resolved: ["placeholder"] },
  ]);
  expect(result.summary.sort()).toEqual(["layout", "placeholder", "threshold"]);
  expect(result.graphDecisions).toContain("ownership");
  expect(result.graphDecisions).not.toContain("threshold");
  expect(result.graphDecisions).not.toContain("layout");
  expect(result.graphDecisions).not.toContain("placeholder");
});
