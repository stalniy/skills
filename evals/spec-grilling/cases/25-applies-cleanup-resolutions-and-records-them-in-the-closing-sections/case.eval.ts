import { expect, it } from "vitest";
import { expectClosingSections } from "../../artifacts.ts";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Applies cleanup resolutions and records them in the closing sections", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Refine SPEC.md and apply the changes. All strategic decisions are already accepted.", signal);
  const turn = await review.run({ issuesMax: 0 });
  expectClosingSections(turn, { noDeferrals: true });
  expect(turn.after["SPEC.md"]).not.toBe(turn.before["SPEC.md"]);
  const topic = z.enum(["refresh", "timeout", "sort_order", "error_copy", "terminology", "other"]);
  const result = await turn.extract(z.object({
    summary: z.array(topic).describe("Topics with a resolution in the Cleanup summary of SPEC.md."),
    reported: z.array(topic).describe("Topics with a resolution in the response's cleanup report."),
    entity: z.enum(["Export", "snapshot", "other"]).describe("Domain term used in the updated requirement for displaying status."),
    approvals: z.array(z.string()).describe("Any decisions the response asks the author to make."),
    cleanup_adrs: z.array(z.string())
      .describe("Paths of ADRs that record refresh, timeout, sort order, error copy, or other reversible cleanup choices as strategic decisions. An ADR that only documents the existing API boundary does not count."),
    new_architecture: z.array(z.string())
      .describe("New architectural decisions adopted in SPEC.md, the decision graph, or any ADR. The original design uses the existing export API and requires no new storage or public API. Exclude restatements of that design, factual dependencies, and rejected alternatives."),
  }).describe("Read the saved files for artifact fields and use the previous response for response fields. Extract only what is stated."));
  for (const topics of [result.summary, result.reported]) {
    expect(topics).toEqual(expect.arrayContaining(["refresh", "timeout", "sort_order", "error_copy"]));
  }
  expect(result.entity).toBe("Export");
  expect(result.approvals).toEqual([]);
  expect(result.cleanup_adrs, `ADRs for reversible cleanup in ${turn.artifacts}`).toEqual([]);
  expect(result.new_architecture, `New architectural decisions in ${turn.artifacts}`).toEqual([]);
});
