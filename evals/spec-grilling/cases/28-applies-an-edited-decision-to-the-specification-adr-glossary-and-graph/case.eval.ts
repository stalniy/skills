import { expect, it } from "vitest";
import { z } from "zod";
import { expectClosingSections, expectDecisionGraph, graphNodes } from "../../artifacts.ts";
import { prepareReview } from "../../review.ts";

const component = z.enum(["Ledger", "Checkout", "both", "other", "unspecified"]);

it.concurrent("Applies an edited decision to the specification, ADR, glossary, and graph", {
  tags: ["must-have"],
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "e I1: Ledger owns Invoice payment state. Checkout submits commands and reads Ledger status. We call the authoritative component the Payment Authority.", signal, [
    { role: "assistant", content: "I1 — Payment-state ownership. A single owner is needed to prevent divergent payment states; changing ownership later requires migration. Recommendation: Checkout owns invoice payment state and Ledger mirrors it. accept · edit · out of scope" },
  ]);
  const turn = await review.run({ issuesMax: 0, forbid_open_design_questions: true });
  expect(turn.after["SPEC.md"]).not.toBe(turn.before["SPEC.md"]);
  expectClosingSections(turn, { noDeferrals: true });
  expect(turn.after["GLOSSARY.md"]).toMatch(/\bInvoice\b/);

  expect(turn.after["GLOSSARY.md"]).not.toBe(turn.before["GLOSSARY.md"]);
  expect(turn.after["GLOSSARY.md"]).toMatch(/Payment Authority/i);
  expect(graphNodes(expectDecisionGraph(turn, "complete").contents)).toContainEqual({
    id: "I1", status: "accepted", dependsOn: [],
  });

  const result = await turn.extract(z.object({
    spec: z.object({
      owner: component.describe("The authoritative owner of Invoice payment state."),
      command_submitter: component.describe("The component that submits payment commands to Ledger."),
      status_reader: component.describe("The component that reads Invoice payment status from Ledger."),
    }).describe("Current requirements in SPEC.md, excluding the closing sections."),
    adr: z.object({
      path: z.string().describe("Workspace-relative path of the architectural decision record."),
      owner: component.describe("The owner named in the accepted decision, excluding rejected alternatives."),
      rationale: z.string().nullable().describe("Quote the reason stated for the ownership decision, or return null if absent."),
    }).nullable(),
    graph_owner: component.describe("The authoritative owner in the Decision section of graph node I1, excluding alternatives."),
    authority_definition: z.enum(["authoritative_owner", "other", "absent"]).describe("Meaning of Payment Authority in its glossary entry with respect to Invoice payment state."),
    invoice_definition: z.enum(["payment_request", "other", "unspecified"])
      .describe("What Invoice means in GLOSSARY.md."),
    spec_refresh_resolution: z.string().nullable()
      .describe("Quote the resolution for the status-read refresh interval from the Cleanup summary in SPEC.md, or return null if absent."),
    response_owner: component.describe("The accepted payment-state owner reported in the final response."),
    response_refresh_resolution: z.string().nullable()
      .describe("Quote the refresh interval resolution reported in the final response, or return null if absent."),
  }).describe("Read the saved files for artifact fields and use the previous response for response fields. Extract only what is stated."));

  expect(result.spec).toEqual({ owner: "Ledger", command_submitter: "Checkout", status_reader: "Checkout" });
  expect(result.adr).toMatchObject({ owner: "Ledger", rationale: expect.stringMatching(/\S/) });
  const { path, rationale } = result.adr!;
  expect(path).not.toMatch(/^(?:SPEC|GLOSSARY)\.md$|^\.spec-grill\//);
  expect(turn.after[path]).toContain(rationale);
  expect(turn.after[path]).not.toBe(turn.before[path]);
  expect(result.graph_owner).toBe("Ledger");
  expect(result.authority_definition).toBe("authoritative_owner");
  expect(result.invoice_definition).toBe("payment_request");
  expect(result.spec_refresh_resolution).toEqual(expect.stringMatching(/\S/));
  expect(turn.after["SPEC.md"]?.split(/^## Cleanup summary[ \t]*\r?$/m)[1]).toContain(result.spec_refresh_resolution);
  expect(result.response_owner).toBe("Ledger");
  expect(result.response_refresh_resolution).toEqual(expect.stringMatching(/\S/));
  expect(turn.output).toContain(result.response_refresh_resolution);
});
