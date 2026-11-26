"""Render a review's goal, requirements, scope, and acceptance criteria."""

import stat

from acceptance_criteria import END, INTRO, START, render_criterion
from review_files import read_artifact, replace_artifact


def requirement_changes(row):
    issue, resolution = row["issue"], row["resolution"]
    return resolution.get("requirement_changes", issue.get("requirement_changes", [
        {"operation": "add", "text": resolution["decision"]},
    ]))


def bullet(text):
    first, *rest = text.strip().splitlines()
    return "\n".join([f"- {first}", *("  " + line if line else "" for line in rest)])


def render_specification(review):
    source = review["source"]
    requirements = {item["id"]: item.copy() for item in source["requirements"]}
    exclusions = list(source["exclusions"])
    changed = {}
    criteria = []
    for key, row in sorted(review["records"].items(), key=lambda item: int(item[0][1:])):
        if not row["applied"]:
            continue
        issue, resolution = row["issue"], row["resolution"]
        if resolution["status"] == "out-of-scope":
            exclusions.append(f"**{key}** — {resolution['boundary']}\n\nReason — {resolution['reason']}")
            criteria.append(render_criterion(key, row, "\n"))
            continue

        related, expected = [], []
        changes = requirement_changes(row)
        for index, change in enumerate(changes, start=1):
            operation = change["operation"]
            if operation == "add":
                identifier = key if len(changes) == 1 else f"{key}.{index}"
                requirements[identifier] = {
                    "id": identifier, "function": issue.get("function") or "General",
                    "type": issue.get("type", "functional"), "text": change["text"],
                }
            else:
                identifier = change["id"]
                if identifier in changed:
                    raise ValueError(f"{key} and {changed[identifier]} both change {identifier}. "
                                     "Resolve the overlap before applying.")
                changed[identifier] = key
                requirements[identifier].pop("criterion", None)
                requirements[identifier].pop("verification", None)
                if operation == "remove":
                    del requirements[identifier]
                else:
                    requirements[identifier]["text"] = change["text"]
            related.append(identifier)
            expected.append(change.get("text", f"Remove requirement {identifier}."))
        criteria.append(render_criterion(key, row, "\n", expected="\n\n".join(expected), requirements=related))

    sections = ["## Goal", source["goal"].strip()]
    for kind, heading in (("functional", "Functional requirements"), ("non-functional", "Non-functional requirements")):
        sections.append(f"## {heading}")
        functions = {}
        for identifier, requirement in requirements.items():
            if requirement["type"] == kind:
                group = functions.setdefault(requirement["function"], [])
                group.append(bullet(f"**{identifier}** — {requirement['text'].strip()}"))
        for function, group in functions.items():
            sections.extend([f"### {' '.join(function.split())}", "\n".join(group)])
    sections.extend(["## Out of scope", *(bullet(exclusion) for exclusion in exclusions)])
    sections.append("## Acceptance criteria and verification")
    for key, requirement in requirements.items():
        if "criterion" in requirement or "verification" in requirement:
            expected = requirement.get("criterion", requirement["text"]).strip()
            entry = f"**{key}** — {expected}"
            if "verification" in requirement:
                entry += f"\n\n{requirement['verification'].strip()}"
            sections.append(bullet(entry))
    if criteria:
        sections.extend([START, INTRO, *criteria, END])
    return "\n\n".join(sections) + "\n"


def write_specification(path, text):
    existing = read_artifact(path, newline="")
    if existing != text:
        mode = stat.S_IMODE(path.stat().st_mode) if existing is not None else None
        replace_artifact(path, text.encode("utf-8"), mode=mode)
