import { execFile } from "node:child_process";
import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, mkdtempDisposable, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCACertificates } from "node:tls";
import { promisify } from "node:util";
import { z } from "zod";
import type { TranscriptEvent, UsageSummary } from "vitest-evals";
import { copilotModelSchema } from "../config.ts";
import { sandboxedInvocation } from "./workspace-sandbox.ts";

const execute = promisify(execFile);
const eventSchema = z.object({
  type: z.string(),
  agentId: z.string().optional(),
  data: z.record(z.string(), z.json()).optional(),
  exitCode: z.number().optional(),
  sessionId: z.string().optional(),
}).passthrough();
const messageSchema = z.object({ content: z.string() }).passthrough();
const toolStartSchema = z.object({
  toolCallId: z.string(), toolName: z.string(), arguments: z.json().optional(),
}).passthrough();
const toolCompleteSchema = z.object({
  toolCallId: z.string(), success: z.boolean(),
  result: z.object({ content: z.string() }).passthrough().optional(),
  error: z.object({ message: z.string() }).passthrough().optional(),
}).passthrough();
const usageSchema = z.object({
  model: z.string().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
}).passthrough();

export async function runCopilot(options: {
  prompt: string;
  workspace: string;
  artifacts: string;
  sandbox: "workspace-write" | "read-only";
  model: string;
  thinking?: string;
  session?: { home: string; sessionId?: string };
  signal?: AbortSignal;
  executable?: string;
  isolateWorkspace?: boolean;
}): Promise<CopilotResult> {
  copilotModelSchema.parse(options.model);
  await mkdir(options.artifacts, { recursive: true });
  const home = options.session?.home ?? await mkdtemp(join(tmpdir(), "skill-eval-copilot-"));
  try {
    await mkdir(home, { recursive: true });
    const tools = options.sandbox === "read-only"
      ? "view,grep,rg,glob"
      : "view,grep,rg,glob,create,edit,apply_patch,bash";
    const args = [
      "-p", options.prompt, "--output-format", "json", "--no-color", "--no-auto-update",
      "--no-ask-user", "--no-custom-instructions", "--disable-builtin-mcps",
      "--disallow-temp-dir", "--available-tools", tools, "--model", options.model,
    ];
    if (options.sandbox === "workspace-write") args.push("--allow-tool", "write", "shell(mkdir)");
    if (options.thinking) args.push("--reasoning-effort", options.thinking);
    if (options.session?.sessionId) args.push(`--resume=${options.session.sessionId}`);
    await writeFile(join(options.artifacts, "invocation.json"), JSON.stringify({
      args, model: options.model, thinking: options.thinking, sandbox: options.sandbox,
    }, null, 2));
    const executable = options.executable ?? process.env.COPILOT_CLI ?? "copilot";
    const env = { ...process.env, COPILOT_HOME: home, COPILOT_SKILLS_DIRS: "", COPILOT_ALLOW_ALL: "false" };
    await using launcher = options.isolateWorkspace ? await mkdtempDisposable(join(tmpdir(), "eval-sandbox-")) : undefined;
    let invocation: { executable: string; args: string[]; env: NodeJS.ProcessEnv } = { executable, args, env };
    if (launcher) {
      const caBundle = await writeProxyTrustBundle(launcher.path, env);
      invocation = await sandboxedInvocation(executable, args, {
        workspace: options.workspace,
        runtimeDir: home,
        launcherHome: launcher.path,
        readableFiles: [caBundle],
        env: { ...env, SSL_CERT_FILE: caBundle, NODE_EXTRA_CA_CERTS: caBundle },
      });
    }
    const execution = execute(invocation.executable, invocation.args, {
      cwd: options.workspace, signal: options.signal, timeout: 480_000,
      maxBuffer: 16 * 1024 * 1024, encoding: "utf8",
      env: invocation.env,
    });
    execution.child.stdin?.end();
    execution.child.stdout?.on("data", chunk => appendFileSync(join(options.artifacts, "trace.jsonl"), chunk));
    execution.child.stderr?.on("data", chunk => appendFileSync(join(options.artifacts, "stderr.txt"), chunk));
    const result = await execution;
    await writeFile(join(options.artifacts, "trace.jsonl"), result.stdout);
    await writeFile(join(options.artifacts, "stderr.txt"), result.stderr);
    return decodeCopilot(result.stdout, options.prompt, options.model);
  }
  catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    if (failure.stdout !== undefined) await writeFile(join(options.artifacts, "trace.jsonl"), failure.stdout);
    await writeFile(join(options.artifacts, "error.txt"), `${failure.message}\n${failure.stderr ?? ""}`);
    let hint = "";
    if (failure.stderr?.includes("unknown shorthand flag: 'p' in -p")) {
      hint = " The executable rejected -p. Set COPILOT_CLI to the GitHub Copilot CLI executable.";
    }
    else if (failure.stderr?.includes("No authentication information found")) {
      hint = " GitHub Copilot CLI found no credentials in the isolated session. Set COPILOT_GITHUB_TOKEN in the shell running the eval.";
    }
    throw new Error(`Copilot CLI execution failed.${hint} Inspect ${options.artifacts}`, { cause: error });
  }
  finally {
    if (!options.session) await rm(home, { recursive: true, force: true });
  }
}

