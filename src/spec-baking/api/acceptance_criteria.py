"""Render and update the application's acceptance criteria in a specification."""

import re
import stat

from review_engine import assessment_values, issue_title
from review_files import read_artifact, replace_artifact

START = "<!-- spec-baking:acceptance-criteria:start -->"
END = "<!-- spec-baking:acceptance-criteria:end -->"
ENTRY = re.compile(r"^<!-- spec-baking:criterion (I[1-9][0-9]*) -->\r?$", re.MULTILINE)
HEADING = re.compile(r"^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
INTRO = (
    "For each criterion, classify the work independently. Cite artifact evidence for "
    "the observed values and flag mismatches or missing evidence."
)


def render_criterion(key, row, newline, *, expected=None, requirements=()):
    issue, resolution = row["issue"], row["resolution"]
    title = re.sub(r"([\\*`_<>\[\]])", r"\\\1", issue_title(issue))
    if expected is None:
        expected = resolution["boundary"] if resolution["status"] == "out-of-scope" else resolution["decision"]
    assessments = ", ".join(f"{label}: {value}" for _, label, value in assessment_values(issue))
    paragraphs = [issue["verification"], f"**Expected value** — {expected}"]
    if requirements:
        paragraphs.append(f"**Requirements** — {', '.join(requirements)}.")
    if resolution["status"] == "out-of-scope":
        paragraphs.append(f"**Deferral reason** — {resolution['reason']}")
    paragraphs.append(f"**Expected assessments** — {assessments}.")
    lines = [f"<!-- spec-baking:criterion {key} -->", f"- **{key} — {title}**"]
    for paragraph in paragraphs:
        lines.append("")
        lines.extend("    " + line if line else "" for line in paragraph.strip().splitlines())
    return newline.join(lines)


def markdown_structure(text):
    """Locate the acceptance criteria section and its delimiters outside fenced blocks."""
    section = None
    markers = []
    fence = None
    offset = 0
    for line in text.splitlines(keepends=True):
        start = offset
        offset += len(line)
        content = line.rstrip("\r\n")
        # An initial BOM belongs to the unchanged prefix.
        if start == 0:
            content = content.removeprefix("\ufeff")
        match = FENCE.fullmatch(content)
        if fence:
            if match and match[1][0] == fence[0] and len(match[1]) >= len(fence) and not match[2].strip():
                fence = None
            continue
        if match and (match[1][0] == "~" or "`" not in match[2]):
            fence = match[1]
            continue
        if content in (START, END):
            markers.append((content, start, offset))
        match = HEADING.fullmatch(content)
        if match is None or len(match[1]) > 2:
            continue
        if section is not None and section[1] is None:
            section = section[0], start
        title = re.sub(r"[ \t]+#+[ \t]*$", "", match[2] or "").strip()
        if match[1] == "##" and title.casefold() == "acceptance criteria":
            if section is not None:
                raise ValueError("More than one Acceptance criteria section")
            section = offset, None
    if section is not None and section[1] is None:
        section = section[0], len(text)
    return section, markers, fence is not None


def update_criteria(text, changes):
    """Upsert or delete selected IDs while keeping every byte outside the region."""
    section, markers, unclosed_fence = markdown_structure(text)
    newline = (re.search(r"\r\n|\n|\r", text) or ["\n"])[0]
    entries = {}
    if markers:
        if ([marker for marker, _, _ in markers] != [START, END] or section is None
                or not (section[0] <= markers[0][1] < markers[1][1] < section[1])):
            raise ValueError("Invalid generated Acceptance criteria delimiters")
        start, end = markers[0][1], markers[1][2]
        body = text[markers[0][2]:markers[1][1]]
        matches = list(ENTRY.finditer(body))
        preamble = body[:matches[0].start()] if matches else body
        if preamble.strip() != INTRO:
            raise ValueError("Invalid generated Acceptance criteria preamble")
        for index, match in enumerate(matches):
            stop = matches[index + 1].start() if index + 1 < len(matches) else len(body)
            key = match[1]
            if key in entries:
                raise ValueError(f"Duplicate generated criterion {key}")
            entries[key] = body[match.start():stop].rstrip("\r\n")
    else:
        if not any(row is not None for row in changes.values()):
            return text
        start = end = section[1] if section is not None else len(text)
        if start == len(text) and unclosed_fence:
            raise ValueError("Close the final Markdown fence before generating acceptance criteria")

    for key, row in changes.items():
        if row is None:
            entries.pop(key, None)
        else:
            entries[key] = render_criterion(key, row, newline)

    separator = newline * 2
    ordered = (entries[key] for key in sorted(entries, key=lambda key: (len(key), key)))
    region = separator.join([START, INTRO, *ordered, END])
    if markers:
        return text[:start] + region + (newline if text[end - 1:end] in ("\n", "\r") else "") + text[end:]

    prefix = text[:start]
    if prefix and not prefix.endswith(separator):
        prefix += newline if prefix.endswith(newline) else separator
    if section is None:
        prefix += "## Acceptance criteria" + separator
    suffix = separator + text[end:] if text[end:] else newline
    return prefix + region + suffix


def write_criteria(path, changes):
    text = read_artifact(path, newline="")
    if text is None:
        raise ValueError(f"Specification is missing: {path}")
    updated = update_criteria(text, changes)
    if updated != text:
        replace_artifact(path, updated.encode("utf-8"), mode=stat.S_IMODE(path.stat().st_mode))
