import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { TranscriptEvent, UsageSummary } from "vitest-evals";

const execute = promisify(execFile);
const contentSchema = z.object({
  type: z.string(), text: z.string().optional(), id: z.string().optional(), name: z.string().optional(),
  arguments: z.record(z.string(), z.json()).optional(),
}).passthrough();
const messageSchema = z.object({
  role: z.string(), content: z.array(contentSchema).optional(),
  usage: z.object({
    input: z.number(), output: z.number(), cacheRead: z.number().optional(), cacheWrite: z.number().optional(),
    reasoning: z.number().optional(), totalTokens: z.number().optional(),
  }).passthrough().optional(),
  model: z.string().optional(), toolCallId: z.string().optional(), toolName: z.string().optional(), isError: z.boolean().optional(),
}).passthrough();
const eventSchema = z.object({ type: z.string(), messages: z.array(messageSchema).optional() }).passthrough();

export async function runPi(options: {
  prompt: string;
  workspace: string;
  artifacts: string;
  sandbox: "workspace-write" | "read-only";
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  session?: { dir: string; resume: boolean };
  signal?: AbortSignal;
  executable?: string;
}): Promise<PiResult> {
  await mkdir(options.artifacts, { recursive: true });
  const args = ["-p", "--mode", "json", "--no-approve", "--no-extensions", "--no-skills",
    "--no-prompt-templates", "--no-themes", "--no-context-files"];
  if (options.session) {
    args.push("--session-dir", options.session.dir);
    if (options.session.resume) args.push("--continue");
  }
  else args.push("--no-session");
  if (options.sandbox === "read-only") args.push("--tools", "read,grep,find,ls");
  if (options.model) args.push("--model", options.model);
  if (options.thinking) args.push("--thinking", options.thinking);
  args.push("--", options.prompt);
  await writeFile(join(options.artifacts, "invocation.json"), JSON.stringify({
    args, model: options.model ?? "Pi default", sandbox: options.sandbox,
  }, null, 2));
  try {
    const execution = execute(options.executable ?? "pi", args, {
      cwd: options.workspace, signal: options.signal, timeout: 480_000,
      maxBuffer: 16 * 1024 * 1024, encoding: "utf8",
    });
    execution.child.stdin?.end();
    execution.child.stdout?.on("data", chunk => appendFileSync(join(options.artifacts, "trace.jsonl"), chunk));
    execution.child.stderr?.on("data", chunk => appendFileSync(join(options.artifacts, "stderr.txt"), chunk));
    const result = await execution;
    await writeFile(join(options.artifacts, "trace.jsonl"), result.stdout);
    await writeFile(join(options.artifacts, "stderr.txt"), result.stderr);
    return decodePi(result.stdout, options.prompt, options.model);
  }
  catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    if (failure.stdout !== undefined) await writeFile(join(options.artifacts, "trace.jsonl"), failure.stdout);
    await writeFile(join(options.artifacts, "error.txt"), `${failure.message}\n${failure.stderr ?? ""}`);
    throw new Error(`Pi execution failed; inspect ${options.artifacts}`, { cause: error });
  }
}

export function decodePi(jsonl: string, prompt: string, model?: string): PiResult {
  const raw = jsonl.trim().split("\n").filter(Boolean).map(line => eventSchema.parse(JSON.parse(line)));
  if (!raw.some(event => event.type === "agent_end") || raw.some(event => event.type === "agent_error" || event.type === "error")) {
    throw new Error("Pi did not complete a successful run");
  }
  const events: TranscriptEvent[] = [{ type: "message", role: "user", content: prompt }];
  const usage: UsageSummary = {};
  if (model) usage.model = model;
  let output = "";
  for (const message of raw.findLast(event => event.type === "agent_end")?.messages ?? []) {
    if (message.role === "assistant") {
      const text = message.content?.filter(item => item.type === "text").map(item => item.text ?? "").join("") ?? "";
      if (text) {
        output = text;
        events.push({ type: "message", role: "assistant", content: text });
      }
      if (!usage.model && message.model) usage.model = message.model;
      if (message.usage) {
        usage.inputTokens = (usage.inputTokens ?? 0) + message.usage.input;
        usage.outputTokens = (usage.outputTokens ?? 0) + message.usage.output;
        usage.reasoningTokens = (usage.reasoningTokens ?? 0) + (message.usage.reasoning ?? 0);
        usage.totalTokens = (usage.totalTokens ?? 0) + (message.usage.totalTokens
          ?? message.usage.input + message.usage.output + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0));
      }
      for (const item of message.content ?? []) {
        if (item.type === "toolCall" && item.id && item.name) {
          events.push({ type: "tool_call", id: item.id, name: item.name, arguments: item.arguments ?? {} });
        }
      }
    }
    else if (message.role === "toolResult") {
      events.push({
        type: "tool_result", toolCallId: message.toolCallId ?? "", name: message.toolName ?? "",
        content: message.content?.filter(item => item.type === "text").map(item => item.text ?? "").join("") ?? "",
        metadata: { isError: message.isError ?? false },
      });
    }
  }
  if (!output.trim()) throw new Error("Pi returned no assistant response");
  return { output, events, usage };
}

export type PiResult = {
  output: string;
  events: TranscriptEvent[];
  usage: UsageSummary;
};
