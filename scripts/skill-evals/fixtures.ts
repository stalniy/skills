import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

const safePath = z.string().refine(value =>
  value.length > 0 && !value.startsWith("/") && !value.includes("\\")
  && value.split("/").every(part => part !== ".." && part !== "." && part !== "")
  && value !== "TASK.md" && value.split("/")[0] !== "skill", "Unsafe fixture path");
const caseSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  prompt: z.string().min(1),
  files: z.record(safePath, z.string()).refine(files => "SPEC.md" in files, "Missing SPEC.md"),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) })),
  assertions: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string())
});

const DEFAULT_RUNNER_PROMPT_PATH = join(import.meta.dirname, 'prompts', 'RUNNER_PROMPT.md');
export async function prepareCase({ input, skillPath, runnerPromptPath }: {
  input: CandidateInput;
  skillPath: string;
  runnerPromptPath?: string;
}): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), `spec-grilling-${input.id}-`));
  for (const [name, content] of Object.entries(input.files)) {
    const path = join(workspace, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await mkdir(join(workspace, "skill"));
  const [skill, template] = await Promise.all([
    readFile(skillPath, "utf8"),
    readFile(runnerPromptPath ?? DEFAULT_RUNNER_PROMPT_PATH, "utf8")
  ]);
  if (skill.includes("../references/decision-graph.md")) {
    await mkdir(join(workspace, "references"), { recursive: true });
    await cp(
      join(dirname(skillPath), "../references/decision-graph.md"),
      join(workspace, "references/decision-graph.md")
    );
  }
  await writeFile(join(workspace, "skill/SKILL.md"), skill);
  await writeFile(join(workspace, "TASK.md"), taskPrompt(input, skill, template));
  return workspace;
}

export function taskPrompt(input: CandidateInput, skill: string, template: string): string {
  const files = Object.entries(input.files).sort(([a], [b]) => a.localeCompare(b))
    .map(([name, content]) => `--- ${name} ---\n${content}`).join("\n\n");
  const transcript = input.history.map(message => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n") || "(empty)";
  const values: Record<string, string> = { skill, files, transcript, user: input.prompt };
  const prompt = template.replace(/\{(skill|files|transcript|user)\}/g, (_, key: string) => values[key]!);
  return [prompt,
    "Work only in this workspace. The skill and repository evidence above are also available as workspace files.",
    "If a decision needs user input, present the recommendation and stop. Do not simulate acceptance.",
    "Do not start implementation. Keep skill/SKILL.md and TASK.md unchanged.",
  ].join("\n\n");
}

export async function snapshot(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in eval workspace: ${entry.name}`);
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    files[absolute.slice(directory.length + 1)] = await readFile(absolute, "utf8");
  }
  return files;
}

export type SkillCase = z.infer<typeof caseSchema>;

export type CandidateInput = Omit<SkillCase, "assertions">;
