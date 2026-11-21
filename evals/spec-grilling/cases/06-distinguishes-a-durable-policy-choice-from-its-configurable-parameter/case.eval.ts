import { expect, it } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Distinguishes a durable policy choice from its configurable parameter", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 1 });
  const result = await turn.extract(z.object({
    retentionPolicy: z.enum(["finite", "permanent", "both", "none"])
      .describe("The retention policy proposed for acceptance. A configurable finite period is finite. Use both if the recommendation supports both policies, or none if no policy is recommended."),
    asksAuthorToSetDuration: z.boolean()
      .describe("Whether the response asks the author to choose or approve a retention duration, including within the policy recommendation."),
    keepsFiniteDurationConfigurable: z.boolean()
      .describe("Whether the finite retention recommendation leaves the duration configurable by operators. Return false if it mandates a fixed duration or does not describe an operator setting. An adjustable default still counts as configurable."),
    strategicImpact: z.string().nullable()
      .describe("Quote how choosing finite versus permanent retention materially changes the system or its guarantees. Use null if absent."),
    reversalCost: z.string().nullable()
      .describe("Quote what would make switching retention policies after rollout costly. Use null if absent."),
  }));
  expect(["finite", "permanent"]).toContain(result.retentionPolicy);
  expect(result.asksAuthorToSetDuration, "Whether the author must decide the duration").toBe(false);
  expect(result.keepsFiniteDurationConfigurable, "Whether operators can set the finite duration").toBe(result.retentionPolicy === "finite");
  expect(result.strategicImpact, "Strategic impact of the retention policy").toEqual(expect.stringMatching(/\S/));
  expect(result.reversalCost, "Cost of reversing the retention policy").toEqual(expect.stringMatching(/\S/));
  expect(turn.output).toContain(result.strategicImpact);
  expect(turn.output).toContain(result.reversalCost);
});
