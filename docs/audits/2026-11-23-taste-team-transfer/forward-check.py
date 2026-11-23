"""Freeze a separate personal comparison on previously sealed, unseen titles where the team changes fit."""
import hashlib
import json
import os
import secrets
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '2026-11-23-personal-dislike-signals'))
import lineage


def seal(ledger, capture, metadata, graded):
    media = {r['id']: r for r in metadata}
    baseline = {r['key']: r for r in ledger['entries']}
    salt = secrets.token_hex(32)
    seen, forecasts, counts = set(), [], defaultdict(Counter)
    for data in capture:
        kind = data['medium']
        graded_panel = next(p for p in graded['runs'] if p['medium'] == kind and
                            p['split'] == 'franchise' and p['budget'] == 'all')
        predictions = {t['id']: t['scores']['calibrated'] for t in graded_panel['targets']}
        relations = {}

        def family(i):
            while i in relations:
                i = relations[i]
            return i

        for item in data['history'] + data['catalogue']:
            i = item['id'] if 'id' in item else item['work']['id']
            keys = [('franchise', v['id']) for v in item['features'].get('franchises', [])]
            keys += [('collection', c) for c in item.get('collections', [])]
            for key in keys:
                a, b = family(i), family(key)
                if a != b:
                    relations[a] = b

        def related_features(i, features):
            return frozenset(lineage.authors(media.get(i, {}), kind)[0]), {g['id'] for g in features.get('genres', [])}

        history = defaultdict(list)
        for row in data['history']:
            i, s = row['work']['id'], row['work']['rating']
            if s is not None:
                crew, genres = related_features(i, row['features'])
                if crew:
                    history[crew].append((i, s, genres))
        for row in data['catalogue']:
            i = row['id']
            receipt = hashlib.sha256('/'.join((ledger['salt'], kind, i)).encode()).hexdigest()
            if receipt not in baseline:
                continue
            assert receipt not in seen
            seen.add(receipt)
            counts[kind]['eligibleSealedTitles'] += 1
            before = baseline[receipt]['v2']
            if before is None:
                continue
            crew, genres = related_features(i, row['features'])
            known = [(j, s, g) for j, s, g in history[crew] if family(i) != family(j)]
            if not known or any(s > 2.5 for _, s, _ in known):
                continue
            effects = defaultdict(list)
            for j, s, donor_genres in known:
                if lineage.overlap(genres, donor_genres) >= .5 and predictions.get(j) is not None:
                    effects[family(j)].append(lineage.utility(s) - predictions[j])
            if effects:
                delta = min(0., mean(mean(values) for values in effects.values()))
                new = lineage.display(before + delta)
                if new < before:
                    counts[kind]['changed'] += 1
                    counts[kind]['newlyRed'] += new < 50 <= before
                    forecasts.append(dict(key=hashlib.sha256('/'.join((salt, kind, i)).encode()).hexdigest(),
                                          medium=kind, v1=before, v2=new))
    assert seen == baseline.keys()
    return salt, forecasts, counts


if __name__ == '__main__':
    if len(sys.argv) != 6:
        raise SystemExit('Usage: forward-check.py SEALED_BASELINE SOLO_CAPTURE METADATA GRADED NEW_PRIVATE_LEDGER')
    files = [Path(p) for p in sys.argv[1:5]]
    ledger, capture, meta, graded = [lineage.read(f) for f in files]
    digest = lambda f: hashlib.sha256(f.read_bytes()).hexdigest()
    assert ledger['manifest']['capture'] == graded['manifest']['capture'] == digest(files[1])
    assert ledger['manifest']['metadata'] == graded['manifest']['metadata'] == digest(files[2])
    salt, entries, counts = seal(ledger, capture, meta, graded)
    manifest = {'baselineLedgerSHA256':digest(files[0]), 'nativeScoresSHA256':digest(files[3]),
                'ruleSHA256':digest(Path(__file__)), 'v1':'frozen calibrated personal',
                'v2':'exact lead team, same kind, negative transfer', 'coverage':counts}
    result = dict(version=2, sealed=datetime.now(timezone.utc).isoformat(), manifest=manifest,
                  salt=salt, entries=entries)
    with os.fdopen(os.open(sys.argv[5], os.O_EXCL | os.O_CREAT | os.O_WRONLY, 0o600), 'w') as f:
        json.dump(result, f, separators=(',', ':'))
    print(json.dumps(counts))
