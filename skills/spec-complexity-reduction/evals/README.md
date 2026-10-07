# Complexity reduction evaluations

These are behavioral scenarios for manual or future harness evaluation. This skill has no automated behavioral runner yet. Packaging validation does not establish semantic correctness.

For each scenario, supply the skill, a specification, a graph using the shared `../../references/decision-graph.md` contract, and the stated project evidence in an isolated workspace. Invoke the skill to reduce accidental complexity. Evaluate the response and actual file changes against the assertions below, rather than matching particular wording. Do not supply expected outcomes to the candidate.

## Local redo

The spec requires rerunning a workflow with revised input after verification failure. Evidence establishes idempotent side effects and cache keys that include all relevant input. Provisional `S1` selects persistent history; provisional `S2` through `S5` depend solely on it for traversal, top-of-history restrictions, nested propagation, and pointer semantics. Independent accepted `S6` defines cache validity. Supply an unpublished working graph.

Assertions: proposes or applies local control flow; demonstrates preservation of execution and cache semantics; retains `S1` for the redo design issue; retires obsolete support issues without marking them out of scope; preserves `S6`; repairs graph references; leaves final project knowledge untouched.

## Essential durable replay

Use the same general history hotspot, but add an accepted contract requiring crash recovery and targeting a historical step. The current design is the smallest supported mechanism in the supplied evidence.

Assertions: identifies why the local loop is insufficient; preserves the accepted contract; retains justified mechanisms; does not manufacture a reduction or reopen product scope without concrete cause.

## Requirement change required

The spec explicitly requires nested redo to propagate to a parent and restart from its last checkpoint. A local retry would remove this required behavior. All design decisions are provisional.

Assertions: distinguishes provisional HOWs from required WHATs; preserves the behavior; records a concrete requirement-relaxation recommendation with its semantic cost if useful; does not silently apply the local-only alternative.

## Shared dependencies

Two upstream choices feed a shared downstream node. Simplifying one upstream choice removes a mechanism, but the other still requires part of the shared behavior. Include an independent accepted branch.

Assertions: recomputes the shared recommendation; removes only obsolete obligations and edges; preserves the remaining dependency and independent accepted branch; maintains stable issue IDs and consistent `affects` fields.

## Pending user edits

Supply an automatic pair with a pending agent baseline. In the editable copy, the user has changed a Decision and corrected an assumption. The baseline contains an obvious simplification candidate.

Assertions: reads and compares both files; leaves both byte-identical to their starting contents; does not infer acceptance; returns concrete proposed transformations with reconciliation as the next protocol action. Repeat with identical copies to verify that pending status alone protects the pair.

## Displaced complexity and missing facts

An alternative removes a coordinator but requires every caller to maintain synchronized state. Another alternative is simpler only if an external provider guarantees idempotency; no such evidence is available.

Assertions: includes caller synchronization in the comparison; rejects the false reduction; identifies the missing provider fact without inventing it; continues independent supported reductions.

## Stable second pass

Run local redo on an unpublished working graph, then invoke the skill again on the resulting files and report. Supply the same evidence.

Assertions: the second pass finds no further meaningful reduction; does not oscillate, reuse retired IDs, invent new architecture, or claim user approval; reports stability relative to known evidence and preserves any unresolved dependencies.
