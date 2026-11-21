import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { access, mkdir, mkdtempDisposable, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { promisify } from "node:util";
import { z } from "zod";
import type { TranscriptEvent, UsageSummary } from "vitest-evals";
import { resolveExecutable, workspaceSandboxArgs } from "./workspace-sandbox.ts";

const execute = promisify(execFile);
const eventSchema = z.object({
  type: z.string(), thread_id: z.string().optional(),
  item: z.object({
    id: z.string(), type: z.string(), text: z.string().optional(),
    command: z.string().optional(), aggregated_output: z.string().optional(),
    exit_code: z.number().nullable().optional(),
  }).passthrough().optional(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).passthrough().optional(),
}).passthrough();

export async function runCodex(options: {
  prompt: string;
  workspace: string;
  artifacts: string;
  sandbox: "workspace-write" | "read-only";
  model?: string;
  thinking?: string;
  schema?: unknown;
  session?: { home: string; threadId?: string };
  signal?: AbortSignal;
  executable?: string;
  isolateWorkspace?: boolean;
}): Promise<CodexResult> {
  await mkdir(options.artifacts, { recursive: true });
  await using ephemeralHome = options.isolateWorkspace && !options.session
    ? await mkdtempDisposable(join(tmpdir(), "eval-codex-"))
    : undefined;
  const home = options.session?.home ?? ephemeralHome?.path;
  if (home) await prepareCodexHome(home);
  const command = options.executable ?? "codex";
  const executable = options.isolateWorkspace ? await resolveExecutable(command) : command;
  const args = ["exec", ...(options.isolateWorkspace ? [] : ["--sandbox", options.sandbox]), "--cd", options.workspace];
  if (options.isolateWorkspace) {
    args.push(...workspaceSandboxArgs([executable]), "-c", 'default_permissions="skill-eval"',
      "-c", 'approval_policy="never"', "--ignore-rules");
  }
  if (options.session?.threadId) args.push("resume", options.session.threadId);
  args.push("--json");
  if (!options.session) args.push("--ephemeral");
  args.push("--skip-git-repo-check", "--ignore-user-config", "-c", 'web_search="disabled"');
  if (!options.isolateWorkspace) args.push("-c", "sandbox_workspace_write.network_access=false");
  if (options.model) args.push("--model", options.model);
  if (options.thinking) args.push("-c", `model_reasoning_effort=\"${options.thinking}\"`);
  if (options.schema) {
    const schemaPath = join(options.artifacts, "response-schema.json");
    await writeFile(schemaPath, JSON.stringify(options.schema));
    args.push("--output-schema", schemaPath);
  }
  args.push(options.prompt);
  await writeFile(join(options.artifacts, "invocation.json"), JSON.stringify({
    args, model: options.model ?? "Codex default (user config ignored)", thinking: options.thinking,
  }, null, 2));
  try {
    const execution = execute(executable, args, {
      cwd: options.workspace, signal: options.signal, timeout: 240_000,
      maxBuffer: 16 * 1024 * 1024, encoding: "utf8",
      ...(home ? { env: { ...process.env, CODEX_HOME: home, ...(options.isolateWorkspace ? { HOME: home } : {}) } } : {}),
    });
    execution.child.stdin?.end();
    execution.child.stdout?.on("data", chunk => appendFileSync(join(options.artifacts, "trace.jsonl"), chunk));
    execution.child.stderr?.on("data", chunk => appendFileSync(join(options.artifacts, "stderr.txt"), chunk));
    const result = await execution;
    await writeFile(join(options.artifacts, "trace.jsonl"), result.stdout);
    await writeFile(join(options.artifacts, "stderr.txt"), result.stderr);
    return decodeCodex(result.stdout, options.prompt, options.model);
  }
  catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    if (failure.stdout !== undefined) await writeFile(join(options.artifacts, "trace.jsonl"), failure.stdout);
    await writeFile(join(options.artifacts, "error.txt"), `${failure.message}\n${failure.stderr ?? ""}`);
    throw new Error(`Codex execution failed; inspect ${options.artifacts}`, { cause: error });
  }
}

async function prepareCodexHome(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const source = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");
  const destination = join(directory, "auth.json");
  try {
    await access(destination);
  }
  catch {
    try {
      await access(source);
      await symlink(source, destination);
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

export function decodeCodex(jsonl: string, prompt: string, model?: string): CodexResult {
  const raw = jsonl.trim().split("\n").filter(Boolean).map(line => eventSchema.parse(JSON.parse(line)));
  if (!raw.some(event => event.type === "turn.completed")
    || raw.some(event => event.type === "turn.failed" || event.type === "error")) {
    throw new Error("Codex did not complete a successful turn");
  }
  const events: TranscriptEvent[] = [{ type: "message", role: "user", content: prompt }];
  let output = "";
  let threadId: string | undefined;
  const usage: UsageSummary = {};
  if (model) usage.model = model;
  for (const event of raw) {
    if (event.type === "thread.started" && event.thread_id) threadId = event.thread_id;
    if (event.usage) {
      usage.inputTokens = (usage.inputTokens ?? 0) + event.usage.input_tokens;
      usage.outputTokens = (usage.outputTokens ?? 0) + event.usage.output_tokens;
    }
    const item = event.item;
    if (event.type !== "item.completed" || !item) continue;
    if (item.type === "agent_message" && item.text) {
      output = item.text;
      events.push({ type: "message", role: "assistant", content: output });
    }
    else if (item.type === "command_execution") {
      events.push({ type: "tool_call", id: item.id, name: "shell", arguments: { command: item.command ?? "" } });
      events.push({ type: "tool_result", toolCallId: item.id, name: "shell", content: item.aggregated_output ?? "", metadata: { exitCode: item.exit_code ?? null } });
    }
  }
  if (!output.trim()) throw new Error("Codex returned no assistant response");
  return { output, events, usage, threadId };
}

export type CodexResult = {
  output: string;
  events: TranscriptEvent[];
  usage: UsageSummary;
  threadId?: string;
};
