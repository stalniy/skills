import { expect, it } from "vitest";
import { z } from "zod";
import { expectIssueActions, prepareReview } from "../../review.ts";

it.concurrent("Offers a concrete guarantee when clients depend on repeatable behavior", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 2 });
  expectIssueActions(turn);
  const result = await turn.extract(z.object({
    duplicatePayment: z.enum(["prevented", "allowed", "unspecified"]).describe("Whether the recommended POST /payments contract prevents, allows, or leaves open creation of a second Payment from a retry of the same logical request."),
    clientDependency: z.boolean().describe("Whether the response ties the guarantee to behavior that clients rely on and would need to accommodate if the contract changed."),
    authorDesignQuestions: z.array(z.string()).describe("Any questions that ask the author to design idempotency instead of deciding on a proposed contract."),
  }));
  expect(result).toEqual({ duplicatePayment: "prevented", clientDependency: true, authorDesignQuestions: [] });
});
