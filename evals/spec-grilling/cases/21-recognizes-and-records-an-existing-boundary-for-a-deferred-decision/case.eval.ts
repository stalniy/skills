import { it, expect } from "vitest";
import { expectClosingSections } from "../../artifacts.ts";
import { z } from "zod";
import { prepareReview } from "../../review.ts";

it.concurrent("Recognizes an existing boundary that isolates an open decision", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review the specification with the spec-grilling skill. Treat provider-internal regional failover as an unresolved concern.", signal);
  const turn = await review.run({ issuesMax: 0 });
  const result = await turn.extract(z.object({
    submission: z.enum(["accepted_or_rejected", "other", "unspecified"]).describe("Submission guarantee preserved in SPEC.md."),
    topology: z.enum(["provider_internal", "application_requirement", "unspecified"]).describe("Where the resulting spec or response places regional topology."),
  }));
  expect(result).toEqual({ submission: "accepted_or_rejected", topology: "provider_internal" });
});

it.concurrent("Writes the deferred concern and its boundary into the specification", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Mark provider-internal regional failover out of scope and finish the review.", signal, [
    { role: "user", content: "Review the specification with the spec-grilling skill. Treat provider-internal regional failover as an unresolved concern." },
    { role: "assistant", content: "The DeliveryProvider boundary already isolates provider-internal regional failover. Its topology does not affect the accepted-or-rejected submission contract. No in-scope load-bearing decision is needed." },
  ]);
  const turn = await review.run({ issuesMax: 0 });
  expectClosingSections(turn);
  const result = await turn.extract(z.object({
    deferred: z.enum(["provider_failover", "notification_submission", "unspecified"]).describe("Concern recorded in the Out of scope section."),
    submission: z.enum(["accepted_or_rejected", "other", "unspecified"]).describe("Submission contract retained in SPEC.md."),
    internalDesign: z.string().nullable().describe("Concrete provider failover design imposed by SPEC.md, or null."),
  }));
  expect(result).toEqual({ deferred: "provider_failover", submission: "accepted_or_rejected", internalDesign: null });
});
