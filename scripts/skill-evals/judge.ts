import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJudgeHarness as createEvalJudgeHarness } from "vitest-evals";
import type { JudgeHarness, JudgeHarnessInput, JudgeResult, RunJudge } from "vitest-evals";
import { runCodex } from "./harness/codex.ts";
import { runPi } from "./harness/pi.ts";
import { recordTiming } from "./timing.ts";

type JudgeSession = { workspace: string; sessionDir: string; codexHome: string; artifactsRoot?: string; threadId?: string; firstPrompt?: string };
const judgeSessions = new AsyncLocalStorage<JudgeSession>();

// Owns the judge's workspace and saved session; both are deleted when the judge finishes.
async function withJudgeSession<T>(fn: () => Promise<T>, artifactsRoot?: string): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "skill-judge-"));
  const session: JudgeSession = {
    workspace: join(root, "workspace"), sessionDir: join(root, "sessions"), codexHome: join(root, "codex-home"),
    artifactsRoot,
  };
  await mkdir(session.workspace);
  try {
    return await judgeSessions.run(session, fn);
  }
  finally {
    await rm(root, { recursive: true, force: true });
  }
}

export const createJudgeHarness = (options: JudgeOptions): JudgeHarness => createEvalJudgeHarness({
  name: "rubric-judge",
  async run(judgeInput, { signal }) {
    const existing = judgeSessions.getStore();
    const input = { ...judgeInput, ...options };
    if (existing) return await judgeTurn(existing, input, signal);
    return await withJudgeSession(() => judgeTurn(judgeSessions.getStore()!, input, signal));
  },
});
export interface JudgeOptions {
  harness: "pi" | "codex";
  model: string;
  thinking?: "minimal" | "low" | "medium" | "high" | "xhigh";
}

async function judgeTurn(session: JudgeSession, input: JudgeHarnessInput & JudgeOptions, signal?: AbortSignal) {
  const artifactsRoot = session.artifactsRoot ?? process.env.EVAL_RUN_DIR ?? tmpdir();
  await mkdir(artifactsRoot, { recursive: true });
  const artifacts = await mkdtemp(join(artifactsRoot, "judge-"));
  const schemaHint = input.responseFormat?.schema
    ? `Respond with only one raw JSON object (no markdown, no code fences, no prose) matching this JSON Schema:\n${JSON.stringify(input.responseFormat.schema)}`
    : undefined;
  const resumable = input.harness === "pi";
  const model = input.model;
  const invoke = async (prompt: string, resume: boolean) => {
    const config = {
      prompt,
      workspace: session.workspace,
      artifacts,
      sandbox: "read-only",
      signal,
      model,
      thinking: input.thinking ?? "high",
    } as const;
    if (resumable) return runPi({
      ...config,
      session: { dir: session.sessionDir, resume },
    });
    const result = await runCodex({
      ...config,
      schema: input.responseFormat?.schema,
      session: { home: session.codexHome, threadId: session.threadId },
    });
    if (result.threadId) session.threadId = result.threadId;
    return result;
  };
  const turnPrompt = (...parts: (string | undefined)[]) => {
    const body = parts.filter(Boolean).join("\n\n");
    if (session.firstPrompt === undefined) {
      session.firstPrompt = body;
      return body;
    }
    return resumable || session.threadId ? body : `${session.firstPrompt}\n\n${body}`;
  };
  const resume = session.firstPrompt !== undefined;
  let result = await invoke(turnPrompt(input.system, input.prompt, schemaHint), resume);
  let output: unknown;
  for (let repair = 0; ; repair++) {
    try {
      output = parseJudgeJson(result.output);
      break;
    }
    catch (error) {
      if (repair >= MAX_JUDGE_REPAIRS) throw error;
      result = await invoke(turnPrompt(repairMessage(result.output, error), schemaHint), true);
    }
  }
  return {
    output, session: { events: result.events },
    usage: result.usage, artifacts: { directory: artifacts }, errors: [],
  };
}

const MAX_JUDGE_REPAIRS = 2;

function repairMessage(previous: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Your previous response was rejected:\n${reason}\n\nPrevious response:\n${previous}\n\nReturn the corrected response as one raw JSON object matching the schema. Keep the same grading judgments; fix only the format.`;
}

export async function gradeWithRepair(
  runJudge: RunJudge,
  request: JudgeHarnessInput,
  grade: (verdict: unknown) => JudgeResult,
  options: { artifactsRoot?: string } = {},
): Promise<JudgeResult> {
  const run = () => withJudgeSession(async () => {
    let verdict = await runJudge(request);
    for (let repair = 0; ; repair++) {
      try {
        return grade(verdict);
      }
      catch (error) {
        if (repair >= MAX_JUDGE_REPAIRS) throw error;
        verdict = await runJudge({ responseFormat: request.responseFormat, prompt: repairMessage(JSON.stringify(verdict), error) });
      }
    }
  }, options.artifactsRoot);
  if (!options.artifactsRoot) return run();
  await mkdir(options.artifactsRoot, { recursive: true });
  return recordTiming(options.artifactsRoot, "judge", run);
}

function parseJudgeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  }
  catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error(`Judge returned no JSON object: ${text.slice(0, 200)}`);
    return JSON.parse(text.slice(start, end + 1));
  }
}