async function writeProxyTrustBundle(directory: string, env: NodeJS.ProcessEnv): Promise<string> {
  // Read host trust before launching Copilot, then expose only the PEM bundle to the sandbox.
  const roots = env.SSL_CERT_FILE
    ? await readCertificateBlocks(env.SSL_CERT_FILE)
    : [...getCACertificates("default"), ...getCACertificates("system")];
  if (env.NODE_EXTRA_CA_CERTS) roots.push(...await readCertificateBlocks(env.NODE_EXTRA_CA_CERTS));
  const path = join(directory, "tls-roots.pem");
  await writeFile(path, [...new Set(roots.map(root => root.trim()))].join("\n") + "\n", { mode: 0o600 });
  return path;
}

async function readCertificateBlocks(path: string): Promise<string[]> {
  const pem = await readFile(path, "utf8");
  const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!certificates) throw new Error(`No PEM certificates found in ${path}`);
  return certificates;
}

export function decodeCopilot(jsonl: string, prompt: string, model?: string): CopilotResult {
  const raw = jsonl.trim().split("\n").filter(Boolean).map(line => eventSchema.parse(JSON.parse(line)));
  const final = raw.findLast(event => event.type === "result");
  if (!final || final.exitCode !== 0 || raw.some(event => event.type === "session.error")) {
    throw new Error("Copilot did not complete a successful run");
  }
  const events: TranscriptEvent[] = [{ type: "message", role: "user", content: prompt }];
  const usage: UsageSummary = {};
  if (model) usage.model = model;
  const tools = new Map<string, string>();
  let output = "";
  for (const event of raw) {
    if (event.type === "assistant.usage") {
      const data = usageSchema.parse(event.data);
      if (!usage.model && data.model) usage.model = data.model;
      if (data.inputTokens !== undefined) usage.inputTokens = (usage.inputTokens ?? 0) + data.inputTokens;
      if (data.outputTokens !== undefined) usage.outputTokens = (usage.outputTokens ?? 0) + data.outputTokens;
      if (data.reasoningTokens !== undefined) usage.reasoningTokens = (usage.reasoningTokens ?? 0) + data.reasoningTokens;
    }
    else if (event.type === "assistant.message" && !event.agentId) {
      const data = messageSchema.parse(event.data);
      if (data.content.trim()) {
        output = data.content;
        events.push({ type: "message", role: "assistant", content: data.content });
      }
    }
    else if (event.type === "tool.execution_start") {
      const data = toolStartSchema.parse(event.data);
      tools.set(data.toolCallId, data.toolName);
      const args = data.arguments;
      const arguments_ = args === undefined ? {}
        : args && typeof args === "object" && !Array.isArray(args) ? args : { value: args };
      events.push({ type: "tool_call", id: data.toolCallId, name: data.toolName, arguments: arguments_ });
    }
    else if (event.type === "tool.execution_complete") {
      const data = toolCompleteSchema.parse(event.data);
      const name = tools.get(data.toolCallId);
      if (!name) throw new Error(`Copilot tool result has no matching start: ${data.toolCallId}`);
      events.push({
        type: "tool_result", toolCallId: data.toolCallId, name,
        content: data.result?.content ?? data.error?.message ?? "",
        metadata: { success: data.success },
      });
    }
  }
  if (!output.trim()) throw new Error("Copilot returned no assistant response");
  return { output, events, usage, sessionId: final.sessionId };
}

export type CopilotResult = {
  output: string;
  events: TranscriptEvent[];
  usage: UsageSummary;
  sessionId?: string;
};
