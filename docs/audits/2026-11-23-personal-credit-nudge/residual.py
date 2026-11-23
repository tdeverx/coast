"""Check if independent errors on the donor families support changing the native prediction."""
import argparse
import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path

import nudge


def supported_delta(delta, people, errors):
    if not delta:
        return 0.
    by_family = defaultdict(dict)
    for person in people:
        for donor in person['donors']:
            work = donor['id']
            if work in errors:
                family = by_family[donor['family']]
                family[work] = max(family.get(work, 0.), donor['weight'])
    total = mass = 0.
    for weights in by_family.values():
        strongest = max(weights.values())
        family_error = sum(w * errors[i] for i, w in weights.items()) / sum(weights.values())
        total += strongest * family_error
        mass += strongest
    average = total / mass if mass else 0.
    if average * delta <= 0:
        return 0.
    return min(delta, average) if delta > 0 else max(delta, average)


def run(capture, metadata, verified, native, nested):
    media = {r['id']: r for r in metadata}
    dates = {r['id']: r for r in verified}
    genres = {r['work']['id']: {g['id'] for g in r['features'].get('genres', [])}
              for m in capture for r in m['history']}
    receipts = {(r['medium'], r['split'], r['budget'], r['group']): r['points'] for r in nested}
    panels, ledger = [], []
    for medium in ('movie', 'show'):
        runs = [p for p in native['runs'] if p['medium'] == medium]
        whole = next(p for p in runs if p['split'] == 'work' and p['budget'] == 'all')
        canonical = {t['id']: t for t in whole['targets']}
        graph = nudge.graph(canonical, media, genres, medium)
        for panel in runs:
            split, budget = panel['split'], panel['budget']
            groups = defaultdict(list)
            for target in panel['targets']:
                groups[target['group']].append(target)
            records = []
            for group, targets in groups.items():
                known = nudge.native_masks.allowed_ratings(canonical, dates, targets, group, split, budget)
                known = {i: s for i, s in known.items() if i in dates and s == dates[i]['stars']}
                points = receipts[medium, split, budget, group]
                assert all(p['id'] in known for p in points)
                assert known.keys().isdisjoint(t['id'] for t in targets)
                if split == 'rolling-day':
                    assert all(dates[i]['at'][:10] < group for i in known)
                errors = {p['id']: nudge.lineage.utility(known[p['id']]) - p['base'] for p in points}
                for t in targets:
                    work, base = t['id'], t['scores']['calibrated']
                    if base is None:
                        continue
                    delta, evidence = nudge.proposal(work, known, graph, trace=True)
                    corrected = supported_delta(delta, evidence['people'], errors)
                    assert abs(corrected) <= abs(delta)
                    assert all(d['family'] != canonical[work]['cluster']
                               for person in evidence['people'] for d in person['donors'])
                    lead_delta, lead_evidence = nudge.proposal(work, known, graph, 'lead', trace=True)
                    lead_checked = supported_delta(lead_delta, lead_evidence['people'], errors)
                    records.append(dict(id=work, group=group, stars=t['stars'], base=base,
                                        combined=nudge.lineage.display(base + delta),
                                        guarded=nudge.lineage.display(base + corrected),
                                        guardedLead=nudge.lineage.display(base + lead_checked),
                                        delta=delta, guardedDelta=corrected, medium=medium, split=split, budget=budget))
            panels.append(dict(medium=medium, split=split, budget=budget,
                               arms={a: nudge.summarize(records, a, 'base')
                                     for a in ('base', 'combined', 'guarded', 'guardedLead')}))
            ledger.extend(records)
    return panels, ledger


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('capture', 'metadata', 'dates', 'graded', 'nested', 'private_ledger'):
        cli.add_argument(name)
    args = cli.parse_args()
    native = nudge.lineage.read(args.graded)
    for key in ('capture', 'metadata', 'dates'):
        assert hashlib.sha256(Path(getattr(args, key)).read_bytes()).hexdigest() == native['manifest'][key]
    data = [nudge.lineage.read(getattr(args, k)) for k in ('capture', 'metadata', 'dates')]
    report, private = run(*data, native, nudge.lineage.read(args.nested))
    assert len(report) == 32 and len(private) == 13477
    with os.fdopen(os.open(args.private_ledger, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(private, f, separators=(',', ':'), allow_nan=False)
    print(json.dumps(report, separators=(',', ':'), allow_nan=False))
