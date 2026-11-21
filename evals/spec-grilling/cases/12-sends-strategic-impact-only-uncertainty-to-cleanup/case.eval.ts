import { expect, it } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Sends strategic-impact-only uncertainty to cleanup", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 0 });
  const result = await turn.extract(z.object({
    threshold: z.enum(["configurable", "fixed", "unspecified"]).describe("How the response or its reported changes treat the confidence threshold."),
    policy_value: z.string().nullable().describe("Any threshold value asserted to be policy or an authoritative Product selection. Exclude proposed local defaults."),
    author_requests: z.array(z.string()).describe("Any requests for the author to choose the threshold."),
  }));
  expect(result).toEqual({ threshold: "configurable", policy_value: null, author_requests: [] });
});
