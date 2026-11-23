"""Recheck lead-team transfer only across works with similar genres."""
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

import lineage


def run(capture, metadata, dates, graded, inner):
    spec = importlib.util.spec_from_file_location('exact', Path(__file__).with_name('lineage-exact.py'))
    exact = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exact)
    genres = {r['work']['id']: {g['id'] for g in r['features'].get('genres', [])}
              for d in capture for r in d['history']}

    def compatible(target, donor):
        left, right = genres[target], genres[donor]
        union = left | right
        return bool(union) and 2 * len(left & right) >= len(union)

    return exact.run(metadata, dates, graded, inner, donor_compatible=compatible)


if __name__ == '__main__':
    if len(sys.argv) != 6:
        raise SystemExit('Usage: same-kind.py PRIVATE_CAPTURE METADATA VERIFIED_DATES GRADED INNER_SCORES')
    capture, metadata, dates, graded, inner = (lineage.read(path) for path in sys.argv[1:])
    for field, path in zip(('capture', 'metadata', 'dates'), sys.argv[1:4]):
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == graded['manifest'][field]
    result, details = run(capture, metadata, dates, graded, inner)
    if path := os.environ.get('COAST_SAME_KIND_PRIVATE'):
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
            json.dump([r for r in details if r['one'] != r['base'] or r['two'] != r['base']], f)
    print(json.dumps(result, separators=(',', ':')))
