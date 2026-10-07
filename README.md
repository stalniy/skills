# Stalniy Skills

Agent skills for reviewing and improving software specifications.

## Skills

- **spec-grilling** (`skills/spec-grilling`): Interactive review that resolves high-impact, costly-to-change decisions with the author, then handles lower-impact by itself.
- **spec-grilling-auto** (`skills/spec-grilling-auto`): Automatic review that records provisional decisions in an editable decision tree for later review.

Each skill is defined by its `SKILL.md`. The automatic skill builds on the policies in `spec-grilling/SKILL.md`.

## Use

Copy or link the desired skill directory into the skills location supported by your agent. Keep the full directory so its supporting files and evaluation fixtures remain available.

## Development

Requires Node.js and npm. Install dependencies and run the repository checks:

```sh
npm install
npm run validate:types
npm run test:scripts
```

The `spec-grilling` behavioral evals use Pi or Codex harnesses and invoke language models, so they require the corresponding CLI and model access. Run them with:

```sh
npm run eval:skills
```

The `spec-grilling-auto` directory currently contains eval scenarios and documentation, but does not have an automated eval runner. See each skill's `evals/README.md` for details.
