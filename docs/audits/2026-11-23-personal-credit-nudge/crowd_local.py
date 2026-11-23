"""Offline capped public reception adjustment with independently tested personal agreement."""
import argparse
import hashlib
import json
import math
import os
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import NamedTuple

import nudge

ARMS = ('small', 'agreement', 'checked')


class Donor(NamedTuple):
    weight: float
    crowd: float
    stars: float
    error: float


def sign(value):
    return (value > 0) - (value < 0)


def propose(reception, votes, donors, *, cap=4):
    if len(donors) < 2:
        return (0., 0., 0.)
    mass = sum(d.weight for d in donors)
    center = sum(d.weight * d.crowd for d in donors) / mass
    effective = mass * mass / sum(d.weight ** 2 for d in donors)
    small = (cap * max(-1., min(1., (reception - center) / 2))
             * votes / (votes + 50) * effective / (effective + 3))

    crowd_pairs = star_pairs = concordant = 0.
    for a, b in combinations(donors, 2):
        w = a.weight * b.weight
        x, y = sign(a.crowd - b.crowd), sign(a.stars - b.stars)
        crowd_pairs += w * abs(x)
        star_pairs += w * abs(y)
        concordant += w * x * y
    denominator = math.sqrt(crowd_pairs * star_pairs)
    agreement = small * max(0., min(1., concordant / denominator)) if denominator else 0.
    same_side = [d for d in donors if sign(d.crowd - center) == sign(agreement)]
    supported = 0.
    if agreement and same_side:
        mean_error = sum(d.weight * d.error for d in same_side) / sum(d.weight for d in same_side)
        if agreement * mean_error > 0:
            supported = sign(agreement) * min(abs(agreement), abs(mean_error))
    return small, agreement, supported


def work_neighbours(i, canonical, metadata, candidates):
    neighbours = []
    if i in metadata:
        a, b = metadata[i][2:]
        family = canonical[i]['cluster']
        for j in candidates:
            other_family = canonical[j]['cluster']
            if j not in metadata or family == other_family:
                continue
            c, d = metadata[j][2:]
            similarity = (nudge.lineage.overlap(a, c) + nudge.lineage.overlap(b, d)) / 2
            if similarity:
                neighbours.append((similarity, j, other_family))
    return sorted(neighbours, key=lambda e: (-e[0], e[1]))


def make_neighbours(canonical, metadata):
    return {i: work_neighbours(i, canonical, metadata, canonical) for i in canonical}


def select_donors(neighbours, metadata, allowed, ratings):
    donors, families = [], set()
    for similarity, j, family in neighbours:
        if j not in allowed or family in families:
            continue
        crowd, votes = metadata[j][:2]
        donors.append(Donor(similarity * votes / (votes + 50), crowd, ratings[j], allowed[j]))
        families.add(family)
        if len(donors) == 12:
            break
    return donors


def run(capture, meta, dates, graded, inner, lead_rows):
    audience = {m['id']: m.get('audience') for m in meta}
    labels = {r['id']: r for r in dates}
    nested = {(r['medium'], r['split'], r['budget'], r['group']): r['points'] for r in inner}
    leads = {tuple(r[k] for k in ('medium', 'split', 'budget', 'group', 'id')): r for r in lead_rows}
    outcomes = []
    for dataset in capture:
        medium = dataset['medium']
        runs = [p for p in graded['runs'] if p['medium'] == medium]
        whole = next(p for p in runs if p['split'] == 'work' and p['budget'] == 'all')
        canonical = {t['id']: t for t in whole['targets']}
        features = {r['work']['id']: r['features'] for r in dataset['history']}
        features.update({r['id']: r['features'] for r in dataset['catalogue']})
        metadata = {}
        for i in canonical:
            a = audience.get(i)
            if a and a.get('scale') == 10 and a.get('votes', 0) > 0 and 0 < a.get('score', 0) <= 10:
                f = features[i]
                metadata[i] = (a['score'], a['votes'], *({x['id'] for x in f.get(k, [])} for k in ('genres', 'tags')))
        graph = make_neighbours(canonical, metadata)
        for panel in runs:
            key = medium, panel['split'], panel['budget']
            groups = defaultdict(list)
            for t in panel['targets']:
                groups[t['group']].append(t)
            for group, held in groups.items():
                mask = nudge.native_masks.allowed_ratings(canonical, labels, held, group, *key[1:])
                points = nested[(*key, group)]
                assert all(p['id'] in mask and p['id'] in labels and labels[p['id']]['stars'] == mask[p['id']] for p in points)
                assert mask.keys().isdisjoint(r['id'] for r in held)
                if key[1] == 'rolling-day':
                    assert all(labels[p['id']]['at'][:10] < group for p in points)
                allowed = {p['id']: nudge.lineage.utility(mask[p['id']]) - p['base'] for p in points}
                for t in held:
                    i, base = t['id'], t['scores']['calibrated']
                    if base is None:
                        continue
                    lead = leads[(*key, group, i)]
                    assert lead['base'] == base and lead['stars'] == t['stars']
                    donors = select_donors(graph[i], metadata, allowed, mask)
                    reception, votes = metadata[i][:2] if i in metadata else (None, 0)
                    shifts = propose(reception, votes, donors) if reception is not None else (0., 0., 0.)
                    assert abs(shifts[2]) <= abs(shifts[1]) <= abs(shifts[0]) + 1e-10 and abs(shifts[0]) < 4
                    row = dict(medium=medium, split=key[1], budget=key[2], group=group, id=i,
                               stars=t['stars'], base=base, lead=lead['guardedLead'], audience=reception,
                               votes=votes, neighbours=len(donors))
                    for name, delta in zip(ARMS, shifts):
                        row[name] = nudge.lineage.display(base + delta)
                        row[name + 'Delta'] = delta
                    row['leadChecked'] = nudge.lineage.display(row['lead'] + shifts[-1])
                    outcomes.append(row)
    return outcomes


def verify_rule():
    consistent = [Donor(1, 5, 2, -2), Donor(1, 9, 5, 2)]
    for x, direction in [(4, -1), (10, 1)]:
        small, learned, checked = propose(x, 500, consistent)
        assert sign(small) == direction and 0 < abs(checked) <= abs(learned) <= abs(small)
        assert abs(learned) == abs(small)
    opposite = [d._replace(stars=6 - d.stars) for d in consistent]
    tied = [d._replace(stars=4) for d in consistent]
    assert all(propose(4, 500, data)[1:] == (0, 0) for data in (opposite, tied))
    assert propose(4, 500, [d._replace(error=2) for d in consistent])[2] == 0
    assert propose(4, 500, consistent[:1]) == (0, 0, 0)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for k in ('capture', 'metadata', 'dates', 'graded', 'inner', 'lead', 'output'):
        cli.add_argument(k)
    args = cli.parse_args()
    verify_rule()
    receipt = nudge.lineage.read(args.graded)
    for k in ('capture', 'metadata', 'dates'):
        assert hashlib.sha256(Path(getattr(args, k)).read_bytes()).hexdigest() == receipt['manifest'][k]
    rows = run(*(nudge.lineage.read(getattr(args, k)) for k in ('capture', 'metadata', 'dates')),
               receipt, nudge.lineage.read(args.inner), nudge.lineage.read(args.lead))
    assert len(rows) == 13477 and len({(r['medium'], r['split'], r['budget']) for r in rows}) == 32
    with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(rows, f, separators=(',', ':'), allow_nan=False)
