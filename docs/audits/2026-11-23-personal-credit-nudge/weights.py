"""Replay four audience weights, retaining the archived local guard at every weight."""
import argparse
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import mean

import crowd_local
import crowd_report
import nudge


WEIGHTS = (0, 2, 4, 8)


def error_limit(neighbours, agreement):
    if not agreement:
        return 0.
    center = sum(d.weight * d.crowd for d in neighbours) / sum(d.weight for d in neighbours)
    direction = crowd_local.sign(agreement)
    same_side = [d for d in neighbours if crowd_local.sign(d.crowd - center) == direction]
    if not same_side:
        return 0.
    error = sum(d.weight * d.error for d in same_side) / sum(d.weight for d in same_side)
    return max(0., direction * error)


def metrics(rows, w, baseline):
    delta = str(w) + 'Delta'
    arm = str(w) if baseline == 'base' else 'lead' + str(w)
    outcomes = crowd_report.outcomes(rows, arm, baseline)
    errors = [r[baseline] - nudge.lineage.utility(r['stars']) for r in rows]
    outcomes['meanPairedContinuousErrorChange'] = mean(
        abs(e + r[delta]) - abs(e) for r, e in zip(rows, errors))
    outcomes['meanPairedDisplayErrorChange'] = mean(
        abs(r[arm] - nudge.lineage.utility(r['stars'])) - abs(e) for r, e in zip(rows, errors))
    outcomes['maxDisplayMove'] = max(abs(r[arm] - r[baseline]) for r in rows)
    return outcomes


def compare(rows, graded, capture, metadata, dates, nested):
    labels = {r['id']: r for r in dates}
    audience = {r['id']: r.get('audience') for r in metadata}
    inner = {(r['medium'], r['split'], r['budget'], r['group']): r['points'] for r in nested}
    ledger = {(r['medium'], r['split'], r['budget'], r['group'], r['id']): r for r in rows}
    assert len(ledger) == len(rows) == 13477
    panels = []
    for dataset in capture:
        medium = dataset['medium']
        runs = [r for r in graded['runs'] if r['medium'] == medium]
        whole = next(r for r in runs if r['split'] == 'work' and r['budget'] == 'all')
        canonical = {r['id']: r for r in whole['targets']}
        features = {r['work']['id']: r['features'] for r in dataset['history']}
        features.update({r['id']: r['features'] for r in dataset['catalogue']})
        items = {}
        for i in canonical:
            a = audience.get(i)
            if a and a.get('scale') == 10 and a.get('votes', 0) > 0 and 0 < a.get('score', 0) <= 10:
                genres, tags = ({v['id'] for v in features[i].get(k, [])} for k in ('genres', 'tags'))
                items[i] = a['score'], a['votes'], genres, tags
        graph = crowd_local.make_neighbours(canonical, items)
        for panel in runs:
            key = medium, panel['split'], panel['budget']
            groups = defaultdict(list)
            for r in panel['targets']:
                groups[r['group']].append(r)
            evaluated = []
            for group, held in groups.items():
                mask = nudge.native_masks.allowed_ratings(canonical, labels, held, group, *key[1:])
                points = inner[(*key, group)]
                assert mask.keys().isdisjoint(t['id'] for t in held)
                assert all(p['id'] in labels and labels[p['id']]['stars'] == mask[p['id']] for p in points)
                if key[1] == 'rolling-day':
                    assert all(labels[p['id']]['at'][:10] < group for p in points)
                errors = {p['id']: nudge.lineage.utility(mask[p['id']]) - p['base'] for p in points}
                for t in held:
                    if t['scores']['calibrated'] is None:
                        continue
                    i = t['id']
                    row = ledger.pop((*key, group, i))
                    assert row['stars'] == t['stars'] and row['base'] == t['scores']['calibrated']
                    neighbours, seen = [], set()
                    for similarity, j, family in graph[i]:
                        if j not in errors or family in seen:
                            continue
                        assert family != canonical[i]['cluster']
                        reception, votes = items[j][:2]
                        neighbours.append(crowd_local.Donor(similarity * votes / (votes + 50), reception, mask[j], errors[j]))
                        seen.add(family)
                        if len(seen) == 12:
                            break
                    assert len(neighbours) == row['neighbours']
                    if i in items:
                        assert items[i][:2] == (row['audience'], row['votes'])
                    shifts = crowd_local.propose(*items[i][:2], neighbours) if i in items else (0., 0., 0.)
                    assert all(math.isclose(x, row[k + 'Delta'], abs_tol=1e-12)
                               for k, x in zip(crowd_local.ARMS, shifts))
                    agreement = shifts[1]
                    bound = error_limit(neighbours, agreement)
                    for w in WEIGHTS:
                        arm = str(w)
                        delta = crowd_local.propose(*items[i][:2], neighbours, cap=w)[2] if i in items else 0.
                        expected = crowd_local.sign(agreement) * min(w / 4 * abs(agreement), bound)
                        assert math.isclose(delta, expected, abs_tol=1e-12)
                        row[arm + 'Delta'] = delta
                        row[arm] = nudge.lineage.display(row['base'] + delta)
                        row['lead' + arm] = nudge.lineage.display(row['lead'] + delta)
                        assert abs(delta) <= bound and abs(delta) <= w
                    assert math.isclose(row['4Delta'], shifts[2], abs_tol=1e-12)
                    assert row['4'] == row['checked'] and row['0'] == row['base']
                    assert row['lead4'] == row['leadChecked'] and row['lead0'] == row['lead']
                    evaluated.append(row)
            panels.append(dict(medium=medium, split=key[1], budget=key[2], n=len(evaluated),
                               weights={str(w): metrics(evaluated, w, 'base') for w in WEIGHTS},
                               guardedLeadWeights={str(w): metrics(evaluated, w, 'lead') for w in WEIGHTS}))
    assert not ledger and len(panels) == 32
    return panels


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('ledger', 'graded', 'capture', 'metadata', 'dates', 'nested'):
        cli.add_argument(name)
    args = cli.parse_args()
    values = [nudge.lineage.read(getattr(args, name)) for name in vars(args)]
    receipt = values[1]
    for name in ('capture', 'metadata', 'dates'):
        assert hashlib.sha256(Path(getattr(args, name)).read_bytes()).hexdigest() == receipt['manifest'][name]
    results = compare(*values)
    print(json.dumps(results, separators=(',', ':'), allow_nan=False))
