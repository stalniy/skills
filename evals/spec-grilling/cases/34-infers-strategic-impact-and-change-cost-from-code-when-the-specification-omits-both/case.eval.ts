import { expect, it } from "vitest";
import { z } from "zod";
import { expectEvidenceQuote } from "../../extraction.ts";
import { prepareReview } from "../../review.ts";

it.concurrent("Infers strategic impact and change cost from code when the specification omits both", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review SPEC.md.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 1 });
  expect(turn.events.some(event => event.type === "tool_result" && typeof event.content === "string"
    && event.content.includes("archive.append_immutable(row)")), "Repository evidence read during review").toBe(true);
  const result = await turn.extract(z.object({
    recommendedMeaning: z.enum(["gross", "net", "unspecified"]).describe("Single proposed meaning of the new amount column, if any."),
    impact: z.enum(["partner_interpretation", "internal_display", "unspecified"]).describe("Behavior the response says depends on the meaning chosen."),
    reversal: z.array(z.enum(["archive_compatibility", "partner_coordination", "other"])).describe("Costs the response ties to reversing this choice, including historical replay or compatibility with partner importers."),
    evidence: z.string().nullable().describe("Copy a contiguous quote from the response tying the contract to existing archive or partner behavior. Preserve the wording, and use visible link text for any Markdown links."),
  }));
  expect(result.recommendedMeaning).not.toBe("unspecified");
  expect(result.impact).toBe("partner_interpretation");
  expect(result.reversal).toEqual(expect.arrayContaining(["archive_compatibility", "partner_coordination"]));
  expectEvidenceQuote(turn.output, result.evidence);
});
