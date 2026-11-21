import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copilotModelSchema, evalConfigSchema } from "./config.ts";
import { skillHarness } from "./harness.ts";
import { decodeCopilot, runCopilot } from "./harness/copilot.ts";

const model = "gpt-5.3-codex";
const trace = [
  { type: "assistant.message", data: { content: "Reading the spec." } },
  { type: "tool.execution_start", data: { toolCallId: "call-1", toolName: "view", arguments: { path: "SPEC.md" } } },
  { type: "tool.execution_complete", data: { toolCallId: "call-1", success: true, result: { content: "A spec" } } },
  { type: "assistant.usage", data: { model, inputTokens: 10, outputTokens: 5, reasoningTokens: 2 } },
  { type: "assistant.message", data: { content: "Recommendation" } },
  { type: "assistant.usage", data: { model, inputTokens: 20, outputTokens: 7 } },
  { type: "result", sessionId: "session-123", exitCode: 0 },
].map(event => JSON.stringify(event)).join("\n");

afterEach(() => vi.unstubAllEnvs());

describe("Copilot eval configuration", () => {
  it("accepts only supported Copilot models for either role, without restricting other harnesses", () => {
    const schema = evalConfigSchema("high");
    for (const availableModel of copilotModelSchema.options) {
      expect(schema.safeParse({
        SKILL_HARNESS: "copilot", SKILL_MODEL: availableModel,
        JUDGE_HARNESS: "copilot", JUDGE_MODEL: availableModel,
      }).success).toBe(true);
    }
    expect(schema.safeParse({ SKILL_HARNESS: "copilot", SKILL_MODEL: "openrouter/provider/model" }).success).toBe(false);
    expect(schema.safeParse({ JUDGE_HARNESS: "copilot", JUDGE_MODEL: "gpt-5.4-nano" }).success).toBe(false);
    expect(schema.safeParse({ SKILL_HARNESS: "copilot", SKILL_MODEL: model, JUDGE_HARNESS: "pi", JUDGE_MODEL: "any-model" }).success).toBe(true);
    expect(schema.parse({}).JUDGE_MODEL_THINKING).toBe("high");
    expect(evalConfigSchema("medium").parse({}).JUDGE_MODEL_THINKING).toBe("medium");
  });
});

describe("Copilot trace normalization", () => {
  it("retains assistant messages, tool evidence, session ID, and summed usage", () => {
    const result = decodeCopilot(trace, "Review", model);
    expect(result.output).toBe("Recommendation");
    expect(result.sessionId).toBe("session-123");
    expect(result.usage).toEqual({ model, inputTokens: 30, outputTokens: 12, reasoningTokens: 2 });
    expect(result.events).toContainEqual({ type: "tool_call", id: "call-1", name: "view", arguments: { path: "SPEC.md" } });
    expect(result.events).toContainEqual({ type: "tool_result", toolCallId: "call-1", name: "view", content: "A spec", metadata: { success: true } });
  });

  it("does not mistake subagent messages for the final response", () => {
    const raw = trace.split("\n");
    raw.splice(-1, 0, JSON.stringify({ type: "assistant.message", agentId: "child", data: { content: "Child response" } }));
    expect(decodeCopilot(raw.join("\n"), "Review").output).toBe("Recommendation");
  });

  it("preserves a custom apply_patch tool's string input", () => {
    const raw = [
      { type: "tool.execution_start", data: { toolCallId: "patch", toolName: "apply_patch", arguments: "*** Begin Patch" } },
      { type: "tool.execution_complete", data: { toolCallId: "patch", success: true, result: { content: "Updated" } } },
      { type: "assistant.message", data: { content: "Done" } },
      { type: "result", sessionId: "session-123", exitCode: 0 },
    ].map(event => JSON.stringify(event)).join("\n");
    expect(decodeCopilot(raw, "Review").events).toContainEqual({
      type: "tool_call", id: "patch", name: "apply_patch", arguments: { value: "*** Begin Patch" },
    });
  });

  it("preserves tool failures and rejects failed, malformed, truncated or response-free runs", () => {
    const failedTool = [
      { type: "tool.execution_start", data: { toolCallId: "1", toolName: "view" } },
      { type: "tool.execution_complete", data: { toolCallId: "1", success: false, error: { message: "Denied" } } },
      { type: "assistant.message", data: { content: "Done" } },
      { type: "result", exitCode: 0 },
    ].map(event => JSON.stringify(event)).join("\n");
    expect(decodeCopilot(failedTool, "Review").events).toContainEqual({
      type: "tool_result", toolCallId: "1", name: "view", content: "Denied", metadata: { success: false },
    });
    for (const invalid of [
      "not json", trace.split("\n").slice(0, -1).join("\n"),
      '{"type":"result","exitCode":1}', '{"type":"result","exitCode":0}',
      `${trace}\n{"type":"session.error","data":{"message":"failed"}}`,
      '{"type":"tool.execution_complete","data":{"toolCallId":"unknown","success":true}}\n{"type":"result","exitCode":0}',
    ]) expect(() => decodeCopilot(invalid, "Review")).toThrow();
  });
});

