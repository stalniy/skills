import { expect, it } from "vitest";
import { z } from "zod";
import { expectIssueActions, prepareReview } from "../../review.ts";

it.concurrent("Presents an unresolved choice as a provisional behavioral recommendation", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review SPEC.md before implementation.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 1 });
  expectIssueActions(turn);
  const result = await turn.extract(z.object({
    issue: z.enum(["state_ownership", "other", "none"])
      .describe("Does the interactive issue concern ownership of authoritative execution state?"),
    recommendedOwner: z.enum(["orchestrator", "steps", "shared", "unspecified"])
      .describe("Recommended authoritative owner for execution state."),
    restartSource: z.enum(["orchestrator_state", "step_state", "reconciled_state", "unspecified"])
      .describe("Recommended source of state on restart."),
    decisionStatus: z.enum(["provisional", "accepted"])
      .describe("Whether the response presents the decision as open or accepted."),
    requiredMechanisms: z.array(z.string())
      .describe("Storage technologies or locking mechanisms imposed by the recommendation. Exclude mechanisms mentioned only to reject them."),
  }));
  expect(result, `Ownership in ${turn.artifacts}`).toMatchObject({
    issue: "state_ownership",
    decisionStatus: "provisional",
    requiredMechanisms: [],
  });
  const restartByOwner = {
    orchestrator: "orchestrator_state",
    steps: "step_state",
    shared: "reconciled_state",
    unspecified: null,
  } as const;
  expect(result.restartSource).toBe(restartByOwner[result.recommendedOwner]);
});
