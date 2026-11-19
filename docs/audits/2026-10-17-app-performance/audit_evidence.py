"""Resolve historical audit bytes without installing or extracting evidence."""

from collections import defaultdict
from hashlib import sha256
from pathlib import Path
import json
import subprocess
import tarfile


def digest(path):
    with path.open('rb') as content:
        return stream_digest(content)


def stream_digest(content):
    hashed = sha256()
    for block in iter(lambda: content.read(1024 * 1024), b''):
        hashed.update(block)
    return hashed.hexdigest()


class EvidenceArchive:
    def __init__(self, path, required):
        self.hashes = {}
        self.payloads = {}
        self.json_errors = []
        with tarfile.open(path, 'r|gz') as archive:
            for entry in archive:
                name = Path(entry.name)
                if not entry.isfile() or name.is_absolute() or '..' in name.parts or name.as_posix() in self.hashes:
                    raise ValueError(f'Invalid evidence archive member {entry.name!r}')
                content = archive.extractfile(entry)
                name = name.as_posix()
                if name in required or name.endswith('.json'):
                    data = content.read()
                    self.hashes[name] = sha256(data).hexdigest()
                    if name in required:
                        self.payloads[name] = data
                    if name.endswith('.json'):
                        try:
                            json.loads(data)
                        except (ValueError, UnicodeError):
                            self.json_errors.append(name)
                else:
                    self.hashes[name] = stream_digest(content)
        self.directories = {
            parent.as_posix() for name in self.hashes for parent in Path(name).parents
        }


def git_outputs(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args])


def history_matches(repo, pins):
    """Return exact path/SHA-256 matches among versions reachable from HEAD."""
    expected = defaultdict(set)
    for path, value in pins:
        expected[path].add(value)
    if not expected:
        return set()

    raw = git_outputs(repo, '--literal-pathspecs', 'log', '--full-history', '--format=',
                      '--raw', '--no-abbrev', '--no-renames', '-z', 'HEAD', '--', *expected)
    records = iter(raw.split(b'\0'))
    paths_by_blob = defaultdict(set)
    for record in records:
        if not record.lstrip().startswith(b':'):
            continue
        _, _, before, after, _ = record.split()
        path = next(records).decode()
        if path in expected:
            for oid in (before, after):
                if oid.strip(b'0'):
                    paths_by_blob[oid].add(path)

    matches = set()
    with subprocess.Popen(['git', '-C', str(repo), 'cat-file', '--batch'],
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE) as blobs:
        for oid, paths in paths_by_blob.items():
            blobs.stdin.write(oid + b'\n')
            blobs.stdin.flush()
            _, kind, size = blobs.stdout.readline().split()
            if kind != b'blob':
                raise ValueError(f'Expected a Git blob for {oid.decode()}')
            hashed = sha256(blobs.stdout.read(int(size))).hexdigest()
            if blobs.stdout.read(1) != b'\n':
                raise ValueError(f'Incomplete Git blob for {oid.decode()}')
            matches.update((path, hashed) for path in paths if hashed in expected[path])
        blobs.stdin.close()
    return matches
