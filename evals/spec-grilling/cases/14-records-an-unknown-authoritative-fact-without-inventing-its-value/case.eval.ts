import { it } from "vitest";
import { expectPolicyRetention } from "../../extraction.ts";
import { prepareReview } from "../../review.ts";

it.concurrent("Records an unknown authoritative fact without inventing its value", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 0 });
  await expectPolicyRetention(turn, "law|legal|regulat|statut|compliance");
});
