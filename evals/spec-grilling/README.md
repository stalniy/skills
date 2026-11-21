# Spec-grilling evaluations

Each `cases/*/case.eval.ts` defines Vitest tests that read repository fixtures from the neighboring `input/` directory. Tests check the response format and file changes directly. Where a case needs structured facts from the response, it resumes the agent session to extract them and uses Vitest assertions on the result. Multi-turn cases finish the scripted conversation before extraction so the extraction request cannot influence the next decision. Vitest compares recommendations across turns and checks the resulting files.

The candidate opens the skill and project files in the workspace. Its prompt contains the task and conversation history. The glossary, ADR, and code discovery cases check tool results captured during the candidate turn, before extraction.

Numbered case folders take their names from the Vitest test titles. When a folder has two tests, its name summarizes both titles. Case 32 exercises all four combinations of strategic impact and change cost in one review and checks cleanup reporting order after acceptance. Cases 33 and 34 put the evidence needed to infer both criteria in an ADR and in code, respectively. Case 24 mixes independent questions with a dependent question. Cases 19, 28, and 31 check the written effects of deferral, editing, and acceptance. Case 30 introduces new evidence during cleanup and checks the graph before and after acceptance.

Each test has exactly one priority tag. `must-have` covers core skill behavior. `nice-to-have` covers additional fixtures that exercise those same rules across different contracts, costs, and cleanup values.

## Run

From the repository root, run:

```sh
npm run validate:types
npm run test:scripts
npx vitest run --config vitest.evals.config.ts --reporter=default evals/spec-grilling/cases
```

Use `--tags-filter must-have` to run the core checks or `--tags-filter nice-to-have` to run the additional scenarios.

Live evals require the selected CLI and authenticated model access. Set `SKILL_HARNESS` to `pi`, `codex`, or `copilot` and configure `SKILL_MODEL` and `SKILL_MODEL_THINKING`. See `scripts/skill-evals/config.ts` for defaults and the allowed Copilot models. The Copilot list is limited to supported VS Code agent-mode model IDs; availability also depends on the account and organization policy. Explicitly set the model for each Copilot role, since the default models are for Pi and Codex. The configured reasoning effort must be supported by that model.

For example:

```sh
SKILL_HARNESS=copilot SKILL_MODEL=gpt-5.3-codex \
  npx vitest run --config vitest.evals.config.ts --reporter=default \
  evals/spec-grilling/cases/01-presents-an-unresolved-ownership-choice-as-a-provisional-behavioral-recommendation
```

The Copilot runner requires GitHub Copilot CLI with `--output-format json` and `--reasoning-effort` support, and uses an isolated `COPILOT_HOME` for each candidate or judge session. If the CLI reports `No authentication information found`, export `COPILOT_GITHUB_TOKEN` in the shell that launches Vitest. For a personal access token, use a fine-grained token owned by your personal account with the **Copilot Requests** account permission. The CLI also accepts `GH_TOKEN` or `GITHUB_TOKEN` and can fall back to a GitHub CLI login when it can access that credential. A login stored only in the normal Copilot home is not available in the isolated home. See [GitHub Copilot CLI authentication](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli).

Check that `copilot --version` reports `GitHub Copilot CLI`. AWS Copilot also installs a `copilot` command and rejects `-p` with `unknown shorthand flag`. If both CLIs are installed, set `COPILOT_CLI` to the absolute path of the GitHub executable. Homebrew installs the GitHub `copilot-cli` cask under `$(brew --caskroom)/copilot-cli`.

Candidate runs require a Codex CLI with named permission profiles and a host that can enforce its OS sandbox. Codex applies the profile to candidate tools. Pi and Copilot run inside the same filesystem policy through `codex sandbox`. Only the temporary workspace and required CLI runtime files are accessible. The repository checkout, expected results, and captured traces stay outside the allowlist. Pi and Copilot can also use their isolated session directories.

Copilot candidates have read, search, and file-editing tools, with shell approval for `mkdir`. Built-in MCP servers and user instructions are disabled. Live runs consume model usage. Repeat the same command three times with fixed model settings when comparing skill versions.

The Copilot runner supplies a read-only TLS CA bundle to the sandbox. For a proxy with a private CA, set `NODE_EXTRA_CA_CERTS` to a trusted PEM file in the shell that launches Vitest.

Run the filesystem isolation regression against synthetic data with:

```sh
SKILL_EVAL_SANDBOX_INTEGRATION=1 npm run test:scripts
```

To test the integration with an installed GitHub Copilot CLI without authentication or model usage, run the opt-in test against its local mock provider:

```sh
COPILOT_CLI_INTEGRATION=/path/to/github-copilot \
  npx vitest run --config vitest.evals.config.ts scripts/skill-evals/copilot.integration.test.ts
```

## Evidence

Each run saves file snapshots, deterministic results, and CLI traces under `.eval-results/<timestamp>/<case-run>/turn-<n>/`. Structured extractions appear in `extract/`. Missing or invalid extraction files trigger up to two retries in the same session, each with its own artifact directory. The temporary workspace and session are removed when the test exits. Set `SKILL_RUN_DIR` to override the artifact root.
