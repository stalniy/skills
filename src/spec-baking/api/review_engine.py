"""Apply review events and route decisions."""
import json
from copy import deepcopy
from datetime import datetime, timezone
from graphlib import TopologicalSorter
from pathlib import Path

from jsonschema import Draft202012Validator, ValidationError

ASSESSMENTS = {
    "strategic_impact": "Strategic impact",
    "cost": "Change cost",
    "externally_observable": "Externally observable",
}
SETTLED_FIELDS = ("status", "source", "reason", "boundary")
EVENT_VALIDATOR = Draft202012Validator(
    json.loads(Path(__file__).with_name("review_event.schema.json").read_text(encoding="utf-8"))
)

def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_event(text):
    text = text.removeprefix("\ufeff")
    return json.loads(text)


def requires_human(issue):
    return issue["cost_value"] == "high" and (
        issue["strategic_impact_value"] == "high" or issue["externally_observable_value"]
    )


def parents(row):
    return row["issue"]["depends_on"]


def invalidate(rows, changed):
    affected = set(changed)
    for key in TopologicalSorter({k: parents(r) for k, r in rows.items()}).static_order():
        row = rows[key]
        if affected.intersection(parents(row)):
            affected.add(key)
            row["recheck"] = True
            row["applied"] = False
            if row.get("resolution"):
                row["previous"] = row.pop("resolution")


def available(rows, row):
    return all(rows[key]["applied"] for key in parents(row))


def route(rows):
    frontier, recheck, apply = [], [], []
    for key, row in rows.items():
        if not available(rows, row):
            continue
        issue = row["issue"]
        if row.get("recheck"):
            recheck.append(key)
            continue
        if "resolution" not in row:
            if "settled_status" in issue:
                row["resolution"] = {
                    key: issue[f"settled_{key}"] for key in SETTLED_FIELDS if f"settled_{key}" in issue
                }
                row["resolution"]["decision"] = issue["recommendation"]
            elif requires_human(issue):
                frontier.append(key)
                continue
            else:
                row["resolution"] = dict(status="accepted", decision=issue["recommendation"],
                                         source="automatic routing")
        if not row["applied"]:
            apply.append(key)
    dependents = {key: set() for key in rows}
    dependencies = {key: parents(row) for key, row in rows.items()}
    for key in reversed(list(TopologicalSorter(dependencies).static_order())):
        for parent in dependencies[key]:
            dependents[parent].add(key)
            dependents[parent].update(dependents[key])
    frontier.sort(key=lambda key: (
        rows[key]["issue"]["strategic_impact_value"] != "high",
        -len(dependents[key]),
        int(key[1:]),
    ))
    result = dict(frontier=frontier, recheck=recheck, apply=[] if frontier or recheck else apply)
    if result["apply"]:
        result["resolutions"] = {key: deepcopy(rows[key]["resolution"]) for key in result["apply"]}
        missing = [key for key in result["apply"] if needs_verification(rows[key])]
        if missing:
            result["verification_needed"] = missing
        missing = [key for key in result["apply"] if rows[key].get("requirement_changes_stale")]
        if missing:
            result["requirement_changes_needed"] = missing
    return result


def needs_verification(row):
    verification = row["issue"].get("verification")
    return row.get("verification_stale") or not isinstance(verification, str) or not verification.strip()


def validate_requirement_changes(state, changes):
    source_ids = {requirement["id"] for requirement in state.get("source", {}).get("requirements", [])}
    targets = [change["id"] for change in changes if "id" in change]
    require(len(set(targets)) == len(targets), "Change each source requirement at most once per decision")
    for target in targets:
        require(target in source_ids, f"Unknown source requirement {target}")


def issue_title(issue):
    return issue.get("title", issue["issue"]).strip().splitlines()[0]


def assessment_values(issue):
    for key, label in ASSESSMENTS.items():
        value = issue[f"{key}_value"]
        display_value = ("Yes" if value else "No") if isinstance(value, bool) else value.capitalize()
        yield key, label, display_value


