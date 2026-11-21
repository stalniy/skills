import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const profile = "skill-eval";

export function workspaceSandboxArgs(readable: string[] = [], writable: string[] = [], network = false): string[] {
  const filesystem = [
    '":root" = "deny"',
    '":minimal" = "read"',
    '":workspace_roots" = { "." = "write" }',
    ...readable.map(path => `${JSON.stringify(path)} = "read"`),
    ...writable.map(path => `${JSON.stringify(path)} = "write"`),
  ].join(", ");
  return [
    "-c", `permissions.${profile} = { filesystem = { ${filesystem} }, network = { enabled = ${network} } }`,
  ];
}

export async function sandboxedInvocation(command: string, args: string[], options: {
  workspace: string;
  runtimeDir: string;
  launcherHome: string;
  env?: NodeJS.ProcessEnv;
  nodePackage?: boolean;
  readableFiles?: string[];
}) {
  const executable = await resolveExecutable(command);
  const workspace = await realpath(options.workspace);
  const runtime = await realpath(options.runtimeDir);
  const readable = [executable, ...await Promise.all((options.readableFiles ?? []).map(path => realpath(path)))];
  const node = await realpath(process.execPath);
  // Script shims and npm-installed CLIs can use the same Node runtime as Vitest.
  readable.push(node);
  if (process.platform === "darwin") readable.push("/System/Library/OpenSSL");
  if (options.nodePackage) {
    const packageRoot = findPackageRoot(dirname(executable));
    if (packageRoot) readable.push(packageRoot);
  }
  return {
    executable: await resolveExecutable("codex"),
    args: [
      "sandbox", "-C", workspace, "-P", profile,
      ...workspaceSandboxArgs([...new Set(readable)], [runtime], true),
      "--", executable, ...args,
    ],
    env: {
      ...process.env,
      ...options.env,
      CODEX_HOME: options.launcherHome,
      HOME: runtime,
      TMPDIR: runtime,
      PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ""}`,
    },
  };
}

export async function resolveExecutable(command: string): Promise<string> {
  const paths = command.includes("/") ? [resolve(command)] : (process.env.PATH ?? "").split(delimiter)
    .filter(isAbsolute).map(directory => join(directory, command));
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
    }
    catch {
      continue;
    }
    const executable = await realpath(path);
    if (basename(executable) !== "volta-shim") return executable;
    const { stdout } = await execute(join(dirname(path), "volta"), ["which", basename(path)]);
    return realpath(stdout.trim());
  }
  throw new Error(`Could not resolve executable for isolated eval: ${command}`);
}

function findPackageRoot(directory: string): string | undefined {
  // Only grant package files for npm-installed scripts, never an arbitrary parent directory.
  const parts = directory.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index < 0) return undefined;
  return parts.slice(0, index + 1).join("/");
}
