import { expect, it } from "vitest";
import { expectAutonomousCleanup } from "../../extraction.ts";
import { prepareReview } from "../../review.ts";

it.concurrent("Resolves local wording without involving the author", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 0 });
  expect(turn.after["SPEC.md"]).toContain("INVALID_EMAIL");
  await expectAutonomousCleanup(turn, "the non-contractual validation message wording");
});
