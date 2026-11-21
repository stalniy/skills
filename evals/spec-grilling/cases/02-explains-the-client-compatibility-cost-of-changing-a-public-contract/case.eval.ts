import { expect, it } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Explains the client compatibility cost of changing a public contract", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 2 });
  const result = await turn.extract(z.object({
    completion: z.enum(["synchronous", "asynchronous", "none"]).describe("The single recommended public completion contract for POST /reports. Use none if the response only lists alternatives."),
    acceptance: z.enum(["pending", "accepted", "unspecified"]).describe("Whether the recommendation is open for review or already accepted."),
    laterChange: z.array(z.enum(["client_integration", "internal_only", "other"])).describe("Areas the response says would need to change if the API switched completion semantics after adoption."),
  }));
  expect(result.completion).toMatch(/^(synchronous|asynchronous)$/);
  expect(result.acceptance).toBe("pending");
  expect(result.laterChange).toContain("client_integration");
});
