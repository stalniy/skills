"""Process one review event, update the records, and publish the decision graph."""
import argparse
import fcntl
import hashlib
import json
import os
import re
import sys
import tempfile
from collections import deque
from graphlib import TopologicalSorter
from pathlib import Path


ISSUE_FIELDS = ("id", "depends_on", "title", "issue", "recommendation", "rationale", "evidence")
ASSESSMENTS = ("strategic_impact", "cost", "externally_observable")
TOON_ASSESSMENT_FIELDS = tuple(
    f"{key}_{field}" for key in ASSESSMENTS for field in ("value", "reason")
)
TOON_LIST_FIELDS = ("assumptions", "alternatives")
TOON_SETTLED_FIELDS = ("status", "source", "reason", "boundary")
TOON_OPTIONAL_FIELDS = {*TOON_LIST_FIELDS, *(f"settled_{key}" for key in TOON_SETTLED_FIELDS)}
TOON_FIELDS = "|".join((*ISSUE_FIELDS, *TOON_ASSESSMENT_FIELDS))
LEGACY_TOON_FIELDS = "|".join((*ISSUE_FIELDS, *(key + "{value|reason}" for key in ASSESSMENTS)))
TOON_HEADER = re.compile(
    r"issues\[(0|[1-9][0-9]*)\|\]\{(?:"
    + re.escape(TOON_FIELDS) + r"((?:\|[a-z_]+)+)?|" + re.escape(LEGACY_TOON_FIELDS) + r")\}:"
)
TOON_QUOTED = r'"(?:[^"\\\x00-\x1f]|\\(?:["\\nrt]|u(?![dD][89a-fA-F])[0-9a-fA-F]{4}))*"'
TOON_SCALAR = re.compile(TOON_QUOTED + r'|[^"\\\x00-\x1f]+')
TOON_CELLS = {
    delimiter: re.compile(
        rf' *({TOON_QUOTED}|[^{re.escape(delimiter)}"\\\x00-\x1f]+?) *({re.escape(delimiter)}|$)'
    )
    for delimiter in ("|", ",")
}
TOON_FIELD = re.compile(r"([a-z][a-z0-9_]*)(?:\[(0|[1-9][0-9]*)\])?: *(.*)")
TOON_NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def words(value, label):
    require(isinstance(value, str) and value.strip(), f"Missing text for {label}")
    return value


def issue_id(value):
    require(isinstance(value, str) and re.fullmatch(r"I[1-9][0-9]*", value),
            f"Invalid issue ID {value!r}")
    return value


def ids(values):
    require(isinstance(values, list), "Expected an array of IDs")
    result = [issue_id(v) for v in values]
    require(len(result) == len(set(result)), "Duplicate ID")
    return result


def toon_value(token):
    if token.startswith('"') or token in ("null", "true", "false") or TOON_NUMBER.fullmatch(token):
        return json.loads(token)
    return token


def toon_cells(row, line_number, delimiter):
    cells = []
    position = 0
    while True:
        match = TOON_CELLS[delimiter].match(row, position)
        require(match is not None, f"Invalid TOON cell on line {line_number}")
        token, separator = match.groups()
        cells.append(toon_value(token))
        if not separator:
            return cells
        position = match.end()


def toon_indent(line):
    return len(line) - len(line.lstrip(" "))


def toon_object_list(lines, indent):
    items = []
    while lines and toon_indent(lines[0][1]) >= indent:
        number, line = lines.popleft()
        require(toon_indent(line) == indent and line[indent:].startswith("- "),
                f"Expected a TOON object list item on line {number}")
        lines.appendleft((number, " " * (indent + 2) + line[indent + 2:]))
        items.append(toon_object(lines, indent + 2))
    return items


def toon_object(lines, indent):
    fields = {}
    while lines and toon_indent(lines[0][1]) >= indent:
        number, line = lines.popleft()
        require(toon_indent(line) == indent, f"Unexpected TOON indentation on line {number}")
        match = TOON_FIELD.fullmatch(line[indent:])
        require(match is not None, f"Expected a TOON field on line {number}")
        key, count, token = match.groups()
        require(key not in fields, f"Duplicate TOON field {key} on line {number}")
        if count is not None:
            value = toon_cells(token, number, ",") if token else toon_object_list(lines, indent + 2)
            require(len(value) == int(count), f"TOON array count does not match on line {number}")
        elif token:
            require(TOON_SCALAR.fullmatch(token) is not None, f"Invalid TOON value on line {number}")
            value = toon_value(token)
        else:
            value = toon_object(lines, indent + 2)
        fields[key] = value
    return fields


