import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { expectClosingSections, expectDecisionGraph, graphNodes } from "../../evals/spec-grilling/artifacts.ts";
import { expectEvidenceQuote } from "../../evals/spec-grilling/extraction.ts";
import { gradeSpecGrillingVerdict, specGrillingVerdictSchema } from "../../evals/spec-grilling/rubric.ts";
import { prepareReview } from "../../evals/spec-grilling/review.ts";
import * as agent from "./agent.ts";
import { continueConversation } from "./conversation.ts";
import { deterministicScore } from "./deterministic.ts";
import { prepareCase, snapshot } from "./fixtures.ts";
import type { CandidateInput } from "./fixtures.ts";
import type { SkillOutput } from "./harness.ts";

const evalRoot = resolve("evals/spec-grilling");
const validVerdict = {
  critical_failure: false,
  scores: {
    classification: 2, recommendation_ownership: 2, frontier_discipline: 2,
    scope_semantics: "N/A", fact_discipline: 2, cleanup_autonomy: 2,
    ubiquitous_language: "N/A", abstraction_level: 2,
    knowledge_artifacts: "N/A",
  },
  assertions: [{ index: 0, status: "pass", evidence: "SPEC.md retains the accepted contract." }],
  summary: "All required behavior was observed.",
};

describe("spec-grilling judge contract", () => {
  it("documents a schema-valid verdict that the grader accepts", async () => {
    const rubric = await readFile(resolve(evalRoot, "JUDGE_RUBRIC.md"), "utf8");
    const example = JSON.parse(rubric.slice(rubric.indexOf("{\n"), rubric.lastIndexOf("}") + 1));
    expect(gradeSpecGrillingVerdict(example, ["Preserves the accepted boundary"]).score).toBe(1);
    expect(example).not.toHaveProperty("pass");
  });

  it.each(["classification", "recommendation_ownership", "frontier_discipline", "fact_discipline", "cleanup_autonomy", "abstraction_level"])("rejects N/A for required dimension %s", dimension => {
    const verdict = { ...validVerdict, scores: { ...validVerdict.scores, [dimension]: "N/A" } };
    expect(specGrillingVerdictSchema.safeParse(verdict).success).toBe(false);
    expect(() => gradeSpecGrillingVerdict(verdict, ["A"])).toThrow();
  });

  it("rejects critical failures, unsupported assertions, and low scores even when the other scores are high", () => {
    expect(gradeSpecGrillingVerdict(validVerdict, ["A"]).score).toBe(1);
    expect(gradeSpecGrillingVerdict({ ...validVerdict, critical_failure: true }, ["A"]).score).toBe(0);
    expect(gradeSpecGrillingVerdict({ ...validVerdict, assertions: [{ ...validVerdict.assertions[0], status: "not-observed" }] }, ["A"]).score).toBe(0);
    expect(gradeSpecGrillingVerdict({ ...validVerdict, scores: { ...validVerdict.scores, classification: 1 } }, ["A"]).score).toBe(0);
    expect(gradeSpecGrillingVerdict({ ...validVerdict, scores: { ...validVerdict.scores, fact_discipline: 0 } }, ["A"]).score).toBe(0);
  });
});

describe("spec-grilling fixture regressions", () => {
  it("checks extracted evidence against visible Markdown link text", () => {
    const response = "Partners replay archived rows. The [accepted feed decision](docs/adr/004-feed.md) requires coordinated partner upgrades.";
    expectEvidenceQuote(response, "Partners replay archived rows. The accepted feed decision requires coordinated partner upgrades.");
    expectEvidenceQuote(response, "The [accepted feed decision](docs/adr/004-feed.md) requires coordinated partner upgrades.");
    expect(() => expectEvidenceQuote(response, "The accepted feed decision requires no upgrades.")).toThrow();
    expect(() => expectEvidenceQuote(response, "   ")).toThrow();
  });

  it.each([
    [{ issuesMin: 1 }, "🔎 **I1 — Scope boundary**\nThe same-Session guarantee depends on deferred failover. This specification is not implementation-ready."],
    [{ issuesMax: 0 }, "HTTP client retry is distinct from Workflow redo."],
    [{ issuesMax: 1 }, "Preserved queued because renaming requires migration."],
  ] as const)("counts only interactive issue headings for %j", (expected, response) => {
    expect(deterministicScore(response, expected).problems).toEqual([]);
  });

  it("keeps one Vitest file and a filesystem specification in every case directory", async () => {
    const root = resolve(evalRoot, "cases");
    const directories = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory());
    expect(directories.length).toBeGreaterThan(0);
    for (const { name } of directories) {
      const entries = await readdir(resolve(root, name));
      expect(entries.filter(file => file.endsWith(".eval.ts")), name).toEqual(["case.eval.ts"]);
      expect(entries, name).not.toContain("case.json");
      expect(await readFile(resolve(root, name, "input/SPEC.md"), "utf8")).not.toBe("");
    }
  });
});

