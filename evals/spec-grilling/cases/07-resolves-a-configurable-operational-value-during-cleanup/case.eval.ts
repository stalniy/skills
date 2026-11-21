import { it } from "vitest";
import { expectAutonomousCleanup } from "../../extraction.ts";
import { prepareReview } from "../../review.ts";

it.concurrent("Resolves a configurable operational value during cleanup", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 0 });
  await expectAutonomousCleanup(turn, "the configurable Verification timeout");
});