def toon_list_cell(key, text, line_number):
    message = f"Expected an inline TOON array for {key} on line {line_number}"
    require(isinstance(text, str), message)
    match = TOON_FIELD.fullmatch(text)
    require(match is not None and match[1] == key and match[2] is not None, message)
    entries = toon_cells(match[3].rstrip(" "), line_number, ",") if match[3] else []
    require(len(entries) == int(match[2]), f"TOON {key} count does not match on line {line_number}")
    return entries


def toon_issue_table(lines, count, optional_columns):
    require(count == len(lines), "TOON issue count does not match the number of rows")
    required_width = len(ISSUE_FIELDS) + len(TOON_ASSESSMENT_FIELDS)
    issues = []
    for line_number, line in lines:
        require(line.startswith("  ") and not line.startswith("   "),
                f"Indent TOON issue rows by two spaces on line {line_number}")
        cells = toon_cells(line[2:], line_number, "|")
        require(len(cells) == required_width + len(optional_columns),
                f"Wrong number of TOON cells on line {line_number}")
        issue = dict(zip(ISSUE_FIELDS, cells))
        dependencies = issue["depends_on"]
        issue["depends_on"] = [] if dependencies is None else words(dependencies, "depends_on").split()
        if issue["title"] is None:
            del issue["title"]
        for index, key in enumerate(ASSESSMENTS):
            offset = len(ISSUE_FIELDS) + 2 * index
            issue[key] = dict(value=cells[offset], reason=cells[offset + 1])
        optional = {
            key: value for key, value in zip(optional_columns, cells[required_width:])
            if value is not None
        }
        for key in TOON_LIST_FIELDS:
            if key in optional:
                issue[key] = toon_list_cell(key, optional[key], line_number)
        settled = {
            key: optional[f"settled_{key}"] for key in TOON_SETTLED_FIELDS
            if f"settled_{key}" in optional
        }
        if settled:
            issue["settled"] = settled
        issues.append(issue)
    return issues


def read_event(text):
    text = text.removeprefix("\ufeff")
    if text.lstrip().startswith("{"):
        return json.loads(text)

    lines = deque(
        (number, line.rstrip(" "))
        for number, line in enumerate(text.rstrip("\n").split("\n"), start=1)
    )
    if len(lines) > 1 and lines[0][1] == "action: submit":
        header_index = 2 if lines[1][1].startswith("adopt_sha256:") else 1
        header = TOON_HEADER.fullmatch(lines[header_index][1]) if len(lines) > header_index else None
        if header is not None:
            event = toon_object(deque(lines.popleft() for _ in range(header_index)), 0)
            lines.popleft()
            optional_columns = header[2][1:].split("|") if header[2] else []
            require(len(set(optional_columns)) == len(optional_columns), "Duplicate optional TOON column")
            require(set(optional_columns) <= TOON_OPTIONAL_FIELDS, "Unknown optional TOON column")
            event["issues"] = toon_issue_table(lines, int(header[1]), optional_columns)
            return event
    return toon_object(lines, 0)


def validate(issue):
    issue_id(issue["id"])
    ids(issue["depends_on"])
    for key in ("issue", "recommendation", "rationale", "evidence"):
        words(issue[key], key)
    if "title" in issue:
        words(issue["title"], "title")
    for key in ASSESSMENTS:
        assessment = issue[key]
        value = assessment["value"]
        valid = type(value) is bool if key == "externally_observable" else value in ("high", "low")
        require(valid, f"Invalid {key} value")
        words(assessment["reason"], key)
    for key in ("assumptions", "alternatives"):
        entries = issue.get(key, [])
        require(isinstance(entries, list), f"Expected array for {key}")
        for entry in entries:
            words(entry, key)
    if "settled" in issue:
        settled = issue["settled"]
        require(settled["status"] in ("accepted", "out-of-scope"), "Invalid settled status")
        words(settled["source"], "authority")
        if settled["status"] == "out-of-scope":
            words(settled["boundary"], "boundary")
            words(settled["reason"], "deferral reason")