def render_issue(issue):
    assessment_lines = []
    for key, label, display_value in assessment_values(issue):
        reason = "\n  ".join(issue[f"{key}_reason"].strip().splitlines())
        assessment_lines.append(f"- **{label} ({display_value})** — {reason}")
    assessments = "\n".join(assessment_lines)
    recommendation = "\n".join(
        f"> {line}" if line else ">" for line in issue["recommendation"].strip().splitlines()
    )
    return (
        f"🔎 **{issue['id']} — {issue_title(issue)}**\n\n"
        f"**Issue:** {issue['issue']}\n\n"
        f"**Assessment**\n\n{assessments}\n\n"
        f"**Recommendation:**\n\n{recommendation}\n\n"
        "`accept (a)` · `edit (e)` · `out of scope (o)`"
    )


def update_state(state, event):
    try:
        EVENT_VALIDATOR.validate(event)
    except ValidationError as error:
        detail = error
        if error.validator == "oneOf":
            action = event["action"]
            for cause in error.context:
                branch = error.validator_value[cause.schema_path[0]]
                if branch["properties"]["action"]["const"] == action:
                    detail = cause
                    break
            else:
                raise ValueError(f"Invalid event at $.action: Unknown action {action!r}") from error
        raise ValueError(f"Invalid event at {detail.json_path}: {detail.message}") from error

    rows = state["records"]
    action = event["action"]
    before = route(rows)
    if action == "capture_source":
        source = {field: event[field] for field in ("goal", "requirements", "exclusions")}
        ids = [requirement["id"] for requirement in source["requirements"]]
        require(len(set(ids)) == len(ids), "Duplicate source requirement ID")
        if state.get("source") == source:
            return before
        require("source" not in state and not rows and not state.get("retired"),
                "Capture the source once before submitting decisions")
        state["source"] = source
    elif action == "submit":
        changed = set()
        batch = event["issues"]
        require(len({issue["id"] for issue in batch}) == len(batch), "Duplicate issue ID")
        for issue in batch:
            key = issue["id"]
            if "requirement_changes" in issue:
                require("source" in state, "Capture the source before proposing requirement changes")
                validate_requirement_changes(state, issue["requirement_changes"])
            require(key not in state.get("retired", {}), f"{key} is retired")
            row = rows.setdefault(key, dict(applied=False))
            if row.get("issue") == issue and not row.get("recheck"):
                continue
            require("resolution" not in row, f"{key} already settled; use edit or defer")
            if row.get("recheck"):
                require(available(rows, row), f"Wait for prerequisites before rechecking {key}")
            if "issue" in row and row["issue"] != issue:
                changed.add(key)
            row.update(issue=issue, recheck=False)
            row.pop("verification_stale", None)
            row.pop("requirement_changes_stale", None)
        for row in rows.values():
            require(all(k in rows for k in parents(row)), "Unknown prerequisite")
        invalidate(rows, changed)
    elif action in ("accept", "edit", "defer"):
        key = event["id"]
        row = rows[key]
        require(key in before["frontier"] or
                (action in ("edit", "defer") and "resolution" in row and available(rows, row)),
                f"{key} is not available for {action}")
        decision = row["issue"]["recommendation"]
        resolution = dict(status="accepted", source="user " + action, decision=decision)
        if action == "edit":
            resolution["decision"] = event["decision"]
        if action == "defer":
            resolution.update(status="out-of-scope", boundary=event["boundary"],
                              reason=event["reason"], decision="Deferred.")
        previous = row.get("resolution", {"status": "accepted", "decision": decision})
        changed = (previous["status"], previous.get("boundary"), previous["decision"]) != (
            resolution["status"], resolution.get("boundary"), resolution["decision"]
        )
        if changed:
            row["verification_stale"] = True
        if action == "edit" and "source" in state:
            if changed:
                row["requirement_changes_stale"] = True
            elif "requirement_changes" in previous:
                resolution["requirement_changes"] = previous["requirement_changes"]
        elif action == "defer":
            row.pop("requirement_changes_stale", None)
        row.update(resolution=resolution, applied=False)
        if action != "accept":
            invalidate(rows, [key])
    elif action == "set_requirement_changes":
        require("source" in state, "Capture the source before recording requirement changes")
        changes = event["changes"]
        require(set(changes) <= set(before["apply"]), "IDs outside resolved frontier")
        for key, operations in changes.items():
            row = rows[key]
            require(row["resolution"]["status"] == "accepted", f"{key} is deferred")
            validate_requirement_changes(state, operations)
            if row["resolution"].get("requirement_changes") == operations:
                continue
            row["resolution"]["requirement_changes"] = operations
            row.pop("requirement_changes_stale", None)
            row["verification_stale"] = True
    elif action == "set_verification":
        verifications = event["verifications"]
        require(set(verifications) <= set(before["apply"]), "IDs outside resolved frontier")
        for key, verification in verifications.items():
            rows[key]["issue"]["verification"] = verification.strip()
            rows[key].pop("verification_stale", None)
    elif action == "applied":
        keys = [key for key in event["ids"] if not rows.get(key, {}).get("applied")]
        if not keys:
            return before
        require(set(keys) <= set(before["apply"]), "IDs outside resolved frontier")
        missing = [key for key in keys if rows[key].get("requirement_changes_stale")]
        require(not missing, f"Supply requirement changes for {', '.join(missing)} before applying")
        missing = [key for key in keys if needs_verification(rows[key])]
        require(not missing, f"Supply verification for {', '.join(missing)} before applying")
        for key in keys:
            rows[key]["applied"] = True
    elif action == "retire":
        key = event["id"]
        row = rows[key]
        require(row.get("recheck") or "resolution" not in row, "Preserve settled decisions")
        invalidate(rows, [key])
        state.setdefault("retired", {})[key] = dict(record=rows.pop(key), reason=event["reason"])
        for child in rows.values():
            if key in parents(child):
                parents(child).remove(key)
    elif action == "facts":
        state["facts"] = event["facts"]
    elif action == "finish":
        require(all(r["applied"] for r in rows.values()), "Unapplied or unresolved decisions")
        if "facts" in event:
            state["facts"] = event["facts"]
    if action != "status":
        state["status"] = "complete" if action == "finish" else "in-progress"
    return route(rows)


