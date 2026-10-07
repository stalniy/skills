import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarness, createJudge, createJudgeHarness, describeEval, toJsonValue } from "vitest-evals";
import { z } from "zod";
import { decodeCodex, runCodex } from "./harness/codex.ts";
import { decodePi, runPi } from "./harness/pi.ts";
import { deterministicScore } from "./deterministic.ts";
import { prepareCase, snapshot, taskPrompt } from "./fixtures.ts";
import { gradeVerdict, verdictSchema } from "./rubric.ts";
import { gradeWithRepair } from "./judge.ts";
import type { CandidateInput } from "./fixtures.ts";
import type { SkillOutput } from "./harness.ts";

const runnerPromptPath = resolve("scripts/skill-evals/prompts/RUNNER_PROMPT.md");
const syntheticSkill = "Use the provided evidence to make a concise recommendation.";
const input: CandidateInput = { id: "test", prompt: "Review SPEC.md", files: { "SPEC.md": "A spec" }, history: [], tags: [] };
const output: SkillOutput = { response: "Observed response", before: input.files, after: input.files, workspace: "fixture", artifacts: "fixture" };
const harness = createHarness<CandidateInput, SkillOutput>({
  name: "synthetic-plumbing-test",
  run: async () => ({ output, events: [{ type: "message", role: "assistant", content: output.response }] }),
});

describe("fixture isolation", () => {
  it("renders the generated runner prompt with evidence and the latest turn", async () => {
    const template = await readFile(runnerPromptPath, "utf8");
    const prompt = taskPrompt({
      ...input,
      history: [{ role: "assistant", content: "S1 recommendation" }],
      prompt: "accept S1",
    }, syntheticSkill, template);
    expect(prompt).toContain("Follow SKILL_UNDER_TEST.md as the controlling skill instructions.");
    expect(prompt).toContain(syntheticSkill);
    expect(prompt).toContain("--- SPEC.md ---\nA spec");
    expect(prompt).toContain("Do not assume facts that are not present.");
    expect(prompt).toContain("Respond to the latest USER message only.");
    expect(prompt).toContain("Preserve the conversation state shown in TRANSCRIPT.");
    expect(prompt.indexOf("S1 recommendation")).toBeLessThan(prompt.lastIndexOf("accept S1"));
    expect(prompt).not.toMatch(/\{(?:skill|files|transcript|user)\}/);
  });
  it("prepares a synthetic case with history, exact fixtures, and no grading assertions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-eval-fixture-"));
    const skillPath = join(directory, "SKILL.md");
    await writeFile(skillPath, syntheticSkill);
    const candidate: CandidateInput = {
      id: "fixture-isolation",
      prompt: "Continue with the latest decision.",
      files: { "SPEC.md": "A synthetic spec", "notes/CONTEXT.md": "Supporting evidence" },
      history: [{ role: "assistant", content: "The prior recommendation." }],
      tags: [],
    };
    const assertion = "The assistant recommends the synthetic option.";
    const workspace = await prepareCase({ input: candidate, skillPath });
    try {
      const files = await snapshot(workspace);
      expect(files).toEqual({
        ...candidate.files,
        "skill/SKILL.md": syntheticSkill,
        "TASK.md": expect.any(String),
      });
      expect(files["TASK.md"]).toContain(candidate.prompt);
      for (const message of candidate.history) expect(files["TASK.md"]).toContain(message.content);
      expect(files["TASK.md"]).not.toContain(assertion);
    }
    finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Codex trace normalization", () => {
  it("closes stdin so a CLI waiting for EOF can execute and save evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-eval-process-"));
    const executable = join(directory, "fake-codex.mjs");
    const trace = [
      { type: "item.completed", item: { id: "1", type: "agent_message", text: "Completed after EOF" } },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ].map(event => JSON.stringify(event)).join("\n");
    try {
      await writeFile(executable, `#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on("end", () => process.stdout.write(${JSON.stringify(trace)}));\n`);
      await chmod(executable, 0o755);
      const artifacts = join(directory, "artifacts");
      const result = await runCodex({ executable, prompt: "Test", workspace: directory, artifacts, sandbox: "read-only", signal: AbortSignal.timeout(2000) });
      expect(result.output).toBe("Completed after EOF");
      expect(await readFile(join(artifacts, "trace.jsonl"), "utf8")).toBe(trace);
    }
    finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("retains shell evidence, final response and token usage", () => {
    const trace = [
      { type: "item.completed", item: { id: "1", type: "command_execution", command: "cat SPEC.md", aggregated_output: "A spec", exit_code: 0 } },
      { type: "item.completed", item: { id: "2", type: "agent_message", text: "Recommendation" } },
      { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20 } },
    ].map(event => JSON.stringify(event)).join("\n");
    const run = decodeCodex(trace, "Review", "test-model");
    expect(run.output).toBe("Recommendation");
    expect(run.usage).toMatchObject({ inputTokens: 100, outputTokens: 20, model: "test-model" });
    expect(run.events).toContainEqual(expect.objectContaining({ type: "tool_result", content: "A spec" }));
  });
  it("resumes a saved thread in an isolated Codex home", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-eval-codex-resume-"));
    const executable = join(directory, "fake-codex.mjs");
    const trace = [
      { type: "thread.started", thread_id: "thread-123" },
      { type: "item.completed", item: { id: "1", type: "agent_message", text: "Resumed response" } },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ].map(event => JSON.stringify(event)).join("\n");
    try {
      await writeFile(executable, `#!/usr/bin/env node\nprocess.stdin.resume();\nprocess.stdin.on("end", () => process.stdout.write(${JSON.stringify(trace)}));\n`);
      await chmod(executable, 0o755);
      const artifacts = join(directory, "artifacts");
      const home = join(directory, "codex-home");
      const result = await runCodex({
        executable, prompt: "Repair response", workspace: directory, artifacts, sandbox: "read-only",
        session: { home, threadId: "thread-123" },
      });
      const invocation = JSON.parse(await readFile(join(artifacts, "invocation.json"), "utf8"));
      expect(result.threadId).toBe("thread-123");
      expect(invocation.args.slice(0, 3)).toEqual(["exec", "resume", "thread-123"]);
      expect(invocation.args).not.toContain("--ephemeral");
    }
    finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects failed, truncated, malformed and response-free runs", () => {
    for (const trace of ["{\"type\":\"turn.failed\"}", "{\"type\":\"thread.started\"}", "not json", "{\"type\":\"turn.completed\"}"]) {
      expect(() => decodeCodex(trace, "Review")).toThrow();
    }
  });
});