def human(issue):
    return issue["cost"]["value"] == "high" and (
        issue["strategic_impact"]["value"] == "high" or issue["externally_observable"]["value"]
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
            if "settled" in issue:
                row["resolution"] = dict(issue["settled"], decision=issue["recommendation"])
            elif human(issue):
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
        rows[key]["issue"]["strategic_impact"]["value"] != "high",
        -len(dependents[key]),
        int(key[1:]),
    ))
    return dict(frontier=frontier, recheck=recheck, apply=[] if frontier or recheck else apply)


def render_issue(issue):
    title = issue.get("title", issue["issue"]).strip().splitlines()[0]
    impact = issue["strategic_impact"]
    if impact["value"] != "high":
        impact = issue["externally_observable"]
    cost = issue["cost"]["reason"]
    recommendation = "\n".join(
        f"> {line}" if line else ">" for line in issue["recommendation"].strip().splitlines()
    )
    return (
        f"🔎 **{issue['id']} — {title}**\n\n"
        f"**Issue:** {issue['issue']}\n\n"
        f"**Why it is load-bearing:** {impact['reason']} {cost}\n\n"
        f"**Recommendation:**\n\n{recommendation}\n\n"
        "`accept (a)` · `edit (e)` · `out of scope (o)`"
    )


def update(state, event, adopted_ids):
    rows = state["records"]
    action = event["action"]
    before = route(rows)
    if action == "submit":
        changed = set()
        batch = event["issues"]
        require(isinstance(batch, list), "issues must be an array")
        ids([issue["id"] for issue in batch])
        for issue in batch:
            validate(issue)
            key = issue["id"]
            require(key not in state.get("retired", {}), f"{key} is retired")
            row = rows.setdefault(key, dict(applied=False))
            if row.get("issue") == issue and not row.get("recheck"):
                continue
            if "resolution" in row:
                require(key in adopted_ids and "settled" in issue,
                        f"{key} already settled; cite reconciled authority to replace it")
                row["previous"] = row.pop("resolution")
                row["applied"] = False
            if row.get("recheck"):
                require(available(rows, row), f"Wait for prerequisites before rechecking {key}")
            if "issue" in row and row["issue"] != issue:
                changed.add(key)
            row.update(issue=issue, recheck=False)
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
            resolution["decision"] = words(event["decision"], "edited decision")
        if action == "defer":
            resolution.update(status="out-of-scope", boundary=words(event["boundary"], "boundary"),
                              reason=words(event["reason"], "reason"), decision="Deferred.")
        row.update(resolution=resolution, applied=False)
        if action != "accept":
            invalidate(rows, [key])
    elif action == "applied":
        keys = ids(event["ids"])
        require(set(keys) <= set(before["apply"]), "IDs outside resolved frontier")
        for key in keys:
            rows[key]["applied"] = True
    elif action == "retire":
        key = event["id"]
        row = rows[key]
        require(row.get("recheck") or "resolution" not in row, "Preserve settled decisions")
        reason = words(event["reason"], "retirement reason")
        invalidate(rows, [key])
        state.setdefault("retired", {})[key] = dict(record=rows.pop(key), reason=reason)
        for child in rows.values():
            if key in parents(child):
                parents(child).remove(key)
    elif action == "facts":
        facts = event["facts"]
        require(isinstance(facts, list), "facts must be an array")
        for fact in facts:
            for key in ("fact", "source"):
                words(fact[key], key)
        state["facts"] = facts
    elif action == "finish":
        require(all(r["applied"] for r in rows.values()), "Unapplied or unresolved decisions")
    else:
        require(action == "status", f"Unknown action {action}")
    if action != "status":
        state["status"] = "complete" if action == "finish" else "in-progress"
    return route(rows)


