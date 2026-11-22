---
name: spec-grilling-d
license: Apache-2.0
description: Review a specification interactively with a deterministic review engine that tracks evidence, dependencies, and decisions.
disable-model-invocation: true
---

Review the specification until it has enough certainty for implementation.

The goal is **minimum sufficient certainty**. Settle the design decisions that would otherwise send the implementer back to the author.

## Language and terminology

Before review, read `GLOSSARY.md` when present. Use its established domain terms. Normalize synonyms only after confirming they name the same concept. Report terms with multiple meanings.

Use ASD-STE100-style Simplified Technical English. Write short, direct sentences, prefer active voice, and make requirements observable and testable where possible.

## Review engine

Read the [review event contract](references/review-engine.md) before the first engine call. Reuse the specification’s review directory, conventionally `.spec-grill/<spec-slug>/`, and keep both paths stable.

```sh
python3 "$skill_dir/scripts/review-engine.py" \
  --records "$review_dir/review-records.json" \
  --graph "$review_dir/decision-graph.ai.md" < event
```

## Issue discovery and process

The agent owns the recommendation. The user owns scope and veto.

1. **Discover the current frontier.** If an unapplied decision could change a candidate's recommendation, follow that prerequisite. Explore the dependent issue after its prerequisites are applied. Gather its evidence and draft its recommendation in that later round.
2. **Gather evidence for ready issues.** State the uncertainty and check relevant ADRs, tests, documentation, configuration, and source code. Use the evidence handoff below for substantial searches. Cite what settles the issue or supports a recommendation. Keep each recommendation to one decision and its necessary consequences. Record missing facts with their authoritative sources.
3. **Submit ready issues in one batch.** Use the TOON issue table for new and revised issues, including lower-impact choices and decisions settled by evidence. Record the applied prerequisite IDs and supply the required assessments with reasons. The engine routes and orders the submitted issues and publishes every active issue in the decision graph.
4. **Process the engine's response.** Reassess `recheck` IDs once their prerequisites are applied and account for prior user decisions. Show the latest `frontier_markdown` verbatim when it is nonempty. Submit the user's replies by issue ID. For a deferral, record why it is out of scope and the boundary that lets in-scope behavior proceed independently.
5. **Apply and repeat.** Reflect each resolution returned in `apply` in the relevant project artifacts and acknowledge its ID, including when the artifacts already reflect it. On resume, check the artifacts before applying it again. Discover and submit the next frontier after applying the resolutions.

Send `finish` when fresh discovery finds no further issues, all resolutions are applied, outstanding factual dependencies are recorded, and the specification contains the acceptance criteria below. Summarize the amount of interactive decisions, deferrals, decisions applied automatically and remaining factual dependencies, and link to the published decision graph.

### Acceptance criteria

Write an `Acceptance criteria` section in the specification before finishing. Turn each active decision into a classifier the reviewer applies to the produced work. Give its decision ID, a question or instruction that tells the reviewer what to extract from the artifacts, and the explicit expected value established by the decision. For a deferred decision, state the expected scope boundary as a value the reviewer can check.

For example, a publishing specification could include this criterion.

> 1. **I1 — Article publication.** Identify which roles can publish a draft article. **Expected value** — Editors only.

For each decision, also state the expected strategic impact, later change cost, and external observability from the final review. Direct the reviewer to classify the work independently, cite artifact evidence for the observed values, and flag mismatches or missing evidence.

### Evidence handoff

For a ready uncertainty that needs a substantial search or a cross-check across sources, run a read-only evidence pass in a subagent with a fresh context. Give it only the project root, the relevant specification and glossary paths, the exact uncertainty as an open question, the review scope, and the wording of any applied prerequisite decisions. Gather the evidence directly when the lookup is small or subagents are unavailable.

Ask for a concise account of what each source establishes, with file and line citations and short excerpts for findings that affect the decision. Ask for conflicts, inferences, and missing facts with their likely authoritative sources. Use the findings to make the recommendation before submitting the batch. Open the cited lines when the excerpts leave the source's authority, meaning, or applicability unclear. The main agent owns engine calls, artifact edits, and the user conversation.
