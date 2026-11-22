# Review engine events

Use Python 3.9+ on macOS or Linux. Use `frontier_markdown` to present the current questions. When applying or rechecking decisions, reuse details already in context and extract missing records by ID from `review-records.json`. Read `facts` when updating factual dependencies or preparing the closing summary.

Send one TOON event on stdin per call. Use the templates below. The engine responds in JSON.

Submit one complete object per new or revised issue. Keep the same ID for revisions and include IDs due for `recheck` even if their recommendation still holds. All prerequisite IDs must exist by the end of the submission. Cite each source and what it establishes in `evidence`. Use `rationale` for why the recommendation follows and each assessment reason for the concrete consequence behind its value.

### TOON batch

Use this TOON 3.0 table for every submission. Keep the required columns through `externally_observable_reason` in the order shown.

```text
action: submit
issues[1|]{id|depends_on|title|issue|recommendation|rationale|evidence|strategic_impact_value|strategic_impact_reason|cost_value|cost_reason|externally_observable_value|externally_observable_reason|assumptions}:
  I1|null|Workspace ownership|Who owns a saved workspace?|Assign ownership to the creating team.|Teams retain access after staff leave.|SPEC.md requires continued team access.|high|Ownership determines authorization.|high|Changing owners requires migrating stored workspaces.|true|Team members can reopen the workspace.|"assumptions[1]: Workspaces belong to one team."
```

Set the count in `[1|]` to the number of issues. Use one line per issue, indented two spaces, with `|` between cells. Use space-separated prerequisite IDs or `null` for none. In this example, explore workspace deletion after applying `I1` and use `I1` in the new issue's `depends_on` cell. Use `null` to use the first line of the issue as the title. Write `high` or `low` for strategic impact and cost, and bare `true` or `false` for external observability. The engine combines each assessment's value and reason columns into the corresponding object.

Wrap text in double quotes if it contains a pipe, colon, bracket, brace, quote, backslash, newline, carriage return, or tab. Also quote text that starts with `-` or `#`, has leading or trailing whitespace, or looks like a number, boolean, or null. Inside quotes escape double quotes as `\"`, backslashes as `\\`, newlines as `\n`, carriage returns as `\r`, and tabs as `\t`. The engine also accepts `\uXXXX` escapes for control characters, such as `\u0000`.

Append only the optional columns used by the batch. Use `null` in a row for any declared optional column that the issue omits. Keep each row in header order.

- `assumptions` and `alternatives` each take one quoted cell holding a counted TOON array, such as `"assumptions[2]: Team ownership,Shared access"`. Quote array items that contain commas or otherwise require quoting, then escape those quotes and any backslashes for the outer cell. For example, `"alternatives[1]: \"Keep ownership, delegate deletion\""`. Include up to three credible alternatives when they affect the decision.
- For a decision established by authoritative evidence, put its actual wording in `recommendation`, use `accepted` in `settled_status`, and cite the authority in `settled_source`. For an established deferral, use `out-of-scope` and also supply `settled_reason` and `settled_boundary`. Cite what settles the decision in `evidence` and include all three assessments. A proposed solution alone remains open.

### Other events

Write `action: <name>` on the first line. Write each additional field on its own line at the same indentation.

| Action | Additional TOON fields | When to send it |
| --- | --- | --- |
| `status` | | Start an empty review or resume its recorded frontier. |
| `accept` | `id: I1` | The user accepted the presented recommendation. |
| `edit` | `id: I1`, `decision: Revised requirement.` | The user supplied replacement wording. |
| `defer` | `id: I1`, `reason: Why the concern is deferred.`, `boundary: How retained behavior proceeds independently.` | The user deferred the concern behind this boundary. |
| `applied` | `ids[1]: I1` | Each listed decision returned in `apply` is reflected in the relevant artifacts, including decisions requiring no artifact change. |
| `retire` | `id: I2`, `reason: The revised design eliminates this issue.` | A provisional or invalidated issue has ceased to exist. Its ID and history remain reserved. |
| `finish` | | All decisions are applied, factual dependencies are recorded, and fresh discovery found no further issues. |

Edits and deferrals flag affected descendants for reassessment.

Send `action: facts` to replace the list of outstanding factual dependencies. Include every fact still open. Set the count in `facts[N]:` to the number of facts, or use `facts[0]:` to clear the list.

```text
action: facts
facts[1]:
  - fact: Unknown retention period
    source: Customer retention schedule
```

Recheck with a full `submit` record for the same ID after its prerequisites are applied. Inspect any `previous` resolution and reconcile its user direction. The script records ready automatic resolutions immediately. It orders the interactive `frontier` by high strategic impact first, then by the number of distinct downstream issues, then by numeric ID. Downstream counts include direct and indirect dependents already recorded, including issues that will resolve automatically. Apply a whole resolved frontier before discovering the next one. If a call fails after writing records, resume with `status` to regenerate the graph and see what remains.

Map replies such as `a I1`, `e I1: <revision>`, and `o I1` to the corresponding events.

### Published graph

Every active issue has a node. `depends-on` lists its direct prerequisites and `affects` lists its direct dependents. Each node gives the assessment values and reasons for strategic impact, change cost, and external observability. `status` and `Evidence` show how the issue was resolved, including automatic routing. An `out-of-scope` node includes its deferral reason and boundary. Retired issues remain in the records under `retired`.

When adopting a pre-existing graph, read it first. Submit all its active IDs with their decisions, edges, assessments and provenance. Add `adopt_sha256: "<current SHA-256 hex digest>"` on the line between `action: submit` and the issue header. Preserve provisional status unless new evidence settles the choice or the engine resolves it automatically. For an automatic pair, complete reconciliation through its owning workflow and retain the reconciled pair as an archive before handing the baseline back to interactive review. Never move or republish a pending batch.
