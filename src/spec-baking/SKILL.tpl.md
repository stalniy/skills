---
name: spec-grilling-d
license: Apache-2.0
description: Review a specification interactively and build it from source requirements, settled decisions, and verification instructions.
compatibility: Requires Python 3.10 or higher and either uv or a prepared Python environment.
disable-model-invocation: true
---

The goal is **minimum sufficient certainty** for implementation.

## Language and terminology

Before review, read `GLOSSARY.md` in the project associated with the spec when present. Use its established domain terms. Normalize synonyms only after confirming they name the same concept. Report terms with multiple meanings.

Use ASD-STE100-style Simplified Technical English. Write short, direct sentences, prefer active voice, and make requirements observable and testable where possible.

## Review engine

Use the mode the user requests. If unspecified, ask them to choose chat or the interactive browser and wait for their answer.
For pasted text with no associated implementation, use the supplied text as the specification.

Use the documented commands, responses, and error messages to start, operate, and stop the review server. Read server implementation files only when diagnosing a specific failure that the documented recovery steps do not resolve, or when the user asks for a code inspection.

### Start the server

Set `$skill_dir` to the absolute path of the skill directory. Use absolute paths for the review directory (usually `.spec-oven/<spec-slug>/`) and source specification. Reuse those paths on resume. For a fresh pasted spec, replace `--spec "$spec_path"` with `--spec-stdin` and provide the text on stdin. Resume a pasted spec with `--spec "$review_dir/SPEC.md"`.

Start the spec-baking server with permission to bind to 127.0.0.1. If the execution environment requires elevated permissions for loopback, request them on the first launch attempt.

Treat bin/spec-baking as an executable. Read its source only if a launcher error requires it. Use the existing frontend build.

Start the server in a retained background session.

```sh
"$skill_dir/bin/spec-baking" start --review-dir "$review_dir" --spec "$spec_path"
```

Add `--open` for browser mode. Read the first JSON line from stdout. Keep `session_file` for client commands. If `resumed` is false, capture the source specification and begin discovery. Otherwise follow the returned routing. On resume, fetch selected records with `status` when their contents are needed. Treat the session file contents and any browser launch URL printed to stderr as credentials. Keep one persistent server session per review and stop it when requested.

