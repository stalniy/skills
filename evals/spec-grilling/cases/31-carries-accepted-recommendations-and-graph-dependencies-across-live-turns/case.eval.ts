import { expect, it } from "vitest";
import { expectClosingSections, expectDecisionGraph, graphNodes } from "../../artifacts.ts";
import { z } from "zod";
import { expectIssueActions, prepareReview } from "../../review.ts";

it.concurrent("Carries accepted recommendations and graph dependencies across live turns", {
  tags: ["must-have"],
  timeout: 3 * 540_000,
}, async ({ signal }) => {
  await using review = await prepareReview(import.meta.dirname, "Review SPEC.md before implementation.", signal);
  const first = await review.run({ issuesMin: 1, issuesMax: 1 });
  const firstGraph = expectDecisionGraph(first, "in-progress");
  const firstNodes = graphNodes(firstGraph.contents);
  expect(firstNodes).toHaveLength(1);
  const identity = firstNodes[0]!;
  expect(identity).toMatchObject({ status: "provisional", dependsOn: [] });
  expectIssueActions(first);

  const second = await review.run({ issuesMin: 1, issuesMax: 1 }, "Accept the Job/Attempt identity recommendation you just made. Continue the review.");
  expectIssueActions(second);
  const secondGraph = expectDecisionGraph(second, "in-progress");
  expect(secondGraph.path).toBe(firstGraph.path);
  const secondNodes = graphNodes(secondGraph.contents);
  expect(secondNodes).toHaveLength(2);
  expect(secondNodes).toContainEqual({ ...identity, status: "accepted" });
  const keyScope = secondNodes.find(node => node.id !== identity.id)!;
  expect(keyScope).toMatchObject({ status: "provisional", dependsOn: [identity.id] });
  expect(second.after["SPEC.md"]).not.toBe(first.after["SPEC.md"]);

  const final = await review.run({ issuesMax: 0 }, "Accept the idempotency-key scope recommendation you just made. Apply it and finish the specification review.");
  expectClosingSections(final, { noDeferrals: true });
  const finalGraph = expectDecisionGraph(final, "complete");
  expect(finalGraph.path).toBe(firstGraph.path);
  const finalNodes = graphNodes(finalGraph.contents);
  expect(finalNodes).toHaveLength(2);
  expect(finalNodes).toEqual(expect.arrayContaining([
    { ...identity, status: "accepted" },
    { ...keyScope, status: "accepted" },
  ]));
  const identityModel = z.enum(["same_job", "new_job", "new_attempt_under_same_job", "other", "unspecified"]);
  const keyModel = z.enum(["job", "attempt", "job_and_attempt", "other", "unspecified"]);
  const result = await final.extract(z.object({
    firstRecommendation: identityModel.describe("Retry identity proposed in the first response."),
    firstKeyRecommendation: keyModel.describe("Key scope proposed for acceptance in the first response. Mere mention of a dependency is unspecified."),
    acceptedIdentity: identityModel.describe("Retry identity required by the specification after the first acceptance."),
    keyRecommendation: keyModel.describe("Key scope proposed in the second response."),
    finalIdentity: identityModel.describe("Retry identity required by the final specification."),
    finalKeyScope: keyModel.describe("Key scope required by the final specification."),
    adrPath: z.string().nullable().describe("Workspace-relative path of the ADR recording the accepted retry identity."),
  }).describe(`First response:\n${first.output}\nSPEC.md after first acceptance:\n${second.after["SPEC.md"]}\nSecond response:\n${second.output}`));
  expect(result.firstRecommendation).not.toMatch(/^(other|unspecified)$/);
  expect(result.firstKeyRecommendation).toBe("unspecified");
  expect(result.acceptedIdentity).toBe(result.firstRecommendation);
  expect(result.finalIdentity).toBe(result.acceptedIdentity);
  expect(result.keyRecommendation).not.toMatch(/^(other|unspecified)$/);
  expect(result.finalKeyScope).toBe(result.keyRecommendation);
  expect(result.adrPath).toBeTruthy();
  expect(final.after[result.adrPath!]).toEqual(expect.stringMatching(/\S/));
  expect(final.after["GLOSSARY.md"]).toEqual(expect.stringMatching(/\bAttempt\b/i));
});