it("resumes the candidate's review session with its previous files and captures each turn", async ({ signal }) => {
  const directory = resolve(evalRoot, "cases", "31-carries-accepted-recommendations-and-graph-dependencies-across-live-turns");
  const sessionId = "actual-review-session";
  const firstReply = "🔎 **I1 — Job identity**\nKeep the same Job identifier across retries.";
  const graphPath = ".spec-grill/job-retry-identity/decision-graph.ai.md";
  const provisionalGraph = [
    "---", "review-mode: interactive", "review-status: in-progress", "---", "",
    "## I1", "", "status: provisional", "depends-on: []", "",
    "### Evidence", "", "- SPEC.md defines Job retries.", "",
  ].join("\n");
  const run = vi.spyOn(agent, "runAgent")
    .mockImplementationOnce(async options => {
      expect(options.sessionId).toBeUndefined();
      expect(options.prompt).toContain("Review the Job identity.");
      const spec = await readFile(join(options.workspace, "SPEC.md"), "utf8");
      expect(options.prompt).not.toContain(spec.trim());
      expect(await readFile(join(options.workspace, "TASK.md"), "utf8")).toBe(options.prompt);
      await writeFile(join(options.workspace, "identity.md"), "Provisional recommendation.");
      await mkdir(join(options.workspace, ".spec-grill/job-retry-identity"), { recursive: true });
      await writeFile(join(options.workspace, graphPath), provisionalGraph);
      return { sessionId, output: firstReply, events: [], usage: {} };
    })
    .mockImplementationOnce(async options => {
      expect(options.sessionId).toBe(sessionId);
      expect(options.prompt).toBe("Accept the recommendation.");
      expect(await readFile(join(options.workspace, "identity.md"), "utf8")).toBe("Provisional recommendation.");
      await writeFile(join(options.workspace, "identity.md"), "Accepted recommendation.");
      await writeFile(join(options.workspace, graphPath), provisionalGraph.replace("in-progress", "complete").replace("provisional", "accepted"));
      await writeFile(join(options.workspace, "SPEC.md"), "# Identity\n\n## Out of scope\n\nNone\n\n## Cleanup summary\n\nNone\n");
      return { sessionId, output: `Recorded identity in the [decision graph](${join(options.workspace, graphPath)}).`, events: [], usage: {} };
    });
  try {
    await using review = await prepareReview(directory, "Review the Job identity.", signal);
    const first = await review.run({ issuesMin: 1, issuesMax: 1 });
    const second = await review.run({ issuesMax: 0 }, "Accept the recommendation.");
    expect(second.history).toEqual([
      { role: "user", content: "Review the Job identity." },
      { role: "assistant", content: firstReply },
    ]);
    expect(second.before).toEqual(first.after);
    expect(second.after["identity.md"]).toBe("Accepted recommendation.");
    expect(JSON.parse(await readFile(join(second.artifacts, "after.json"), "utf8"))).toEqual(second.after);
    const firstGraph = expectDecisionGraph(first, "in-progress");
    const secondGraph = expectDecisionGraph(second, "complete");
    expect(secondGraph.path).toBe(firstGraph.path);
    expect(graphNodes(firstGraph.contents)).toEqual([{ id: "I1", status: "provisional", dependsOn: [] }]);
    expect(graphNodes(secondGraph.contents)).toEqual([{ id: "I1", status: "accepted", dependsOn: [] }]);
    expectClosingSections(second, { noDeferrals: true });
    expect(run).toHaveBeenCalledTimes(2);
  }
  finally {
    run.mockRestore();
  }
});

it("carries actual conversation responses, changed and deleted files into the next prepared workspace", async () => {
  const input: CandidateInput = {
    id: "conversation-regression", prompt: "Review identity", tags: [],
    history: [{ role: "user", content: "Preserve existing requirements." }],
    files: { "SPEC.md": "Identity pending", "obsolete.md": "Old note" },
  };
  const output: SkillOutput = {
    response: "I1: Create a new Attempt for every retry.", before: input.files,
    after: { "SPEC.md": "Updated evidence", "notes/CONTEXT.md": "Current context", "TASK.md": "Old task", "skill/SKILL.md": "Controlling skill" },
    workspace: "unused", artifacts: "unused",
  };
  const next = continueConversation(input, output, "Accept your recommendation.");
  await using prepared = await prepareCase({ input: next, skillPath: resolve("skills/spec-grilling/SKILL.md") });
  const files = await snapshot(prepared.workspace);
  expect(files["SPEC.md"]).toBe("Updated evidence");
  expect(files["notes/CONTEXT.md"]).toBe("Current context");
  const graphContract = await readFile(resolve("skills/spec-grilling/references/decision-graph.md"), "utf8");
  expect(files["skill/references/decision-graph.md"]).toBe(graphContract);
  expect(prepared.prompt).toContain(`--- skill/references/decision-graph.md ---\n${graphContract}`);
  expect(files).not.toHaveProperty("obsolete.md");
  expect(files["TASK.md"]).toContain(output.response);
  expect(files["TASK.md"]).toContain(next.prompt);
  expect(files["TASK.md"]).not.toContain("Old task");
  expect(next.history).toEqual([...(input.history ?? []), { role: "user", content: input.prompt }, { role: "assistant", content: output.response }]);
  const final = continueConversation(next, { ...output, response: "S2: Key scope recommendation.", after: { ...next.files, "adr/identity.md": "Accepted new-Attempt model" } }, "Accept S2.");
  expect(final.files["adr/identity.md"]).toBe("Accepted new-Attempt model");
  expect(final.history?.map(message => message.content)).toEqual([
    "Preserve existing requirements.", input.prompt, output.response, next.prompt, "S2: Key scope recommendation.",
  ]);
});
