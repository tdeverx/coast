"""Replay the archived creative-team corrections and public reception on exact title holdouts."""
import argparse
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
from statistics import mean
import sys

audits = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(audits / '2026-11-23-taste-team-transfer'))
sys.path.insert(0, str(audits / '2026-11-23-hidden-title-audience'))
import partial
from blend import blend, compare, display, utility


def read(path):
    return json.loads(Path(path).read_bytes())


def write_new(path, data):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(data, f, allow_nan=False, separators=(',', ':'))


def team_donors(facts, ratings):
    leads, writers, teams = defaultdict(list), defaultdict(list), defaultdict(list)
    for donor in ratings:
        lead, writing, _, _ = facts[donor]
        if lead:
            teams[lead].append(donor)
        for person in lead:
            leads[person].append(donor)
        for person in writing:
            writers[person].append(donor)
    for target in ratings:
        # The archived adjuster discards the target family before examining any votes.
        # Physically omit the target and its relatives from the permitted ratings too.
        known = {j: s for j, s in ratings.items() if facts[j][2] != facts[target][2]}
        _, donors = partial.adjust(target, known, known, facts, leads, writers, teams)
        assert all(ids <= known.keys() for ids in donors.values())
        yield target, donors


def fits(directory, medium, requests, expected_hash):
    if not requests:
        return {}
    path = directory / f'{medium}-donors.jsonl'
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert rows[0]['gradedHash'] == expected_hash and rows[0]['mode'] == 'jointExclusion'
    assert rows[-1]['type'] == 'complete' and rows[-1]['medium'] == medium
    targets = {r['target']: r['score'] for r in rows if r['type'] == 'named' and not r['extraExcluded']}
    scores = {(r['target'], r['id']): r['score'] for r in rows if r['type'] == 'donor' and not r['extraExcluded']}
    assert len(scores) == rows[-1]['completed'] and set(scores) == {
        (r['target'], j) for r in requests for j in r['donors']}
    return {i: (targets[i], {j: scores[i, j] for j in requested})
            for i, requested in ((r['target'], r['donors']) for r in requests)}


def corrected(base, donors, ratings, independent, facts):
    families = defaultdict(list)
    for j in sorted(donors):
        assert ratings[j] <= 2.5 and independent[j] is not None
        families[facts[j][2]].append(utility(ratings[j]) - independent[j])
    shift = min(0, mean(mean(values) for values in families.values())) if families else 0
    return display(base + shift)


def public_variants(row):
    base = row['native']
    for arm in ('native', 'exact', 'wider'):
        start = row[arm]
        yield arm, start
        for cap in ('4', '8'):
            yield f'{arm}+cap{cap}', display(start + row['weights'][cap])
        for w in (5, 10, 20, 40, 100):
            yield f'{arm}+blend{w}', blend(row, w, arm)
        # Public reception may veto a team penalty. It otherwise leaves personal scores alone.
        if row['votes'] and row['audience'] is not None:
            reliability = row['votes'] / (row['votes'] + 50)
            public = 50 + reliability * (utility(row['audience'] / 2) - 50)
            if public > base:
                start = base
        yield f'{arm}+veto', start


def main(args):
    graded = read(args.graded)
    for field in ('metadata', 'capture'):
        assert hashlib.sha256(getattr(args, field).read_bytes()).hexdigest() == graded['manifest'][field]
    graded_hash = hashlib.sha256(args.graded.read_bytes()).hexdigest()
    verified = read(args.verified)['ratings']
    paired = {r['id']: r for r in read(args.paired) if r['direct']}
    assert len(paired) == len(verified) == 870 and all(
        paired[v['id']]['stars'] == v['stars'] and paired[v['id']]['medium'] == v['medium'] and v['at']
        for v in verified)
    metadata = {m['id']: m for m in read(args.metadata)}
    scored = []
    for dataset in read(args.capture):
        medium = dataset['medium']
        if medium not in ('movie', 'show'):
            continue
        panel = next(p for p in graded['runs'] if (p['medium'], p['split'], p['budget']) == (medium, 'work', 'all'))
        canonical = {t['id']: t for t in panel['targets']}
        genres = {r['work']['id']: {g['id'] for g in r['features'].get('genres', [])} for r in dataset['history']}
        facts = partial.index_works(metadata, genres, canonical, medium)
        ratings = {v['id']: v['stars'] for v in verified if v['medium'] == medium}
        opportunities = dict(team_donors(facts, ratings))
        requests = []
        for i, arms in opportunities.items():
            unique = sorted(set().union(*arms.values()))
            if unique:
                requests.append(dict(target=i, donors=unique))
        requests.sort(key=lambda r: r['target'])
        if args.prepare:
            write_new(args.directory / f'{medium}-requests.json', requests)
            print(medium, len(requests), 'targets,', sum(len(r['donors']) for r in requests), 'donors')
            continue
        assert requests == read(args.directory / f'{medium}-requests.json')
        fitted = fits(args.directory, medium, requests, graded_hash)
        for i in ratings:
            row = dict(paired[i])
            base = row['native']
            named, independent = fitted.get(i, (base, {}))
            assert named == base
            adjustments = {arm: corrected(base, ds, ratings, independent, facts) for arm, ds in opportunities[i].items()}
            row['exact'] = adjustments.pop('exact')
            changes = [v for v in adjustments.values() if v < base]
            row['wider'] = row['exact'] if row['exact'] != base else max(changes, default=base)
            scored.append(row)
    if args.prepare:
        return
    assert len(scored) == 870
    variants = defaultdict(list)
    for row in scored:
        for arm, value in public_variants(row):
            variants[arm].append((row, value, row['native']))
    out = {}
    for arm, forecasts in variants.items():
        result = compare(forecasts)
        result['fourPlusRed'] = sum(r['stars'] >= 4 and s < 50 for r,s,_ in forecasts)
        result['middleRed'] = sum(2.5 < r['stars'] < 4 and s < 50 for r,s,_ in forecasts)
        result['named'] = {r['title']: s for r,s,_ in forecasts if r['title'] in ('Farzar', 'Rick and Morty')}
        out[arm] = result
    write_new(args.directory / 'team-private.json', scored)
    write_new(args.directory / 'team-results.json', out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('capture', 'metadata', 'graded', 'verified', 'paired', 'directory'):
        parser.add_argument(name, type=Path)
    parser.add_argument('--prepare', action='store_true', help='Write target/donor requests for the native runner.')
    main(parser.parse_args())
