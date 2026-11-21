import { expect, it } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Uses authoritative facts and records remaining factual dependencies", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review and clean up SPEC.md using the repository evidence.", signal);
  const turn = await review.run({ issuesMax: 0 });
  const result = await turn.extract(z.object({
    batch_limit: z.number().nullable().describe("The maximum audit events per batch that the response incorporates into SPEC.md or references from the archive contract."),
    retention_source: z.enum(["company_records_policy", "other", "unspecified"]).describe("The source the response identifies as authoritative for the retention value."),
    retention_treatment: z.enum(["configuration", "design_decision", "fixed", "unspecified"]).describe("How the response and resulting specification treat retention while the policy value is unavailable."),
    retention_value: z.string().nullable().describe("A duration the response or its SPEC.md changes claim or adopt. Exclude durations explicitly rejected."),
    retention_policy_available: z.boolean().nullable().describe("Whether the response reports the authoritative policy value is available. Return null when no availability is reported."),
    claims_legal_compliance: z.boolean().describe("Whether the response asserts legal compliance has been established."),
    author_requests: z.array(z.string()).describe("Any requests to supply or choose the operational limit or retention setting."),
  }));
  expect(result).toEqual({
    batch_limit: 500,
    retention_source: "company_records_policy",
    retention_treatment: "configuration",
    retention_value: null,
    retention_policy_available: false,
    claims_legal_compliance: false,
    author_requests: [],
  });
});
