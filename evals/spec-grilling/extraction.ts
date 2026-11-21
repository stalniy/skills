import { expect } from "vitest";
import { z } from "zod";
import type { ReviewTurn } from "./review.ts";

export function expectEvidenceQuote(response: string, evidence: string | null) {
  const link = /\[([^\]\n]+)\]\([^\n)]*\)/g;
  const quote = evidence?.replace(link, "$1").trim() ?? "";
  expect(quote, "Extracted evidence quote").not.toBe("");
  expect(response.replace(link, "$1"), "Evidence quoted from the response").toContain(quote);
}

export async function expectAutonomousCleanup(turn: ReviewTurn, topic: string) {
  const result = await turn.extract(z.object({
    treatment: z.enum(["cleanup", "implementation_risk", "left_configurable", "already_settled", "interactive", "unaddressed"])
      .describe(`How the response handled ${topic}. Use interactive for an author design choice or requested approval, even outside a formal issue block.`),
    author_requests: z.array(z.string()).describe("List any requests for the author to make a design or cleanup choice. Use an empty list if there were none."),
  }));
  expect(result.treatment, `Treatment of ${topic} in ${turn.artifacts}`).toMatch(/^(cleanup|implementation_risk|left_configurable|already_settled)$/);
  expect(result.author_requests, `Author requests in ${turn.artifacts}`).toEqual([]);
}

export async function expectPolicyRetention(turn: ReviewTurn, source: string) {
  const result = await turn.extract(z.object({
    authority: z.enum(["legal_or_compliance_policy", "local_default", "other", "unspecified"])
      .describe("What authority sets retention in the response or its reported edits? Laws and external retention policies are legal_or_compliance_policy."),
    source: z.string().nullable().describe("Name the authority or policy the response identifies, or null if none is named."),
    selected_duration: z.string().nullable().describe("A duration adopted or asserted as the requirement in the response or its SPEC.md changes. Exclude supported ranges and examples explicitly rejected. Use null if no duration was adopted or asserted."),
    author_requests: z.array(z.string()).describe("List any requests for the author to choose a duration or settle a design issue. Use an empty list if there were none."),
  }));
  expect(result, `Retention in ${turn.artifacts}`).toMatchObject({
    authority: "legal_or_compliance_policy",
    source: expect.stringMatching(new RegExp(source, "i")),
    selected_duration: null,
    author_requests: [],
  });
}
