import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runCopilot } from "./harness/copilot.ts";

afterEach(() => vi.unstubAllEnvs());

it.skipIf(!process.env.COPILOT_CLI_INTEGRATION).each([
  { model: "gpt-5.3-codex", usePatch: true },
  { model: "claude-sonnet-5.5", usePatch: false },
])(
  "writes a nested file with the real Copilot CLI for $model and resumes with read-only tools",
  async ({ model, usePatch }) => {
    const root = await mkdtemp(join(tmpdir(), "copilot-integration-"));
    const workspace = join(root, "workspace");
    const directory = ".spec-grill/example";
    const graphPath = join(directory, "decision-graph.ai.md");
    const outsideWorkspace = join(root, "outside-workspace");
    const commands = [
      { name: "bash", args: { command: `mkdir -p ${directory}`, description: "Create graph directory" } },
      { name: "create", args: { path: graphPath, file_text: "Updated\n" } },
      { name: "bash", args: { command: "mkdir -p .spec-grill && touch unexpected.txt", description: "Check shell permissions" } },
      { name: "bash", args: { command: `mkdir -p "${outsideWorkspace}"`, description: "Check workspace boundary" } },
    ];
    const requests: { tools?: { type: string; function?: { name: string }; custom?: { name: string } }[] }[] = [];
    const server = createServer((request, response) => {
      if (request.method === "GET") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: [{ id: model, object: "model" }] }));
        return;
      }
      let input = "";
      request.on("data", chunk => input += chunk);
      request.on("end", () => {
        requests.push(JSON.parse(input));
        const index = requests.length;
        const chunk = { id: "test", object: "chat.completion.chunk", created: 1, model };
        const command = usePatch ? undefined : commands[index - 2];
        const call = index === 1
          ? { type: "function", function: { name: "view", arguments: '{"path":"SPEC.md"}' } }
          : usePatch && index === 2
            ? { type: "custom", custom: { name: "apply_patch", input: `*** Begin Patch\n*** Add File: ${graphPath}\n+Updated\n*** End Patch` } }
            : command && { type: "function", function: { name: command.name, arguments: JSON.stringify(command.args) } };
        const delta = call
          ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${index}`, ...call }] }
          : { role: "assistant", content: "PONG" };
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }] })}\n\n`);
        response.end("data: [DONE]\n\n");
      });
    });
    try {
      await mkdir(workspace);
      await writeFile(join(workspace, "SPEC.md"), "A synthetic spec.");
      await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing mock provider address");
      vi.stubEnv("COPILOT_PROVIDER_BASE_URL", `http://127.0.0.1:${address.port}/v1`);
      vi.stubEnv("COPILOT_PROVIDER_TYPE", "openai");
      vi.stubEnv("COPILOT_PROVIDER_WIRE_API", "completions");
      vi.stubEnv("COPILOT_PROVIDERS_CONFIG", "");
      const executable = process.env.COPILOT_CLI_INTEGRATION;
      const common = {
        executable, workspace, model, thinking: "medium",
      };
      const home = join(root, "home");
      const result = await runCopilot({
        ...common, prompt: "Review", artifacts: join(root, "candidate"), sandbox: "workspace-write",
        session: { home },
      });
      expect(result.output).toBe("PONG");
      expect(result.sessionId).toBeTruthy();
      expect(result.events).toContainEqual(expect.objectContaining({ type: "tool_result", name: "view", content: "A synthetic spec." }));
      expect(result.events).toContainEqual(expect.objectContaining({
        type: "tool_result", name: usePatch ? "apply_patch" : "create", metadata: { success: true },
      }));
      expect(await readFile(join(workspace, graphPath), "utf8")).toBe("Updated\n");
      if (!usePatch) {
        expect(result.events).toContainEqual(expect.objectContaining({
          type: "tool_result", toolCallId: "call_2", name: "bash", metadata: { success: true },
        }));
        for (const toolCallId of ["call_4", "call_5"]) {
          expect(result.events).toContainEqual(expect.objectContaining({
            type: "tool_result", toolCallId, name: "bash", metadata: { success: false },
          }));
        }
        await expect(readFile(join(workspace, "unexpected.txt"))).rejects.toMatchObject({ code: "ENOENT" });
        await expect(readFile(outsideWorkspace)).rejects.toMatchObject({ code: "ENOENT" });
      }
      const resumed = await runCopilot({
        ...common, prompt: "Again", artifacts: join(root, "judge"), sandbox: "read-only",
        session: { home, sessionId: result.sessionId },
      });
      expect(resumed.output).toBe("PONG");
      expect(resumed.sessionId).toBe(result.sessionId);
      expect(requests).toHaveLength(usePatch ? 4 : 7);
      expect(requests[0]!.tools?.some(tool => tool.custom?.name === "apply_patch")).toBe(usePatch);
      expect(requests[0]!.tools?.some(tool => tool.function?.name === "bash")).toBe(true);
      expect(requests.at(-1)!.tools?.some(tool => tool.custom?.name === "apply_patch"
        || ["bash", "create", "edit"].includes(tool.function?.name ?? ""))).toBe(false);
    }
    finally {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
