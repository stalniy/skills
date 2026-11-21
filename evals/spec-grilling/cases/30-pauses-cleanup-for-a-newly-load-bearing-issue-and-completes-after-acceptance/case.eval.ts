import { it, expect } from "vitest";
import { expectClosingSections, expectDecisionGraph, graphNodes } from "../../artifacts.ts";
import { z } from "zod";
import { expectIssueActions, prepareReview } from "../../review.ts";

it.concurrent("Pauses cleanup for a newly load-bearing issue and completes after acceptance", {
  timeout: 2 * 540_000,
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "One detail about that timeout: the provider can charge us before the timeout reaches us. The provider offers no duplicate suppression. Continue the review.", signal, [
    { role: "user", content: "Review the payment retry specification." },
    { role: "assistant", content: "The remaining cleanup item is a configurable default for the retry count." },
  ]);
  const turn = await review.run({ issuesMin: 1, issuesMax: 1 });
  expectIssueActions(turn);
  const open = expectDecisionGraph(turn, "in-progress");
  const issue = graphNodes(open.contents).find(node => node.status === "provisional");
  expect(issue).toBeDefined();


  const final = await review.run({ issuesMax: 0 }, `a ${issue!.id}`);
  const closed = expectDecisionGraph(final, "complete");
  expect(closed.path).toBe(open.path);
  expect(graphNodes(closed.contents)).toContainEqual({ ...issue, status: "accepted" });
  expectClosingSections(final, { noDeferrals: true });
  const guarantee = z.enum(["no_blind_retry", "reconcile_before_retry", "other_concrete_duplicate_protection", "provider_suppression", "unspecified"]);
  const result = await final.extract(z.object({
    requested: z.array(z.enum(["duplicate_charge_contract", "retry_count", "other"])).describe("Every choice the first response asks the user to decide, including bundled choices."),
    prematureDefault: z.string().nullable().describe("Retry-count default selected in the first response or pre-acceptance spec; null if it remains open."),
    proposed: guarantee.describe("Duplicate-charge protection proposed for acceptance in the first response."),
    required: guarantee.describe("Duplicate-charge protection now required by SPEC.md."),
    reversalCost: z.string().nullable().describe("Quote the first response's explanation of the cost of reversing this choice."),
    specCleanup: z.string().nullable().describe("Quote the retry-count resolution in the specification cleanup summary."),
    reportedCleanup: z.string().nullable().describe("Quote the retry-count resolution in the final response."),
  }).describe(`First response before acceptance:\n${turn.output}\nPre-acceptance SPEC.md:\n${turn.after["SPEC.md"]}`));
  expect(result.requested).toEqual(["duplicate_charge_contract"]);
  expect(result.prematureDefault).toBeNull();
  expect(["no_blind_retry", "reconcile_before_retry", "other_concrete_duplicate_protection"]).toContain(result.proposed);
  expect(result.required).toBe(result.proposed);
  for (const [source, quote] of [
    [turn.output, result.reversalCost],
    [final.after["SPEC.md"]?.split(/^## Cleanup summary\s*$/m)[1], result.specCleanup],
    [final.output, result.reportedCleanup],
  ]) {
    expect(quote).toEqual(expect.stringMatching(/\S/));
    expect(source).toContain(quote);
  }
});
