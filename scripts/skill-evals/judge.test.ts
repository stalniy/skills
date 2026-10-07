import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runJudgeHarness } from "vitest-evals";
import type { RunJudge } from "vitest-evals";
import { runCodex } from "./harness/codex.ts";
import { runPi } from "./harness/pi.ts";
import { gradeWithRepair, createJudgeHarness } from "./judge.ts";
import { gradeVerdict } from "./rubric.ts";

vi.mock("./harness/codex.ts", () => ({ runCodex: vi.fn() }));
vi.mock("./harness/pi.ts", () => ({ runPi: vi.fn() }));

let artifacts: string;
beforeEach(async () => {
  vi.resetAllMocks();
  artifacts = await mkdtemp(join(tmpdir(), "judge-test-"));
  vi.stubEnv("EVAL_RUN_DIR", artifacts);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(artifacts, { recursive: true, force: true });
});

const result = (output: string, threadId?: string) => ({ output, events: [], usage: {}, threadId });
const assertion = (index: number, status = "pass") => ({ index, status, evidence: "Observed evidence" });
const MODEL = "model";

describe.each(["pi", "codex"] as const)("%s judge execution", (agentHarness) => {
  const runner = agentHarness === "pi" ? vi.mocked(runPi) : vi.mocked(runCodex);

  it("shares a session across JSON and verdict repairs, then returns a valid failing grade", async () => {
    const threadId = agentHarness === "codex" ? "codex-thread" : undefined;
    runner.mockResolvedValueOnce(result("invalid JSON", threadId));
    runner.mockResolvedValueOnce(result(JSON.stringify({ assertions: [assertion(0)] }), threadId));
    runner.mockResolvedValueOnce(result(JSON.stringify({ assertions: [assertion(0), assertion(1, "fail")] }), threadId));
    const signal = AbortSignal.timeout(5000);
    const request = { system: "Grading instructions", prompt: "Original evidence", responseFormat: { type: "json" as const, schema: { type: "object" } } };
    const runJudge: RunJudge = input => runJudgeHarness(createJudgeHarness({ harness: agentHarness, model: MODEL }), input, { signal });

    expect((await gradeWithRepair(runJudge, request, verdict => gradeVerdict(verdict, ["A", "B"]))).score).toBe(0);
    expect(runner).toHaveBeenCalledTimes(3);
    const calls = runner.mock.calls.map(([options]) => options);
    expect(new Set(calls.map(call => call.workspace)).size).toBe(1);
    expect(calls.every(call => call.signal === signal)).toBe(true);
    expect(calls[0]!.prompt).toContain("Original evidence");
    expect(calls[1]!.prompt).toContain("Your previous response was rejected");
    expect(calls[2]!.prompt).toContain("exactly one verdict");
    if (agentHarness === "pi") {
      expect(vi.mocked(runPi).mock.calls.map(([options]) => options.session?.resume)).toEqual([false, true, true]);
    }
    else {
      const codexCalls = vi.mocked(runCodex).mock.calls.map(([options]) => options);
      expect(codexCalls.map(call => call.session?.threadId)).toEqual([undefined, threadId, threadId]);
      expect(codexCalls.every(call => call.session?.home === codexCalls[0]!.session?.home)).toBe(true);
      expect(calls[1]!.prompt).not.toContain("Original evidence");
      expect(calls[2]!.prompt).not.toContain("Original evidence");
    }
    await expect(access(calls[0]!.workspace)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves both repair budgets and cleans up after exhaustion", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      runner.mockResolvedValueOnce(result("invalid JSON"));
      runner.mockResolvedValueOnce(result("still invalid JSON"));
      runner.mockResolvedValueOnce(result(JSON.stringify({ assertions: [] })));
    }
    await expect(gradeWithRepair(
      input => runJudgeHarness(createJudgeHarness({ harness: agentHarness, model: MODEL }), input), { prompt: "Evidence" },
      verdict => gradeVerdict(verdict, ["A"]),
    )).rejects.toThrow();
    expect(runner).toHaveBeenCalledTimes(9);
    await expect(access(runner.mock.calls[0]![0].workspace)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("propagates execution failure and removes the session workspace", async () => {
    runner.mockRejectedValueOnce(new Error("Execution aborted"));
    await expect(gradeWithRepair(
      input => runJudgeHarness(createJudgeHarness({ harness: agentHarness, model: MODEL }), input), { prompt: "Evidence" },
      verdict => gradeVerdict(verdict, ["A"]),
      { artifactsRoot: artifacts },
    )).rejects.toThrow("Execution aborted");
    const timings = JSON.parse(await readFile(join(artifacts, "timings.json"), "utf8"));
    expect(timings.judge).toEqual({ durationMs: expect.any(Number), status: "failed" });
    expect(runner).toHaveBeenCalledTimes(1);
    await expect(access(runner.mock.calls[0]![0].workspace)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stores judge artifacts under the supplied eval case directory", async () => {
    runner.mockResolvedValueOnce(result(JSON.stringify({ assertions: [assertion(0)] })));
    const caseArtifacts = join(artifacts, "case-01");
    await gradeWithRepair(
      input => runJudgeHarness(createJudgeHarness({ harness: agentHarness, model: MODEL }), input),
      { prompt: "Evidence" },
      verdict => gradeVerdict(verdict, ["A"]),
      { artifactsRoot: caseArtifacts },
    );

    expect(vi.mocked(agentHarness === "pi" ? runPi : runCodex).mock.calls[0]![0].artifacts)
      .toMatch(new RegExp(`^${caseArtifacts}/judge-`));
    const timings = JSON.parse(await readFile(join(caseArtifacts, "timings.json"), "utf8"));
    expect(timings).toEqual({ skill: null, judge: { durationMs: expect.any(Number), status: "completed" } });
  });
});

it("isolates concurrent judge sessions", async () => {
  vi.mocked(runPi).mockImplementation(async () => {
    await Promise.resolve();
    return result(JSON.stringify({ assertions: [assertion(0)] }));
  });
  await Promise.all(["First evidence", "Second evidence"].map(prompt => gradeWithRepair(
    input => runJudgeHarness(createJudgeHarness({ harness: "pi", model: MODEL }), input), { prompt },
    verdict => gradeVerdict(verdict, ["A"]),
  )));
  const calls = vi.mocked(runPi).mock.calls.map(([options]) => options);
  expect(new Set(calls.map(call => call.workspace)).size).toBe(2);
  expect(calls.map(call => call.session?.resume)).toEqual([false, false]);
  for (const call of calls) await expect(access(call.workspace)).rejects.toMatchObject({ code: "ENOENT" });
});
