import { it } from "vitest";
import { expectAutonomousCleanup } from "../../extraction.ts";
import { prepareReview } from "../../review.ts";

it.concurrent("Sends high-change-cost-only uncertainty to cleanup", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 0 });
  await expectAutonomousCleanup(turn, "the implementation team’s physical partitioning layout");
});
