# Spec-grilling evaluations

The suite contains 31 scenarios and 35 eval tests. Four scenarios have an isolated scripted follow-up. Scenario 31 runs three connected candidate turns, for 37 candidate turns across the full suite.

## Files

- `cases/<case>/input/` contains repository evidence, including nested paths.
- `cases/<case>/case.json` contains user turns, conversation history, and expected behavior.
- `../../scripts/skill-evals/prompts/RUNNER_PROMPT.md` renders the current skill, evidence, history, and latest user turn.
- `JUDGE_RUBRIC.md` defines the semantic grading dimensions and assertion verdict format.
- `rubric.ts` enforces the schema and computes the pass rule.

The runner reads the current `../../skills/spec-grilling/SKILL.md`. Assertions are withheld from the candidate and supplied to the judge.

## Run

From the repository root:

```sh
npm run validate:types
npm run test:scripts
npx vitest run --config vitest.evals.config.ts evals/spec-grilling/spec-grilling.eval.ts -t '01-authoritative-state-ownership$'
npx vitest run --config vitest.evals.config.ts evals/spec-grilling/spec-grilling.eval.ts
```

Live evals require the selected CLI and authenticated model access. Configure `SKILL_HARNESS` and `JUDGE_HARNESS` as `pi`, `codex`, or `copilot`, with `SKILL_MODEL`, `JUDGE_MODEL`, `SKILL_MODEL_THINKING`, and `JUDGE_MODEL_THINKING`. See `scripts/skill-evals/config.ts` for defaults and the allowed Copilot models. The Copilot list is limited to supported VS Code agent-mode model IDs; availability also depends on the account and organization policy. Explicitly set the model for each Copilot role, since the default models are for Pi and Codex. The configured reasoning effort must be supported by that model.

For example:

```sh
SKILL_HARNESS=copilot SKILL_MODEL=gpt-5.3-codex \
  JUDGE_HARNESS=copilot JUDGE_MODEL=gpt-5.3-codex \
  npx vitest run --config vitest.evals.config.ts evals/spec-grilling/spec-grilling.eval.ts -t '01-authoritative-state-ownership$'
```

The Copilot runner requires GitHub Copilot CLI with `--output-format json` and `--reasoning-effort` support, and uses an isolated `COPILOT_HOME` for each candidate or judge session. If the CLI reports `No authentication information found`, export `COPILOT_GITHUB_TOKEN` in the shell that launches Vitest. For a personal access token, use a fine-grained token owned by your personal account with the **Copilot Requests** account permission. The CLI also accepts `GH_TOKEN` or `GITHUB_TOKEN` and can fall back to a GitHub CLI login when it can access that credential. A login stored only in the normal Copilot home is not available in the isolated home. See [GitHub Copilot CLI authentication](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli).

Check that `copilot --version` reports `GitHub Copilot CLI`. AWS Copilot also installs a `copilot` command and rejects `-p` with `unknown shorthand flag`. If both CLIs are installed, set `COPILOT_CLI` to the absolute path of the GitHub executable. Homebrew installs the GitHub `copilot-cli` cask under `$(brew --caskroom)/copilot-cli`.

Copilot candidates have read, search, and file-editing tools. Their shell tool preapproves `mkdir` so models using `create` can make parent directories for decision graphs and other artifacts. Judges have read and search tools only. Built-in MCP servers and user instructions are disabled. These CLI tool permissions are not an OS-level sandbox; use an external sandbox when stronger filesystem or network isolation is required. Judge repairs resume the isolated session when the CLI supplies a session ID. Live runs consume model usage. Repeat the same command three times with fixed model settings when comparing skill versions.

To test the integration with an installed GitHub Copilot CLI without authentication or model usage, run the opt-in test against its local mock provider:

```sh
COPILOT_CLI_INTEGRATION=/path/to/github-copilot \
  npx vitest run --config vitest.evals.config.ts scripts/skill-evals/copilot.integration.test.ts
```

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

Candidate and judge traces, file snapshots, and `deterministic.json` are recorded under `.eval-results/<timestamp>/`. Copilot token usage is recorded when the CLI emits usage events; its terminal result does not necessarily include token counts. Deterministic checks enforce interactive issue counts, controlling-file integrity, and absence of implementation changes. Semantic checks use judge assertions against the response, transcript, and actual before/after files. Keyword presence or absence does not establish semantic correctness.

The judge must return one evidenced verdict per assertion. The runner rejects unsupported assertions, critical failures, disallowed N/A scores, classification scores below 2, any applicable dimension below 1, or an applicable-score average below 1.6. Only scope semantics, ubiquitous language, and knowledge artifacts permit N/A under the rubric's stated conditions. Author learning is outside this review rubric; scores from before this split include an additional dimension and are not directly comparable.

Cases 18 and 21 distinguish changing an established contract from preserving it. Case 18 allows either retaining `queued` with an explanation or presenting a concrete strategic rename decision. Case 21 requires no interactive issue for provider internals already isolated by the accepted boundary.

The script tests validate infrastructure and regressions, not live skill behavior or judge agreement with human labels. Before treating aggregate pass rates as reliable comparisons, calibrate the judge against manually labeled responses and inspect disagreement on borderline cases.
