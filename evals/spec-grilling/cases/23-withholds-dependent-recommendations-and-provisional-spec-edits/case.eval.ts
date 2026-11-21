import { it, expect } from "vitest";
import { z } from "zod";
import { expectIssueActions, prepareReview } from "../../review.ts";

it.concurrent("Withholds dependent recommendations and provisional spec edits", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review SPEC.md before implementation. Apply changes once we agree on the strategic decisions.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 2 });
  expectIssueActions(turn);
  const result = await turn.extract(z.object({
    owner: z.enum(["cloud", "shop", "partitioned", "other", "unspecified"]).describe("Recommended authority for inventory."),
    choices: z.array(z.enum(["ownership", "reconciliation", "refresh", "other"])).describe("Every decision presented for approval, including bundled choices."),
    cost: z.string().nullable().describe("Quote the later migration or coordination cost stated for changing ownership, or null if absent."),
    settledOwner: z.string().nullable().describe("Owner required by the current SPEC.md, excluding proposals. Null if undecided."),
  }));
  expect(result.choices).toEqual(["ownership"]);
  expect(result.owner).not.toBe("unspecified");
  expect(result.cost).toEqual(expect.stringMatching(/\S/));
  expect(turn.output).toContain(result.cost);
  expect(result.settledOwner).toBeNull();
});
