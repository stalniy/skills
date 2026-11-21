import { it, expect } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Reports implementation drift while preserving an accepted contract", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review SPEC.md against the repository. Improve the spec before we implement the next version.", signal);
  const turn = await review.run({ issuesMax: 0 });
  expect(turn.after["src/delete.py"]).toBe(turn.before["src/delete.py"]);
  const result = await turn.extract(z.object({
    observed: z.enum(["soft_delete", "permanent_removal", "unspecified"]).describe("Implementation behavior the response reports finding."),
    required: z.enum(["soft_delete", "permanent_removal", "unspecified"]).describe("Guarantee in the updated SPEC.md."),
    entity: z.enum(["Workspace", "schema", "other"]).describe("Domain object to which the required deletion guarantee applies."),
  }));
  expect(result).toEqual({ observed: "soft_delete", required: "permanent_removal", entity: "Workspace" });
});
