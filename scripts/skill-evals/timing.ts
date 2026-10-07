import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type PhaseTiming = {
  durationMs: number;
  status: "completed" | "failed";
};
type Timings = Record<"skill" | "judge", PhaseTiming | null>;

// Phases run sequentially within a case; each conversation turn has its own artifacts.
export async function recordTiming<T>(artifacts: string, phase: keyof Timings, run: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let status: PhaseTiming["status"] = "failed";
  try {
    const result = await run();
    status = "completed";
    return result;
  }
  finally {
    const durationMs = performance.now() - started;
    const path = join(artifacts, "timings.json");
    let timings: Timings = { skill: null, judge: null };
    try {
      timings = JSON.parse(await readFile(path, "utf8")) as Timings;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    timings[phase] = { durationMs, status };
    await writeFile(path, JSON.stringify(timings, null, 2));
  }
}
