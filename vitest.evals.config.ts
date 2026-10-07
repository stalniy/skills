import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const reportDirectory = resolve(".eval-results", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(reportDirectory, { recursive: true });

export default defineConfig({
  test: {
    maxConcurrency: 5,
    strictTags: false,
    tags: [
      {
        name: 'smoke',
        description: 'Quick and cheap evals.',
      },
      {
        name: 'must-have',
        description: 'Evals is part of the core functionality',
      },
      {
        name: 'long-expensive',
        description: 'Expensive long running evals.',
      },
      {
        name: 'nice-to-have',
        description: 'Evals that are nice to suceed but not a core part of functionality.',
      },
    ],
    include: ["skills/**/*.eval.ts", "scripts/skill-evals/*.test.ts"],
    testTimeout: 540_000,
    fileParallelism: false,
    maxWorkers: 1,
    env: { EVAL_RUN_DIR: reportDirectory },
    reporters: ["vitest-evals/reporter", "json"],
    outputFile: { json: resolve(reportDirectory, "results.json") },
  },
});