def status_details(path, state, ids):
    records = state["records"]
    retired = state.get("retired", {})
    if ids is not None:
        records = {key: records[key] for key in ids if key in records}
        retired = {key: retired[key] for key in ids if key in retired}
    details = {
        "records": records,
        "retired": retired,
        "facts": state.get("facts", []),
        "started_at": state.get("started_at"),
        "ended_at": state.get("ended_at"),
        "records_path": str(path),
    }
    if "source" in state:
        details["source"] = state["source"]
    return details


def normalize_review(state):
    for row in state["records"].values():
        issue = row["issue"]
        for key in (*ASSESSMENTS, "settled"):
            for field, value in issue.pop(key, {}).items():
                issue.setdefault(f"{key}_{field}", value)


def review_issues(state_path, review, event, *, started_at, request_id=None, specification_path=None):
    state = deepcopy(review) if review is not None else dict(records={}, facts=[], status="in-progress")
    previous_status = state["status"]
    result = update_state(state, event)
    if previous_status != "complete" or state["status"] != "complete":
        now = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        state.setdefault("started_at", started_at or now)
        if state["status"] == "complete":
            state["ended_at"] = now
        else:
            state.pop("ended_at", None)
    result = dict(status=state["status"], **result)
    if event["action"] == "finish":
        resolutions = [row["resolution"] for row in state["records"].values()]
        duration = datetime.fromisoformat(state["ended_at"]) - datetime.fromisoformat(state["started_at"])
        result["summary"] = {
            "duration_seconds": duration.total_seconds(),
            "issue_count": len(resolutions),
            "interactive_decisions": sum(r.get("source") in ("user accept", "user edit", "user defer") for r in resolutions),
            "deferrals": sum(r["status"] == "out-of-scope" for r in resolutions),
            "automatic_decisions": sum(r.get("source") == "automatic routing" for r in resolutions),
            "facts": state.get("facts", []),
            "records_path": str(state_path),
            "specification_path": str(specification_path) if specification_path is not None else None,
        }
    if event["action"] == "status":
        result.update(status_details(state_path, state, event.get("ids")))
        return review, result
    if request_id:
        # Save the receipt with the decision so a retry can repair a missing response.
        state["last_browser_request"] = {"request_id": request_id, "result": result}
    return state, result
