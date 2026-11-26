"""Read and save review artifacts."""

import fcntl
import hashlib
import json
import os
import stat
import tempfile
from contextlib import contextmanager

RECORDS_NAME = "review-records.json"
CONVERSATION_LOG_NAME = "conversation.jsonl"


def records_revision(review):
    content = json.dumps(review, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(content).hexdigest()


def open_conversation(path):
    descriptor = os.open(path, os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    return os.fdopen(descriptor, "a+", encoding="utf-8", newline="\n")


def read_conversation(stream):
    fcntl.flock(stream, fcntl.LOCK_SH)
    try:
        stream.seek(0)
        for line in stream:
            if not line.endswith(b"\n"):
                break
            yield json.loads(line)
    finally:
        fcntl.flock(stream, fcntl.LOCK_UN)


def read_artifact(path, *, newline=None):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise ValueError(f"{path.name} must be a regular, unlinked file")
    with path.open(encoding="utf-8", newline=newline) as stream:
        return stream.read()


def read_review(path):
    records = read_artifact(path)
    if records is not None:
        review = json.loads(records)
        if not isinstance(review, dict) or not isinstance(review.get("records"), dict):
            raise ValueError("Invalid review-records.json")
        return review
    return None


def write_review(path, review):
    data = (json.dumps(review, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    replace_artifact(path, data)


def replace_artifact(path, data, *, mode=None):
    tmp = tempfile.NamedTemporaryFile(dir=path.parent, delete=False)
    try:
        with tmp:
            if mode is not None:
                os.fchmod(tmp.fileno(), mode)
            tmp.write(data)
        os.replace(tmp.name, path)
    except BaseException:
        os.unlink(tmp.name)
        raise


@contextmanager
def lock_review(directory):
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError(f"A server already owns the review directory: {directory}") from error
        yield
    finally:
        os.close(descriptor)
