import { expect, it } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Reads the project glossary before review and applies its established term", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);

  const turn = await review.run({ issuesMax: 0 });
  const definition = "Resume Workflow execution from a previous Step.";
  expect(turn.events.some(event => event.type === "tool_result" && typeof event.content === "string"
    && event.content.includes(definition)), "Glossary definition read during the review turn").toBe(true);
  const requirements = turn.after["SPEC.md"]?.split(/^## Cleanup summary\s*$/m, 1)[0] ?? "";
  expect(requirements).toMatch(/\bredo\b/i);
  expect(requirements).not.toMatch(/\breruns?\b/i);

  const result = await turn.extract(z.object({
    operation: z.enum(["redo", "rerun", "other", "unspecified"]).describe("The term used for the Workflow recovery operation."),
    trigger: z.enum(["verification_failure", "other", "unspecified"]).describe("The event that triggers Workflow recovery."),
    resume_step: z.string().nullable().describe("The exact Step name where recovery begins, or null if no Step is specified."),
    earlier_results: z.enum(["reused", "discarded", "unspecified"]).describe("What happens to Results from Steps before the resume point."),
  }).describe(
    "Read SPEC.md in the workspace. Extract the required Workflow recovery behavior from the updated specification, excluding its cleanup summary."
  ));
  expect(result).toEqual({
    operation: "redo",
    trigger: "verification_failure",
    resume_step: "implement",
    earlier_results: "reused",
  });
});
