# Automatic Review Evals

Each scenario lives in `cases/<case>/`. Its `case.json` contains the title, summary, tags, user turn, and behavioral assertions; `input/` contains the repository files supplied to that turn. Existing decision-tree files are starting states, not expected outputs.

The nine cases cover:

| Case | Protocol behavior |
| --- | --- |
| `01_new_batch` | Provisional tree, dependency discovery, no provisional decisions in final knowledge |
| `02_pending_review` | Semantic edit detection and pending-batch preservation |
| `03_formatting_only_pending` | Formatting differences are not treated as decision changes |
| `04_complete_edits_and_descendants` | Batch reconciliation, selective invalidation, and a replacement batch |
| `05_multi_level_graph` | Recompute only descendants of an edited decision |
| `06_multi_level_root_change` | Recompute transitive descendants while preserving independent decisions |
| `07_scope_boundary_and_cleanup` | A deferred issue cannot silently resolve a dependent in-scope guarantee |
| `08_completed_out_of_scope` | Preserve a valid out-of-scope boundary without accepting its proposed design |
| `09_settled_cleanup` | Clean up settled specifications without inventing another review batch |

For base-policy regression, reuse the cases in `../../spec-grilling/evals/cases/` with expectations adapted to provisional file review. Preserve coverage of strategic impact and change cost, evidence, scope semantics, unknown facts, language, knowledge artifacts, and cleanup thresholds.

This checkout does not provide an automatic-review eval runner. Run the cases with a behavioral runner that loads `../SKILL.md` and its sibling `../../spec-grilling/SKILL.md`, supplies the files under `input/`, and checks the response and resulting files against every assertion. Fixture/schema checks alone do not establish model behavior.
