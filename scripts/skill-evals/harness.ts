import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarness } from "vitest-evals";
import { runCodex } from "./harness/codex.ts";
import { runPi } from "./harness/pi.ts";
import { prepareCase, snapshot } from "./fixtures.ts";
import type { CandidateInput } from "./fixtures.ts";
import { recordTiming } from "./timing.ts";

const HARNESSES = {
  pi: runPi,
  codex: runCodex
};

export function skillHarness(agentConfig: {
  harness: keyof typeof HARNESSES;
  model: string;
  thinking?: "minimal" | "low" | "medium" | "high" | "xhigh";
  skillPath: string;
  runDir?: string;
  runnerPromptPath?: string;
}): ReturnType<typeof createHarness<CandidateInput, SkillOutput>> {
  return createHarness<CandidateInput, SkillOutput>({
    name: "spec-grilling-codex",
    async run({ input, signal, setArtifact }) {
      const workspace = await prepareCase({
        input,
        skillPath: agentConfig.skillPath,
        runnerPromptPath: agentConfig.runnerPromptPath
      });
      const root = process.env.EVAL_RUN_DIR ?? tmpdir();
      await mkdir(root, { recursive: true });
      const artifacts = await mkdtemp(join(root, `${input.id}-`));
      setArtifact("paths", { workspace, artifacts });
      const before = await snapshot(workspace);
      await writeFile(join(artifacts, "before.json"), JSON.stringify(before, null, 2));
      const prompt = await readFile(join(workspace, "TASK.md"), "utf8");
      const result = await recordTiming(artifacts, "skill", () => HARNESSES[agentConfig.harness]({
        prompt,
        workspace,
        artifacts: join(artifacts, "candidate"),
        sandbox: "workspace-write",
        model: agentConfig.model,
        thinking: agentConfig.thinking ?? "medium",
        signal,
      }));
      const after = await snapshot(workspace);
      await writeFile(join(artifacts, "after.json"), JSON.stringify(after, null, 2));
      return {
        output: { response: result.output, before, after, workspace, artifacts },
        events: result.events, usage: result.usage,
      };
    },
  });
}

export type SkillOutput = {
  response: string;
  before: Record<string, string>;
  after: Record<string, string>;
  workspace: string;
  artifacts: string;
};
