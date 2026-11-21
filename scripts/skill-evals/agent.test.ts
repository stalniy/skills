import { access, mkdtempDisposable, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { extractSessionResult, runAgent } from "./agent.ts";
import { prepareCase } from "./fixtures.ts";
import { runPi } from "./harness/pi.ts";

vi.mock("./harness/pi.ts", () => ({ runPi: vi.fn() }));

const pi = vi.mocked(runPi);
const skillPath = resolve("skills/spec-grilling/SKILL.md");
const input = { id: "agent-test", prompt: "Review the specification.", files: { "SPEC.md": "Test spec" } };
const response = { output: "Done", events: [], usage: {}, sessionId: "review-session" };
const output = { file: "result.json", schema: z.object({ issue: z.string().describe("Name the issue under review.") }) };

beforeEach(() => pi.mockReset());

it.each([
  { invalid: "{ broken JSON", diagnostic: "JSON" },
  { invalid: '{"issue":42}', diagnostic: "expected string" },
])("retries missing and invalid output in the explicit session", async ({ invalid, diagnostic }) => {
  await using artifacts = await mkdtempDisposable(join(tmpdir(), "agent-artifacts-"));
  const extractArtifacts = join(artifacts.path, "extract");
  let workspace: string;
  let sessionDir: string;
  {
    await using prepared = await prepareCase({ input, skillPath });
    ({ workspace, sessionDir } = prepared);
    pi.mockResolvedValueOnce(response).mockResolvedValueOnce(response)
      .mockImplementationOnce(async () => {
        await writeFile(join(workspace, output.file), invalid);
        return response;
      })
      .mockImplementationOnce(async () => {
        await writeFile(join(workspace, output.file), '{"issue":"state ownership"}');
        return response;
      });

    const options = { harness: "pi" as const, model: "test-model", workspace, sessionDir };
    const review = await runAgent({ ...options, prompt: prepared.prompt, artifacts: join(artifacts.path, "review") });
    const result = await extractSessionResult({
      ...options,
      sessionId: review.sessionId,
      artifacts: extractArtifacts,
      output,
    });

    expect(result.structuredOutput).toEqual({ issue: "state ownership" });
    const calls = pi.mock.calls.map(([call]) => call);
    expect(calls.every(call => call.isolateWorkspace)).toBe(true);
    expect(calls.map(call => call.session)).toEqual([
      { dir: sessionDir, sessionId: undefined },
      ...Array.from({ length: 3 }, () => ({ dir: sessionDir, sessionId: review.sessionId })),
    ]);
    expect(calls[1]!.prompt).toContain("from your previous response");
    expect(calls[1]!.prompt).toContain("field descriptions");
    expect(calls[1]!.prompt).toContain('"description":"Name the issue under review."');
    expect(calls[2]!.prompt).toContain('"result.json" was not written');
    expect(calls[3]!.prompt).toContain(diagnostic);
  }
  await expect(access(workspace)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(sessionDir)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(extractArtifacts, "retry-1", output.file), "utf8")).toBe(invalid);
  expect(await readFile(join(extractArtifacts, "retry-2", output.file), "utf8")).toBe('{"issue":"state ownership"}');
});

it("stops after two unsuccessful repairs", async () => {
  await using artifacts = await mkdtempDisposable(join(tmpdir(), "agent-artifacts-"));
  await using prepared = await prepareCase({ input, skillPath });
  pi.mockResolvedValue(response);
  await expect(runAgent({
    harness: "pi", model: "test-model", workspace: prepared.workspace, sessionDir: prepared.sessionDir,
    artifacts: artifacts.path, prompt: prepared.prompt, output,
  })).rejects.toThrow('Invalid agent output in "result.json"');
  expect(pi).toHaveBeenCalledTimes(3);
});
