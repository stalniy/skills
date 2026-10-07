import type { CandidateInput } from "./fixtures.ts";
import type { SkillOutput } from "./harness.ts";

// Carry only project files. prepareCase regenerates the controlling skill and task.
export function continueConversation(input: CandidateInput, output: SkillOutput, prompt: string): CandidateInput {
  const files = Object.fromEntries(Object.entries(output.after).filter(([path]) =>
    path !== "TASK.md" && path !== "skill" && !path.startsWith("skill/")));
  return {
    ...input,
    files,
    prompt,
    history: [...input.history,
      { role: "user", content: input.prompt },
      { role: "assistant", content: output.response },
    ],
  };
}
