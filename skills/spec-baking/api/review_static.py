"""Load static resources for the review browser."""

import re
import sys
from http import HTTPStatus
from pathlib import Path

RESOURCE_ROOT = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
CLIENT_DIST = RESOURCE_ROOT / "client" / "dist"
CLIENT_PAGES = {
    "/": ("index.html", "text/html"),
    "/session": ("index.html", "text/html"),
    "/licenses.md": ("licenses.md", "text/plain"),
}
CLIENT_ASSET = re.compile(r"/(assets/[A-Za-z0-9_-]+\.(js|css))")
ASSET_TYPES = {"js": "text/javascript", "css": "text/css"}


def client_file(path):
    """Return the response for a built client resource, or None for an unknown path."""
    if path in CLIENT_PAGES:
        name, content_type = CLIENT_PAGES[path]
    elif match := CLIENT_ASSET.fullmatch(path):
        name, extension = match.groups()
        content_type = ASSET_TYPES[extension]
    else:
        return None

    try:
        data = (CLIENT_DIST / name).read_bytes()
    except FileNotFoundError:
        if name != "index.html":
            return None
        return (
            b"Build the review client from the repository root with npm ci and "
            b"npm run build:spec-baking, then reload this page.\n",
            "text/plain",
            HTTPStatus.SERVICE_UNAVAILABLE,
        )
    return data, content_type, HTTPStatus.OK
