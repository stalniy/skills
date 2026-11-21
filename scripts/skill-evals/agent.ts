import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { runCodex } from "./harness/codex.ts";
import { runCopilot } from "./harness/copilot.ts";
import { runPi } from "./harness/pi.ts";
import type { PiResult } from "./harness/pi.ts";

type AgentOptions = {
  harness: "codex" | "copilot" | "pi";
  model: string;
  thinking?: string;
  prompt: string;
  workspace: string;
  sessionDir: string;
  sessionId?: string;
  artifacts: string;
  signal?: AbortSignal;
};

type AgentResult = PiResult & { sessionId: string };
type OutputRequest<Schema extends z.ZodType> = { file: string; schema: Schema };
const MAX_OUTPUT_RETRIES = 2;

/** Extract a schema-defined result from the previous response in a saved session. */
export function extractSessionResult<Schema extends z.ZodType>(
  options: Omit<AgentOptions, "prompt" | "sessionId"> & { sessionId: string; output: OutputRequest<Schema> },
) {
  return runAgent({
    ...options,
    prompt: [
      "Extract the result described by the JSON Schema from your previous response.",
      "Read the schema and its field descriptions for what to extract and which values to use.",
      "Do not revisit the original task, make new recommendations, or treat this request as acceptance.",
    ].join("\n"),
  });
}

/** Run a turn, optionally writing and validating a new JSON file in the workspace. */
export function runAgent<Schema extends z.ZodType>(
  options: AgentOptions & { output: OutputRequest<Schema> },
): Promise<AgentResult & { structuredOutput: z.output<Schema> }>;
export function runAgent(options: AgentOptions): Promise<AgentResult>;
export async function runAgent(options: AgentOptions & { output?: OutputRequest<z.ZodType> }) {
  await mkdir(options.sessionDir, { recursive: true });
  const { output } = options;
  if (!output) return run(options);

  const workspace = await realpath(options.workspace);
  const outputPath = resolve(workspace, output.file);
  const file = workspaceRelativePath(workspace, outputPath);
  if (isAbsolute(output.file)) throw new Error(`Agent output path must be relative: ${output.file}`);
  const existing = await lstat(outputPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (existing) throw new Error(`Agent output already exists: ${outputPath}`);

  const instruction = `Write a JSON file at ${JSON.stringify(file)} in the workspace matching this JSON Schema:\n`
    + JSON.stringify(z.toJSONSchema(output.schema, { io: "input", unrepresentable: "any" }));
  let prompt = `${options.prompt}\n\n${instruction}`;
  let sessionId = options.sessionId;
  for (let retry = 0; ; retry++) {
    const artifacts = retry === 0 ? options.artifacts : join(options.artifacts, `retry-${retry}`);
    const result = await run({ ...options, sessionId, prompt, artifacts });
    sessionId = result.sessionId;

    const raw = await realpath(outputPath).then(path => {
      workspaceRelativePath(workspace, path);
      return readFile(path, "utf8");
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" && error.code !== "EISDIR") throw error;
    });
    if (raw !== undefined) {
      const artifactPath = join(artifacts, file);
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, raw);
    }

    try {
      if (raw === undefined) throw new Error(`The file ${JSON.stringify(file)} was not written.`);
      const structuredOutput = await output.schema.parseAsync(JSON.parse(raw));
      return { ...result, structuredOutput };
    }
    catch (error) {
      if (retry === MAX_OUTPUT_RETRIES) {
        throw new Error(`Invalid agent output in ${JSON.stringify(file)}. See ${artifacts}`, { cause: error });
      }
      const reason = error instanceof Error ? error.message : String(error);
      prompt = `The output from your last turn could not be validated:\n${reason}\n\n`
        + `Correct the file while preserving the substance of your response.\n${instruction}`;
    }
  }
}

async function run({ harness, sessionDir, sessionId, ...options }: AgentOptions): Promise<AgentResult> {
  const common = { ...options, sandbox: "workspace-write", isolateWorkspace: true } as const;
  let result: PiResult;
  switch (harness) {
    case "pi":
      result = await runPi({ ...common, session: { dir: sessionDir, sessionId } });
      break;
    case "copilot":
      result = await runCopilot({ ...common, session: { home: sessionDir, sessionId } });
      break;
    case "codex": {
      const { threadId, ...turn } = await runCodex({ ...common, session: { home: sessionDir, threadId: sessionId } });
      result = { ...turn, sessionId: threadId };
      break;
    }
  }
  const id = result.sessionId ?? sessionId;
  if (!id) throw new Error(`${harness} returned no session ID. See ${options.artifacts}`);
  return { ...result, sessionId: id };
}

function workspaceRelativePath(workspace: string, path: string): string {
  const file = relative(workspace, path);
  if (!file || isAbsolute(file) || file === ".." || file.startsWith(`..${sep}`)) {
    throw new Error(`Agent output path must be inside the workspace: ${path}`);
  }
  return file;
}
