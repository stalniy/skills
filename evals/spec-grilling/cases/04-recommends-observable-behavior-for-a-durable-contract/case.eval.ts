import { expect, it } from "vitest";
import { z } from "zod";
import { expectIssueActions, prepareReview } from "../../review.ts";

it.concurrent("Recommends observable behavior for a durable contract", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 2 });
  expectIssueActions(turn);
  const result = await turn.extract(z.object({
    duplicate_response: z.enum(["existing_order", "stable_duplicate_response", "unspecified", "other"])
      .describe("What the recommendation says callers receive when they reuse the same request key. A stable success or error response that identifies the request as a duplicate qualifies as a stable duplicate response."),
    clientWorkflowDependency: z.boolean().describe("Whether the response ties a later duplicate-response change to compatibility with public clients or their workflows."),
    authorDesignQuestions: z.array(z.string()).describe("Any question asking the author to choose the duplicate-request behavior without a concrete recommendation."),
  }));
  expect(result.duplicate_response).toMatch(/^(existing_order|stable_duplicate_response)$/);
  expect(result.clientWorkflowDependency).toBe(true);
  expect(result.authorDesignQuestions).toEqual([]);
});