describe("Pi trace normalization", () => {
  it("runs in the requested workspace and records invocation artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "skill-eval-pi-"));
    const executable = join(directory, "fake-pi.mjs");
    const trace = JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Pi response" }] }] });
    try {
      await writeFile(executable, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(trace)});\n`);
      await chmod(executable, 0o755);
      const artifacts = join(directory, "artifacts");
      const result = await runPi({ executable, prompt: "Test", workspace: directory, artifacts, sandbox: "read-only", model: "test-model" });
      expect(result.output).toBe("Pi response");
      expect(await readFile(join(artifacts, "trace.jsonl"), "utf8")).toBe(trace);
      expect(await readFile(join(artifacts, "invocation.json"), "utf8")).toContain("read,grep,find,ls");
    }
    finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("normalizes assistant text, tool activity and cumulative token usage", () => {
    const trace = JSON.stringify({
      type: "agent_end",
      messages: [
        { role: "assistant", model: "test-model", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "SPEC.md" } }], usage: { input: 3, output: 4, cacheRead: 5, cacheWrite: 6 } },
        { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "A spec" }] },
        { role: "assistant", content: [{ type: "text", text: "Recommendation" }], usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 } },
      ],
    });
    const run = decodePi(trace, "Review");
    expect(run.output).toBe("Recommendation");
    expect(run.usage).toMatchObject({ inputTokens: 13, outputTokens: 24, model: "test-model" });
    expect(run.events).toContainEqual(expect.objectContaining({ type: "tool_call", name: "read" }));
    expect(run.events).toContainEqual(expect.objectContaining({ type: "tool_result", content: "A spec" }));
  });
  it("rejects incomplete or response-free runs", () => {
    for (const trace of ["{}", JSON.stringify({ type: "agent_end", messages: [] })]) expect(() => decodePi(trace, "Review")).toThrow();
  });
});

describe("rubric completeness", () => {
  it("rejects duplicate or missing verdicts", () => {
    const verdict = { index: 0, status: "pass", evidence: "Quoted evidence" };
    expect(() => gradeVerdict({ assertions: [verdict, verdict] }, ["A", "B"])).toThrow("exactly one");
    expect(() => gradeVerdict({ assertions: [verdict] }, ["A", "B"])).toThrow("exactly one");
  });
  it("treats missing evidence and failed assertions as a failed case", () => {
    for (const status of ["fail", "not-observed"]) {
      expect(gradeVerdict({ assertions: [{ index: 0, status, evidence: "No observed support" }] }, ["A"]).score).toBe(0);
    }
    expect(() => gradeVerdict({ assertions: [{ index: 0, status: "pass", evidence: "" }] }, ["A"])).toThrow();
  });
});

describe("generated deterministic checks", () => {
  it("enforces interactive bounds, required terms, forbidden text, and open questions", () => {
    const response = "🔎 **S1 — Ownership**\nRecommendation: use the cloud as source of truth.";
    expect(deterministicScore(response, {
      interactive_min: 1, interactive_max: 1, must_contain_any: ["source of truth"],
      must_not_contain: ["Redis"], forbid_open_design_questions: true,
    }).pass).toBe(true);
    const score = deterministicScore(`${response}\n🔎 **S2 — Timeout**\nWhat should we use? Redis`, {
      interactive_max: 1, must_not_contain: ["Redis"],
      must_not_match: ["what should"], forbid_open_design_questions: true,
    });
    expect(score.pass).toBe(false);
    expect(score.interactive_issue_count).toBe(2);
    expect(score.problems).toHaveLength(4);
  });
});

describeEval("synthetic judge integration (not skill behavior)", { harness }, (it) => {
  const judge = createJudge<CandidateInput, SkillOutput>("BehavioralRubric", async (context) => {
    if (!context.runJudge) throw new Error("BehavioralRubric requires a judge harness");
    return gradeWithRepair(context.runJudge, {
      prompt: JSON.stringify({ response: context.output.response, assertions: ["A"] }),
      responseFormat: { type: "json", schema: toJsonValue(z.toJSONSchema(verdictSchema)) },
    }, verdict => gradeVerdict(verdict, ["A"]));
  });
  it("records an explicit passing judge result", async ({ run }) => {
    const judgeHarness = createJudgeHarness({ run: async () => ({ assertions: [{ index: 0, status: "pass", evidence: "Fixture evidence" }] }) });
    const result = await run(input);
    await expect(result).toSatisfyJudge(judge, { judgeHarness, threshold: 1 });
  });
  it("rejects a failing judge result at the required threshold", async ({ run }) => {
    const judgeHarness = createJudgeHarness({ run: async () => ({ assertions: [{ index: 0, status: "fail", evidence: "Fixture violation" }] }) });
    const result = await run(input);
    await expect(expect(result).toSatisfyJudge(judge, { judgeHarness, threshold: 1 })).rejects.toThrow();
  });
});
