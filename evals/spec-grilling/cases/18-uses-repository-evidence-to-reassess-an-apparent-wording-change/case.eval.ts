import { expect, it } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Uses repository evidence to reassess an apparent wording change", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMax: 1 });
  expect(turn.after["SPEC.md"]).toMatch(/`queued`/);

  const result = await turn.extract(z.object({
    publishedValue: z.enum(["queued", "pending", "unspecified"]).describe("The currently required status value in SPEC.md, excluding proposals."),
    affected: z.array(z.enum(["stored_records", "external_consumers", "other"])).describe("Dependencies the response identifies when explaining the cost of renaming the status."),
    openQuestions: z.array(z.enum(["rename_contract", "other"])).describe("Decisions the author is asked to make."),
  }));
  expect(result.publishedValue).toBe("queued");
  expect(result.affected).toEqual(expect.arrayContaining(["stored_records", "external_consumers"]));
  expect(result.openQuestions.every(question => question === "rename_contract")).toBe(true);
});
