import { expect, it } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Preserves distinct technical and domain meanings during normalization", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 0 });
  expect(turn.after["SPEC.md"]).toMatch(/\bredo\b/i);
  expect(turn.after["SPEC.md"]).toMatch(/\bretr(?:y|ies)\b/i);
  const result = await turn.extract(z.object({
    workflow_redo: z.enum(["resume_earlier_step", "repeat_http_request", "unspecified"]).describe("Meaning of Workflow redo in the resulting specification."),
    http_retry: z.enum(["repeat_http_request", "resume_earlier_step", "unspecified"]).describe("Meaning of transport retry in the resulting specification."),
    http_retry_count: z.enum(["configured", "fixed", "unspecified"]).describe("How many times the HTTP client retries, as specified."),
  }));
  expect(result).toEqual({
    workflow_redo: "resume_earlier_step",
    http_retry: "repeat_http_request",
    http_retry_count: "configured",
  });
});
