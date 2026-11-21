import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { expect } from "vitest";
import type { z } from "zod";
import { extractSessionResult, runAgent } from "../../scripts/skill-evals/agent.ts";
import { evalConfigSchema } from "../../scripts/skill-evals/config.ts";
import { deterministicScore } from "../../scripts/skill-evals/deterministic.ts";
import type { DeterministicExpectation } from "../../scripts/skill-evals/deterministic.ts";
import { prepareCase, snapshot } from "../../scripts/skill-evals/fixtures.ts";
import type { CandidateInput } from "../../scripts/skill-evals/fixtures.ts";
import { recordTiming } from "../../scripts/skill-evals/timing.ts";

export const config = evalConfigSchema("medium").parse(process.env);
const skillPath = join(import.meta.dirname, "../../skills/spec-grilling/SKILL.md");

export async function prepareReview(
  directory: string,
  prompt: string,
  signal: AbortSignal,
  initialHistory: NonNullable<CandidateInput["history"]> = [],
) {
  const id = basename(directory).replaceAll("_", "-");
  const files = await snapshot(join(directory, "input"));
  const root = resolve(config.SKILL_RUN_DIR ?? process.env.EVAL_RUN_DIR ?? tmpdir());
  await mkdir(root, { recursive: true });
  const artifacts = await mkdtemp(join(root, `${id}-`));
  const prepared = await prepareCase({
    skillPath,
    runnerPromptPath: join(import.meta.dirname, "REVIEW_PROMPT.md"),
    // Case names can reveal the expected decision to an agent inspecting its working directory.
    input: { id: "review", prompt, files, history: initialHistory },
  });
  const agent = {
    harness: config.SKILL_HARNESS,
    model: config.SKILL_MODEL,
    thinking: config.SKILL_MODEL_THINKING,
    workspace: prepared.workspace,
    sessionDir: prepared.sessionDir,
    signal,
  };
  const history = [...initialHistory];
  let sessionId: string | undefined;
  let before: Record<string, string> = prepared.initialFiles;
  let turnNumber = 0;

  return {
    [Symbol.asyncDispose]: () => prepared[Symbol.asyncDispose](),
    async run(expected: DeterministicExpectation, user = prompt) {
      const index = ++turnNumber;
      const turnArtifacts = join(artifacts, `turn-${index}`);
      await mkdir(turnArtifacts);
      await writeFile(join(turnArtifacts, "before.json"), JSON.stringify(before, null, 2));
      const result = await recordTiming(turnArtifacts, "skill", () => runAgent({
        ...agent, sessionId,
        prompt: sessionId ? user : prepared.prompt,
        artifacts: join(turnArtifacts, "review"),
      }));
      sessionId = result.sessionId;
      const after = await snapshot(prepared.workspace);
      await writeFile(join(turnArtifacts, "after.json"), JSON.stringify(after, null, 2));

      const score = deterministicScore(result.output, expected);
      await writeFile(join(turnArtifacts, "deterministic.json"), JSON.stringify({score, output: result.output}, null, 2));
      expect(score.problems, `Interactive frontier in ${turnArtifacts}`).toEqual([]);
      for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (path === "TASK.md" || path.startsWith("skill/")) {
          expect(after[path], `${path} in ${turnArtifacts}`).toBe(before[path]);
        }
      }

      const turn = {
        output: result.output,
        events: result.events,
        history: [...history],
        user,
        before,
        after,
        artifacts: turnArtifacts,
        async extract<Schema extends z.ZodType>(schema: Schema) {
          const extraction = await extractSessionResult({
            ...agent,
            sessionId: result.sessionId,
            artifacts: join(turnArtifacts, "extract"),
            output: { file: `eval-turn-${index}.json`, schema },
          });
          return extraction.structuredOutput;
        },
      };
      history.push({ role: "user", content: user }, { role: "assistant", content: result.output });
      before = after;
      return turn;
    },
  };
}

export type ReviewTurn = Awaited<ReturnType<Awaited<ReturnType<typeof prepareReview>>["run"]>>;

export function expectIssueActions(turn: ReviewTurn) {
  const blocks = turn.output.split(/^🔎\s+\*\*I\d+\b/gm).slice(1);
  for (const block of blocks) {
    expect(block, `Decision actions in ${turn.artifacts}`).toMatch(/accept\s*\(a\).*edit\s*\(e\).*out of scope\s*\(o\)/i);
  }
}
