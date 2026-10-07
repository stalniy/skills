import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");

const skillFrontmatter = z
  .object({
    name: z
      .string()
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be lowercase letters, digits and single hyphens"),
    description: z.string().min(1).max(1024),
    license: z.string().min(1).optional(),
    compatibility: z.string().min(1).max(500).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    "allowed-tools": z.string().optional(),
    "disable-model-invocation": z.boolean().optional(),
  })
  .strict();

const openaiYaml = z
  .object({
    interface: z
      .object({
        display_name: z.string().min(1),
        short_description: z.string().min(1),
        icon_small: z.string().optional(),
        icon_large: z.string().optional(),
        brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        default_prompt: z.string().optional(),
      })
      .strict(),
    dependencies: z
      .object({
        tools: z
          .array(
            z
              .object({
                type: z.string(),
                value: z.string(),
                description: z.string().optional(),
                transport: z.string().optional(),
                url: z.string().optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    policy: z.object({ allow_implicit_invocation: z.boolean().optional() }).strict().optional(),
  })
  .strict();

const errors: string[] = [];
const fail = (file: string, message: string) =>
  errors.push(`${relative(root, file)}: ${message}`);

function checkSchema(file: string, schema: z.ZodType, data: unknown) {
  const result = schema.safeParse(data);
  if (result.success) return;
  for (const issue of result.error.issues) {
    fail(file, `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
}

function readFrontmatter(file: string): unknown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(readFileSync(file, "utf8"));
  if (!match) {
    fail(file, "missing YAML frontmatter");
    return undefined;
  }
  try {
    return parseYaml(match[1]!);
  } catch (e) {
    fail(file, `invalid frontmatter YAML: ${(e as Error).message}`);
    return undefined;
  }
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "evals" ? [] : markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

function checkLinks(file: string) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  const check = (raw: string, kind: string) => {
    const target = raw.split("#")[0]!;
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return;
    const resolved = resolve(dirname(file), decodeURI(target));
    if (resolved !== skillsDir && !resolved.startsWith(skillsDir + sep)) {
      fail(file, `${kind} escapes skills directory: ${raw}`);
    } else if (!existsSync(resolved)) {
      fail(file, `broken ${kind}: ${raw}`);
    }
  };

  const linkRe = /(?<!!)\[([^\]]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g;
  for (const match of text.matchAll(linkRe)) {
    const label = /^`([^`]+)`$/.exec(match[1]!)?.[1];
    if (label && label !== match[2]) {
      fail(file, `link text \`${label}\` does not match target ${match[2]}`);
    }
    check(match[2]!, "reference");
  }

  // Inline-code paths outside links that point into the skill tree.
  const pathRe = /`((?:\.{1,2}\/|references\/|agents\/|scripts\/|assets\/)[^`\s]+)`/g;
  for (const match of text.replace(linkRe, "").matchAll(pathRe)) {
    check(match[1]!, "path reference");
  }
}

const skillNames = readdirSync(skillsDir).filter(
  (name) => name !== "references" && statSync(join(skillsDir, name)).isDirectory(),
);

for (const name of skillNames) {
  const dir = join(skillsDir, name);
  const skillFile = join(dir, "SKILL.md");

  if (!existsSync(skillFile)) {
    fail(dir, "missing SKILL.md");
    continue;
  }

  const frontmatter = readFrontmatter(skillFile);
  if (frontmatter !== undefined) {
    checkSchema(skillFile, skillFrontmatter, frontmatter);
    const declared = (frontmatter as { name?: unknown } | null)?.name;
    if (typeof declared === "string" && declared !== name) {
      fail(skillFile, `name "${declared}" must match directory "${name}"`);
    }
  }

  const agentFile = join(dir, "agents", "openai.yaml");
  if (!existsSync(agentFile)) {
    fail(agentFile, "missing agents/openai.yaml");
  } else {
    try {
      checkSchema(agentFile, openaiYaml, parseYaml(readFileSync(agentFile, "utf8")));
    } catch (e) {
      fail(agentFile, `invalid YAML: ${(e as Error).message}`);
    }
  }

  for (const file of markdownFiles(dir)) checkLinks(file);
}

if (errors.length > 0) {
  console.error(errors.map((e) => `- ${e}`).join("\n"));
  console.error(`\n${errors.length} skill lint error(s)`);
  process.exit(1);
}
console.log(`Linted ${skillNames.length} skill(s): OK`);
