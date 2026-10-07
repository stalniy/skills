# Spec-grilling evaluations

The suite contains 31 scenarios and 35 eval tests. Four scenarios have an isolated scripted follow-up. Scenario 31 runs three connected candidate turns, for 37 candidate turns across the full suite.

## Files

- `cases/<case>/input/` contains repository evidence, including nested paths.
- `cases/<case>/case.json` contains user turns, conversation history, and expected behavior.
- `../../../scripts/skill-evals/prompts/RUNNER_PROMPT.md` renders the current skill, evidence, history, and latest user turn.
- `JUDGE_RUBRIC.md` defines the semantic grading dimensions and assertion verdict format.
- `rubric.ts` enforces the schema and computes the pass rule.

The runner reads the current `../SKILL.md`. Assertions are withheld from the candidate and supplied to the judge.

## Run

From the repository root:

```sh
npm run validate:types
npm run test:scripts
npx vitest run --config vitest.evals.config.ts skills/spec-grilling/evals/spec-grilling.eval.ts -t '01-authoritative-state-ownership$'
npx vitest run --config vitest.evals.config.ts skills/spec-grilling/evals/spec-grilling.eval.ts
```

Live evals require the selected CLI and authenticated model access. Configure `SKILL_HARNESS` and `JUDGE_HARNESS` as `pi` or `codex`, with `SKILL_MODEL`, `JUDGE_MODEL`, `SKILL_MODEL_THINKING`, and `JUDGE_MODEL_THINKING`. See the runner for defaults. Live runs consume model usage. Repeat the same command three times with fixed model settings when comparing skill versions.

## Evidence and scoring

Each case artifact directory includes `timings.json`. Its `skill` and `judge`
entries contain `durationMs` (elapsed wall time) and `status` (`completed` or
`failed`). Skill timing measures the candidate harness call, excluding fixture
preparation and before/after snapshots. Judge timing includes session setup, all
JSON and verdict repairs, grading, and session cleanup. A completed judge can
return a failing grade; status describes execution, not whether the case passed.
An unstarted phase is `null`. Each conversation turn has its own artifact
directory and timings.

Each candidate turn gets a fresh temporary workspace. Isolated follow-ups use a scripted assistant response. In scenario 31, each later turn receives the actual earlier assistant responses and resulting project files, including created and deleted artifacts. The controlling skill and task are regenerated. This tests conversation and artifact continuity through supplied history; it does not test native CLI session resumption. The runner judges each turn before advancing, so a failed turn stops the trajectory.

Candidate and judge traces, file snapshots, and `deterministic.json` are recorded under `.eval-results/<timestamp>/`. Deterministic checks enforce interactive issue counts, controlling-file integrity, and absence of implementation changes. Semantic checks use judge assertions against the response, transcript, and actual before/after files. Keyword presence or absence does not establish semantic correctness.

The judge must return one evidenced verdict per assertion. The runner rejects unsupported assertions, critical failures, disallowed N/A scores, classification scores below 2, any applicable dimension below 1, or an applicable-score average below 1.6. Only scope semantics, ubiquitous language, knowledge artifacts, and author learning permit N/A under the rubric's stated conditions.

Cases 18 and 21 distinguish changing an established contract from preserving it. Case 18 allows either retaining `queued` with an explanation or presenting a concrete strategic rename decision. Case 21 requires no interactive issue for provider internals already isolated by the accepted boundary.

The script tests validate infrastructure and regressions, not live skill behavior or judge agreement with human labels. Before treating aggregate pass rates as reliable comparisons, calibrate the judge against manually labeled responses and inspect disagreement on borderline cases.
