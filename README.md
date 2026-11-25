# Stalniy Skills

Agent skills for writing, reviewing, and improving software specifications.

## Skills

- **spec-writing** (`skills/spec-writing`): Draft specifications from user intent and codebase evidence. Use FAST to identify required functions and turn them into verifiable requirements.
- **spec-grilling** (`skills/spec-grilling`): Interactive review that resolves high-impact, costly-to-change decisions with the author, then handles lower-impact by itself.
- **spec-grilling-auto** (`skills/spec-grilling-auto`): Automatic review that records provisional decisions in an editable decision graph for later review. Built on policies from **spec-grilling**.
- **spec-review** (`skills/spec-review`): Read-only verification of a spec after grilling (jidoka: stop on defects before they become code). Reports contradictions, ADR conflicts, ambiguity, missing information, assumptions, behavior changes, and needed refactoring, and recommends which requirements to check with Quint, TLA+, or Lean. Designed to run in a subagent so the author can clarify its findings.
- **spec-learning** (`skills/spec-learning`): Separate feedback on specification-writing habits, grounded in the original draft, review findings, and author responses. Use after either grilling mode or another spec review; the review skills do not run it automatically.
- **spec-complexity-reduction** (`skills/spec-complexity-reduction`): Simplify accidental complexity in a decision graph while preserving required semantics and accepted decisions. Run on a working draft before human review; automatic pipeline integration is not yet wired. **Depends on** created desion-graph.md by either spec-grilling or spec-grilling-auto


## Use

```sh
npx skills add stalniy/skills
```

Copy or link the desired skill directory into the skills location supported by your agent. Keep the full directory so its supporting files remain available. Evals live outside the skill directories in `evals/`, so installing a skill does not copy them. Also keep `skills/references/` as a sibling of the installed skill directories; all graph producers and consumers read its [decision graph contract](skills/references/decision-graph.md).

## Development

Requires Node.js and npm. Install dependencies and run the repository checks:

```sh
npm install
npm run validate:types
npm run test:scripts
```

The behavioral evals use Pi, Codex, or GitHub Copilot CLI harnesses and invoke language models, so they require the corresponding CLI and model access. Run them with:

```sh
npm run eval:skills
```

See `evals/<skill>/README.md` for configuration and scenario details.
