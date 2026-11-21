import { it } from "vitest";
import { expectPolicyRetention } from "../../extraction.ts";
import { prepareReview } from "../../review.ts";

it.concurrent("Parameterizes an unknown non-load-bearing value", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 0 });
  await expectPolicyRetention(turn, "policy|compliance");
});
