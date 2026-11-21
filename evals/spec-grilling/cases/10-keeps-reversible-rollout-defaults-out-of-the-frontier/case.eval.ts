import { it } from "vitest";
import { expectAutonomousCleanup } from "../../extraction.ts";
import { prepareReview } from "../../review.ts";

it.concurrent("Keeps reversible rollout defaults out of the frontier", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 0 });
  await expectAutonomousCleanup(turn, "the runtime feature flag default");
});