If loopback access is restricted, use the applicable permission to start the listener and send local API requests. For dependency setup, see [restricted startup setup](api/README.md#startup-in-a-restricted-environment).

### Model events

Use the model-events client with the announced session path. The client reads the credential directly and returns JSON on stdout. Read review state with `status` and send all review updates through `post` as JSON on stdin.

```sh
"$skill_dir/bin/spec-baking" client --session "$session_file" post <<'JSON'
{"event":{"action":"status","ids":[]}}
JSON
```

| Request | JSON body |
| --- | --- |
| [Review event](api/review_event.schema.json), including chat replies and status | `{"event":{"action":"status","ids":[]}}` (example) |
| Report progress | `{"progress":"Identified the function that publishes approved drafts."}` |
| Answer browser clarification | `{"request_id":"<returned ID>","answer":"..."}` |

Post progress as one user-facing line of up to 240 characters. Describe the function, issue, or work underway in plain language. The server timestamps each update and shows it below the graph animation in browser mode.

Receive browser events exclusively through one persistent `next` command. The server keeps `conversation.jsonl` as a review log.

```sh
"$skill_dir/bin/spec-baking" client --session "$session_file" next
```

Run `next` once. If Codex reports that it is still running, wait on the handle Codex returned. Start another `next` only after the previous one exits and you need another browser event. The server saves browser decisions as they arrive and wakes the client when routing calls for agent work. The client retries idle polls and returns a clarification, an actionable routing result, or `{"action":"close_session"}`. For `clarification`, answer read-only using the issue’s conversation. For a routing result, follow the returned routing. Cancel any waiting client on a switch to chat and keep the server running.

### Submit and route issues

For the first `submit`, read the `issue` definition in the [event schema](api/review_event.schema.json#/$defs/issue). Post `{"event":{"action":"submit","issues":[…]}}`. The response lists IDs ready for user decisions in `frontier`. After a successful submit, follow the routing in its response directly. In browser mode, if the response has a frontier and no work for the agent, wait for browser input with next. Do not call status to confirm routing or investigate why an issue is absent from the frontier. Call status after a failed request or when the current action requires records the response did not include. When fetching records, request only the IDs you need.

Reuse IDs for revisions. Every prerequisite must exist by batch end. Give each assessment’s concrete consequence. Include the FAST function and the requirement type. Use `requirement_changes` to add exact wording, replace a source requirement by ID, or remove one by ID. Resolve overlapping changes to the same requirement in one decision. Preserve the parts of a source requirement the decision leaves in force. Use prerequisite links for decisions that must be settled first. In `verification`, write a question or instruction that tells the reviewer what to extract from the produced artifacts.

- `frontier` — In chat, fetch records with `status`. Present issues in returned frontier order with recommendation, rationale, evidence and assessments. Map `a I1`, `e I1: <revision>`, and `o I1` to `accept`, `edit`, and `defer` respectively. Capture the full deferral reason and boundary across lines.
- `recheck` — Once prerequisites are applied, consult `previous` for user direction. Resubmit the full record under its ID even if the recommendation stands. Use `retire` if the issue vanished.
- `apply` — For each ID in `requirement_changes_needed`, translate the user's revision into exact requirement changes. Send `set_requirement_changes` with `changes` mapping IDs to operation lists. Use the resulting routing to supply or confirm each ID in `verification_needed` with `set_verification`, mapping IDs to inspection instructions in `verifications`. Send an `applied` event when the agreed changes or deferral boundaries and their verification are ready. The server regenerates the specification and marks those IDs applied.

### Source capture and generated specification

On a fresh review, identify the outcome the source specification promises and state it as the goal in one or two sentences. During FAST analysis, capture the source requirements under their functions. Give each a stable ID such as `R1`, a type, and a source reference. Preserve its meaning and any stated acceptance criteria or verification. Capture explicit exclusions too. Before the first `submit`, send the [`capture_source` event](api/review_event.schema.json) with `goal`, `requirements`, and `exclusions`. If a source statement leaves an implementation choice open, submit an issue proposing the change to that requirement. On resume, reuse the goal and IDs returned in `status` under `source`.

The decision graph shows existing requirements under their functions with the label **From source spec**. The engine links decisions to source requirements they replace or remove. Source requirements stay out of the decision frontier.

The server renders `$review_dir/SPEC.md` deterministically from the saved goal, function labels, source requirements, and applied resolutions in this order.

1. **Goal** — The recorded outcome.
2. **Functional requirements** — Existing and accepted requirements grouped by function, with settled changes applied to the targeted requirements.
3. **Non-functional requirements** — Existing and accepted quality requirements, limits, and guarantees.
4. **Out of scope** — Explicit exclusions and deferred decisions, including recorded reasons and boundaries.
5. **Acceptance criteria and verification** — Each expected outcome and its inspection instruction when available, linked to the requirement or boundary it covers.

### Resume and recover

Send `status` after failed calls. Omit `ids` for all active and retired records, specify IDs for selected records, or use `[]` for routing, facts and metadata alone. Retry `applied` for pending IDs once their records are ready. After server failure, relaunch with the same paths and fresh credentials, recover with `status`, and resume in the chosen mode or offer chat.

For a resumed review that predates `capture_source`, apply settled changes to its existing specification prose before sending `applied`. The server updates that review's acceptance criteria. Use the generated workflow for fresh reviews.

`facts` replaces the entire list. Use saved facts for updates and the closing summary. For a legacy Markdown graph alone, resubmit active issues with original IDs, prerequisites, assessments, decisions and provenance. Reconcile automatic pairs through their owning workflow first.

## Issue discovery and process

The agent owns the recommendation. The user owns scope and veto.

Post a progress update when you begin FAST analysis, when you identify each function, and before gathering evidence for each ready issue. On recheck, name the issue and the uncertainty you will investigate. Report which decisions you are applying before sending `applied`. Before the final per-function pass, report which checks you are starting.

1. **Discover and analyze issues with the Function Analysis System Technique (FAST).** Apply FAST using the instructions in this step. Open [FAST reference](references/fast.md) only if the user explicitly asks for it. Start from the captured goal. Ask how each function achieves that outcome and why each supporting function is needed. Where a required function is missing or its relationship to another function is unclear, identify the decision an implementer would face and the outcome it affects. Discover issues in context of every discovered function. Record discovered functions in `$review_dir/functions.json` and use it to map requirements and issues to functions. Update the file when you discover a new function.
2. **Discover the current frontier.** Before submitting, scan each outcome promised by the specification. Include every decision whose recommendation you can make from the current evidence, whichever way the user answers the other open questions. If an answer could change a candidate’s recommendation, postpone that candidate until the prerequisite is applied. Submit the independent decisions together.
3. **Gather evidence for ready issues.** State the uncertainty and check relevant ADRs, tests, documentation, configuration, and source code in the project associated with the spec. For standalone pasted text, use the supplied spec and record any missing project evidence. Use the evidence handoff below for substantial searches. Cite what settles the issue or supports a recommendation. Keep each recommendation to one decision and its necessary consequences. When a diagram would make the recommended state transitions, dependencies, sequence, or data flow easier to understand, suggest it as an optional addition. Say what it would show. Scope it to the issue and suggest at most one diagram with up to five elements, such as states, steps, or participants. Record missing facts with their authoritative sources.
4. **Submit ready issues in one JSON batch.** Include new and revised issues, lower-impact choices, and decisions settled by evidence. Record the applied prerequisite IDs and supply the required assessments with reasons.
5. **Process the engine's response.** Follow the routing response in the engine contract. Submit user replies by issue ID. For a deferral, record why it is out of scope and the boundary that lets in-scope behavior proceed independently.
6. **Apply and repeat.** Acknowledge the IDs in `apply` and use the resulting frontier for the next round. On resume, follow the startup routing.
7. **Review each function before finishing.** When discovery finds no further issues and all resolutions are applied, go through every function in `$review_dir/functions.json`. For each function, check three things:
  - **Non-functional requirements.** What quality, limit, or guarantee does the function need to meet? Check whether the requirement is measurable where it affects an implementation decision.
  - **Edge cases.** What should happen at the limits of valid inputs, states, or event orderings?
  - **Error cases.** What should happen when an input is invalid, an operation fails partway through, or a dependency is unavailable? Check what the caller can observe and what state remains.

  Submit any new issues through the normal review process. After applying the resulting decisions, repeat this pass against the updated specification.

Send one `finish` event with the remaining factual dependencies in `facts` when fresh discovery and the per-function review find no further issues and all resolutions are applied. For a captured source, the server publishes the generated specification on finish even if there were no decisions to apply.

- **Browser mode.** Report completion while the session stays open. Keep the server running and continue polling with `next` until the server stops because of idle timeout or the user asks to stop. If the user revises a decision, follow the routing through apply, then finish again once the completion criteria are met.
- **Chat mode.** After reporting completion, ask whether to stop the session. Stop the server when the user agrees. If they want to keep the session open, leave the server running for their next message and process any revisions through the same review loop.

### Evidence handoff

For a ready uncertainty that needs a substantial search or a cross-check across sources, run a read-only evidence pass in a subagent with a fresh context. Give it only the project root, the relevant specification and glossary paths, the exact uncertainty as an open question, the review scope, and the wording of any applied prerequisite decisions. Gather the evidence directly when the lookup is small or subagents are unavailable.

Ask for a concise account of what each source establishes, with file and line citations and short excerpts for findings that affect the decision. Ask for conflicts, inferences, and missing facts with their likely authoritative sources. Use the findings to make the recommendation before submitting the batch. Open the cited lines when the excerpts leave the source's authority, meaning, or applicability unclear. The main agent owns engine calls and the user conversation.
