import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordTiming } from "./timing.ts";
import { gradeWithRepair } from "./judge.ts";

let artifacts: string;
beforeEach(async () => {
  artifacts = await mkdtemp(join(tmpdir(), "timing-test-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(artifacts, { recursive: true, force: true });
});
const timings = async () => JSON.parse(await readFile(join(artifacts, "timings.json"), "utf8"));

it("stores separate phase durations and preserves the skill result when judging", async () => {
  vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(35)
    .mockReturnValueOnce(40).mockReturnValueOnce(90);
  expect(await recordTiming(artifacts, "skill", async () => "response")).toBe("response");
  expect(await timings()).toEqual({ skill: { durationMs: 25, status: "completed" }, judge: null });
  await recordTiming(artifacts, "judge", async () => undefined);
  expect(await timings()).toEqual({
    skill: { durationMs: 25, status: "completed" },
    judge: { durationMs: 50, status: "completed" },
  });
});

it("records a failed skill run and propagates its error", async () => {
  const error = new Error("Candidate timed out");
  await expect(recordTiming(artifacts, "skill", async () => { throw error; })).rejects.toBe(error);
  expect(await timings()).toEqual({ skill: { durationMs: expect.any(Number), status: "failed" }, judge: null });
});

it("includes verdict repairs in a single judge duration and preserves a valid failing grade", async () => {
  await recordTiming(artifacts, "skill", async () => undefined);
  const runJudge = vi.fn().mockResolvedValueOnce({ invalid: true }).mockResolvedValueOnce({ score: 0 });
  const verdict = await gradeWithRepair(runJudge, { prompt: "Evidence" }, value => {
    if ((value as { invalid?: boolean }).invalid) throw new Error("Invalid verdict");
    return value as { score: number };
  }, { artifactsRoot: artifacts });
  expect(verdict.score).toBe(0);
  expect(runJudge).toHaveBeenCalledTimes(2);
  expect(await timings()).toEqual({
    skill: { durationMs: expect.any(Number), status: "completed" },
    judge: { durationMs: expect.any(Number), status: "completed" },
  });
});
