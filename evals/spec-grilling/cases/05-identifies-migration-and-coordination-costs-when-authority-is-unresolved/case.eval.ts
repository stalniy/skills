import { expect, it } from "vitest";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Identifies migration and coordination costs when authority is unresolved", {
  tags: ["nice-to-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill.", signal);
  const turn = await review.run({ issuesMin: 1, issuesMax: 2 });
  const result = await turn.extract(z.object({
    issue: z.enum(["balance_write_authority", "other", "none"]).describe("Subject of the interactive issue about Account balance."),
    writers: z.enum(["one_authoritative_writer", "both_authoritative_writers", "unspecified"])
      .describe("The recommended write authority for Account balance. Use unspecified when the response leaves authority open."),
    laterChange: z.array(z.enum(["data_migration", "service_coordination", "other"])).describe("Later change costs explicitly tied to changing the writer model."),
  }));
  expect(result.issue).toBe("balance_write_authority");
  expect(result.writers).not.toBe("unspecified");
  expect(result.laterChange).toEqual(expect.arrayContaining(["data_migration", "service_coordination"]));
});
