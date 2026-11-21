import { expect, it } from "vitest";
import { z } from "zod";
import { expectDecisionGraph } from "../../artifacts.ts";
import { prepareReview } from "../../review.ts";

it.concurrent("Reopens scope when retained behavior needs a deferred decision", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "S1 is out of scope. Keep offline purchases in this release and finish the review.", signal, [
    { role: "assistant", content: "S1 — Inventory ownership. Offline sales need an authoritative owner; changing it later requires data migration. Recommendation: make the cloud authoritative for inventory. accept · edit · out of scope" },
  ]);
  const turn = await review.run({ issuesMin: 1, issuesMax: 2 });
  expectDecisionGraph(turn, "in-progress");
  const result = await turn.extract(z.object({
    offlinePurchases: z.enum(["in_scope", "removed", "unspecified"]).describe("Scope of offline purchases in the saved SPEC.md."),
    ownership: z.enum(["deferred", "accepted", "unspecified"]).describe("Disposition of the original ownership recommendation in the response and graph."),
    blockedBehavior: z.string().nullable().describe("Quote the in-scope offline behavior the response says depends on ownership."),
    recommendation: z.enum(["boundary_contract", "scope_change", "reopen_ownership", "none"]).describe("Concrete next decision recommended to unblock the dependency."),
    ready: z.boolean().describe("Does the response declare the spec ready for implementation?"),
  }));
  expect(result).toMatchObject({ offlinePurchases: "in_scope", ownership: "deferred", ready: false });
  expect(result.blockedBehavior).toEqual(expect.stringMatching(/\S/));
  expect(turn.output).toContain(result.blockedBehavior);
  expect(result.recommendation).not.toBe("none");
});