def graph(state):
    rows = state["records"]
    affects = {key: [] for key in rows}
    for key, row in rows.items():
        for parent in parents(row):
            affects[parent].append(key)
    lines = ["---", "review-mode: interactive", "review-status: " + state["status"],
             "---", "", "# Spec review"]
    if not rows:
        lines.extend(["", "No decisions were recorded."])

    def ordered(keys):
        return sorted(keys, key=lambda k: int(k[1:]))

    for k in ordered(rows):
        row = rows[k]
        issue = row["issue"]
        resolution = row.get("resolution", {})
        lines.extend(["", "## " + k, "", "status: " + resolution.get("status", "provisional"),
                      "depends-on: [" + ", ".join(ordered(parents(row))) + "]",
                      "affects: [" + ", ".join(ordered(affects[k])) + "]",
                      "strategic-impact: " + issue["strategic_impact"]["value"],
                      "change-cost: " + issue["cost"]["value"],
                      "externally-observable: " + json.dumps(issue["externally_observable"]["value"])])
        decision = resolution.get("decision", issue["recommendation"])
        if row.get("recheck"):
            decision = "Pending reassessment after a prerequisite changed."
        evidence = [issue["evidence"]]
        if resolution.get("source") in ("user edit", "user defer") or row.get("recheck"):
            evidence.append("Original recommendation rationale: " + issue["rationale"])
        else:
            evidence.append(issue["rationale"])
        evidence.append(resolution.get("source", "Provisional recommendation."))
        assessment_labels = ("Strategic impact", "Change cost", "External observability")
        assessment = "\n".join(f"- **{label}** — {issue[key]['reason']}"
                               for key, label in zip(ASSESSMENTS, assessment_labels))
        sections = {"Issue": issue["issue"], "Decision": decision,
                    "Assessment": assessment,
                    "Evidence": "\n".join(evidence),
                    "Assumptions": "\n".join(issue.get("assumptions", [])) or "None"}
        if issue.get("alternatives"):
            sections["Alternatives"] = "\n".join(issue["alternatives"])
        if resolution.get("status") == "out-of-scope":
            sections.update({"Out-of-scope reason": resolution["reason"], "Boundary": resolution["boundary"]})
            sections["Decision"] = "Deferred."
        for title, body in sections.items():
            lines.extend(["", "### " + title, "", body])
    return "\n".join(lines) + "\n"


def write(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        tmp.write(data)
    os.replace(tmp.name, path)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(records, target, event):
    companion = target.with_name("decision-graph.md")
    require(len({records, target, companion}) == 3, "Choose distinct record and graph paths")
    require(not companion.exists(), "Reconcile automatic companion before interactive publication")
    old = target.read_bytes() if target.exists() else b""
    require(not re.search(rb"(?m)^review-status:\s*pending\s*$", old), "Automatic batch pending")
    state = json.loads(records.read_bytes()) if records.exists() else dict(
        records={}, facts=[], status="in-progress")
    adopted_ids = set()
    if old and digest(old) not in (state.get("published"), state.get("previous_graph")):
        require(event.get("adopt_sha256") == digest(old) and event["action"] == "submit",
                "Reconcile existing graph and submit with its adopt_sha256")
        adopted_ids = set(re.findall(r"(?m)^## (I[1-9][0-9]*)\s*$", old.decode()))
        require(adopted_ids <= {i["id"] for i in event["issues"]}, "Account for every existing graph ID")
    result = update(state, event, adopted_ids)
    frontier_markdown = "\n\n".join(
        render_issue(state["records"][key]["issue"]) for key in result["frontier"]
    )
    published = graph(state).encode()
    state.update(previous_graph=digest(old), published=digest(published))
    write(records, (json.dumps(state, indent=2, ensure_ascii=False) + "\n").encode())
    write(target, published)
    return dict(status=state["status"], **result, frontier_markdown=frontier_markdown)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", type=Path, required=True)
    parser.add_argument("--graph", type=Path, required=True)
    args = parser.parse_args()
    records, target = args.records.resolve(), args.graph.resolve()
    event = read_event(sys.stdin.read())
    target.parent.mkdir(parents=True, exist_ok=True)
    records.parent.mkdir(parents=True, exist_ok=True)
    directory = os.open(target.parent, os.O_RDONLY)
    try:
        fcntl.flock(directory, fcntl.LOCK_EX)
        print(json.dumps(run(records, target, event), ensure_ascii=False))
    finally:
        os.close(directory)


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, TypeError, OSError) as error:
        sys.exit(f"Cannot route review: {error}")
