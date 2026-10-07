import { readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gradeSpecGrillingVerdict, specGrillingVerdictSchema } from "../../skills/spec-grilling/evals/rubric.ts";
import { continueConversation } from "./conversation.ts";
import { deterministicScore } from "./deterministic.ts";
import { prepareCase, snapshot } from "./fixtures.ts";
import type { CandidateInput } from "./fixtures.ts";
import type { SkillOutput } from "./harness.ts";

const evalRoot = resolve("skills/spec-grilling/evals");
const validVerdict = {
  critical_failure: false,
  scores: {
    classification: 2, recommendation_ownership: 2, frontier_discipline: 2,
    scope_semantics: "N/A", fact_discipline: 2, cleanup_autonomy: 2,
    ubiquitous_language: "N/A", abstraction_level: 2,
    knowledge_artifacts: "N/A", author_learning: "N/A",
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
  it.each([
    ["20_out_of_scope_blocks_design", 1, "🔎 **S1 — Scope boundary**\nThe same-Session guarantee depends on deferred failover. This specification is not implementation-ready."],
    ["16_retry_distinct_from_redo", 0, "HTTP client retry is distinct from Workflow redo."],
  ] as const)("does not reject a valid explanation in %s", async (directory, turnIndex, response) => {
    const fixture = JSON.parse(await readFile(resolve(evalRoot, "cases", directory, "case.json"), "utf8"));
    expect(deterministicScore(response, fixture.turns[turnIndex].expected).problems).toEqual([]);
    expect(fixture.turns[turnIndex].assertions.length).toBeGreaterThan(0);
  });

  it("keeps semantic assertions out of lexical hard gates and supplies all trajectory assertions", async () => {
    const root = resolve(evalRoot, "cases");
    const ids = new Set<string>();
    for (const directory of await readdir(root)) {
      const fixture = JSON.parse(await readFile(resolve(root, directory, "case.json"), "utf8"));
      expect(ids.has(fixture.id)).toBe(false);
      ids.add(fixture.id);
      expect(fixture.expected_summary.length).toBeGreaterThan(0);
      expect(await readFile(resolve(root, directory, "input/SPEC.md"), "utf8")).not.toBe("");
      for (const turn of fixture.turns) {
        expect(turn.user.length).toBeGreaterThan(0);
        expect(Object.keys(turn.expected).every(key => ["interactive_min", "interactive_max"].includes(key))).toBe(true);
        if (fixture.mode === "conversation") {
          expect(turn.assertions.length).toBeGreaterThan(0);
          expect(turn.prior_assistant_response).toBeUndefined();
        }
      }
    }
    const rename = JSON.parse(await readFile(resolve(root, "18_cleanup_reveals_load_bearing/case.json"), "utf8"));
    expect(deterministicScore("Preserved queued because renaming requires migration.", rename.turns[0].expected).pass).toBe(true);
    const boundary = JSON.parse(await readFile(resolve(root, "21_boundary_isolates_deferred/case.json"), "utf8"));
    expect(boundary.turns[0].expected.interactive_max).toBe(0);
  });
});

it("carries actual conversation responses, changed and deleted files into the next prepared workspace", async () => {
  const input: CandidateInput = {
    id: "conversation-regression", prompt: "Review identity", tags: [],
    history: [{ role: "user", content: "Preserve existing requirements." }],
    files: { "SPEC.md": "Identity pending", "obsolete.md": "Old note" },
  };
  const output: SkillOutput = {
    response: "S1: Create a new Attempt for every retry.", before: input.files,
    after: { "SPEC.md": "Updated evidence", "notes/CONTEXT.md": "Current context", "TASK.md": "Old task", "skill/SKILL.md": "Controlling skill" },
    workspace: "unused", artifacts: "unused",
  };
  const next = continueConversation(input, output, "Accept your recommendation.");
  const workspace = await prepareCase({ input: next, skillPath: resolve(evalRoot, "../SKILL.md") });
  try {
    const files = await snapshot(workspace);
    expect(files["SPEC.md"]).toBe("Updated evidence");
    expect(files["notes/CONTEXT.md"]).toBe("Current context");
    expect(files["references/decision-graph.md"]).toBe(
      await readFile(resolve("skills/references/decision-graph.md"), "utf8")
    );
    expect(files).not.toHaveProperty("obsolete.md");
    expect(files["TASK.md"]).toContain(output.response);
    expect(files["TASK.md"]).toContain(next.prompt);
    expect(files["TASK.md"]).not.toContain("Old task");
    expect(next.history).toEqual([...input.history, { role: "user", content: input.prompt }, { role: "assistant", content: output.response }]);
    const final = continueConversation(next, { ...output, response: "S2: Key scope recommendation.", after: { ...next.files, "adr/identity.md": "Accepted new-Attempt model" } }, "Accept S2.");
    expect(final.files["adr/identity.md"]).toBe("Accepted new-Attempt model");
    expect(final.history.map(message => message.content)).toEqual([
      "Preserve existing requirements.", input.prompt, output.response, next.prompt, "S2: Key scope recommendation.",
    ]);
  }
  finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