describe("Copilot CLI execution", () => {
  it.skipIf(!process.env.SKILL_EVAL_SANDBOX_INTEGRATION)("isolates the candidate and records invocation and snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "copilot-harness-test-"));
    try {
      const executable = join(directory, "fake-copilot.mjs");
      const expected = join(directory, "expected.txt");
      await writeFile(expected, "Synthetic expected result");
      await writeFile(executable, `#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { getCACertificates } from "node:tls";
const outside = ${JSON.stringify(expected)};
const isDenied = error => ["EACCES", "EPERM", "ENOENT"].includes(error.code);
assert.equal(readFileSync("SPEC.md", "utf8"), "A spec");
assert.equal(process.env.SSL_CERT_FILE, process.env.NODE_EXTRA_CA_CERTS);
assert.ok(getCACertificates("extra").length > 0);
assert.throws(() => writeFileSync(process.env.SSL_CERT_FILE, "replacement"), isDenied);
assert.throws(() => readFileSync(outside, "utf8"), isDenied);
assert.throws(() => linkSync(outside, "outside-hardlink"), isDenied);
symlinkSync(outside, "outside-symlink");
assert.throws(() => readFileSync("outside-symlink", "utf8"), isDenied);
const child = spawnSync("/bin/cat", [outside]);
assert.equal(child.error, undefined);
assert.notEqual(child.status, 0);
unlinkSync("outside-symlink");
process.stdin.resume();
process.stdin.on("end", () => { writeFileSync("result.md", "Updated"); process.stdout.write(${JSON.stringify(trace)}); });
`);
      await chmod(executable, 0o755);
      const skill = join(directory, "SKILL.md");
      await writeFile(skill, "Review the spec.");
      vi.stubEnv("COPILOT_CLI", executable);
      vi.stubEnv("EVAL_RUN_DIR", directory);
      const harness = skillHarness({ harness: "copilot", model, skillPath: skill });
      const run = await harness.run(
        { id: "copilot-test", prompt: "Review", files: { "SPEC.md": "A spec" }, history: [], tags: [] },
        { artifacts: {}, setArtifact() {} },
      );
      await expect(access(run.output!.workspace)).rejects.toMatchObject({ code: "ENOENT" });
      expect(run.output!.response).toBe("Recommendation");
      expect(run.output!.after["result.md"]).toBe("Updated");
      expect(run.output!.before["result.md"]).toBeUndefined();
      const invocation = JSON.parse(await readFile(join(run.output!.artifacts, "candidate", "invocation.json"), "utf8"));
      expect(invocation.args).toContain("view,grep,rg,glob,create,edit,apply_patch,bash");
      expect(invocation.args).toContain("write");
      expect(invocation.args).toContain("shell(mkdir)");
      expect(await readFile(join(run.output!.artifacts, "candidate", "trace.jsonl"), "utf8")).toBe(trace);
    }
    finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("scopes judge tools and resumes in the isolated Copilot home", async () => {
    const directory = await mkdtemp(join(tmpdir(), "copilot-judge-test-"));
    try {
      const executable = join(directory, "fake-copilot.mjs");
      await writeFile(executable, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(trace)});\n`);
      await chmod(executable, 0o755);
      const artifacts = join(directory, "artifacts");
      const home = join(directory, "home");
      const result = await runCopilot({
        executable, model, prompt: "Fix JSON", workspace: directory, artifacts, sandbox: "read-only",
        session: { home, sessionId: "session-123" }, thinking: "high",
      });
      expect(result.sessionId).toBe("session-123");
      const invocation = JSON.parse(await readFile(join(artifacts, "invocation.json"), "utf8"));
      expect(invocation.args).toContain("--resume=session-123");
      expect(invocation.args).toContain("view,grep,rg,glob");
      expect(invocation.args).not.toContain("write");
      expect(invocation.args).not.toContain("shell(mkdir)");
      expect(invocation.args).toContain("--reasoning-effort");
    }
    finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects unsupported models before launching the CLI", async () => {
    await expect(runCopilot({
      executable: "/does/not/exist", model: "openrouter/unknown", prompt: "Review",
      workspace: tmpdir(), artifacts: tmpdir(), sandbox: "read-only",
    })).rejects.toThrow();
  });

  it.each([
    ["Authentication failed", "Copilot CLI execution failed"],
    ["Error: No authentication information found.", "Set COPILOT_GITHUB_TOKEN in the shell running the eval"],
  ])("records CLI failures when stderr reports %s", async (stderr, expectedError) => {
    const directory = await mkdtemp(join(tmpdir(), "copilot-failure-test-"));
    try {
      const executable = join(directory, "fake-copilot.mjs");
      await writeFile(executable, `#!/usr/bin/env node\nprocess.stdout.write('{"type":"result","exitCode":1}\\n');\nprocess.stderr.write(${JSON.stringify(stderr)});\nprocess.exitCode = 1;\n`);
      await chmod(executable, 0o755);
      const artifacts = join(directory, "artifacts");
      await expect(runCopilot({ executable, model, prompt: "Review", workspace: directory, artifacts, sandbox: "read-only" }))
        .rejects.toThrow(expectedError);
      expect(await readFile(join(artifacts, "trace.jsonl"), "utf8")).toContain('"exitCode":1');
      expect(await readFile(join(artifacts, "error.txt"), "utf8")).toContain(stderr);
    }
    finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("explains how to select GitHub Copilot CLI when another copilot rejects -p", async () => {
    const directory = await mkdtemp(join(tmpdir(), "copilot-wrong-cli-test-"));
    try {
      const executable = join(directory, "copilot");
      await writeFile(executable, `#!/usr/bin/env node\nprocess.stderr.write("✘ unknown shorthand flag: 'p' in -p\\n");\nprocess.exitCode = 1;\n`);
      await chmod(executable, 0o755);
      vi.stubEnv("COPILOT_CLI", executable);
      const artifacts = join(directory, "artifacts");
      await expect(runCopilot({ model, prompt: "Review", workspace: directory, artifacts, sandbox: "read-only" }))
        .rejects.toThrow("Set COPILOT_CLI to the GitHub Copilot CLI executable");
      expect(await readFile(join(artifacts, "stderr.txt"), "utf8")).toContain("unknown shorthand flag: 'p' in -p");
    }
    finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
