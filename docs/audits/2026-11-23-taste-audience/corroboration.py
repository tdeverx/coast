"""Check public corroboration of the frozen personal classifiers' individual proposals."""
import hashlib
import importlib.util
import json
import math
import os
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path


source = Path(__file__).resolve().parents[1] / '2026-11-23-taste-v2-counterevidence' / 'replay.py'
spec = importlib.util.spec_from_file_location('dislike_replay', source)
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)


def reception(catalogue, metadata):
    def usable(work_id):
        record = metadata.get(work_id) or {}
        return (record.get('scale') == 10 and 0 < record.get('score', 0) <= 10
                and record.get('votes', 0) >= 20)

    reference = {r['id'] for r in catalogue if usable(r['id'])}
    center = statistics.median(metadata[i]['score'] for i in reference)
    adjusted = {i: center + (a['score'] - center) * a['votes'] / (a['votes'] + 50)
                for i, a in metadata.items() if usable(i)}
    cutoff = statistics.quantiles([adjusted[i] for i in reference], n=4, method='inclusive')[0]
    return {i for i in adjusted if adjusted[i] <= cutoff}, set(adjusted)


def jaccard(left, right):
    combined = len(left | right)
    return len(left & right) / combined if combined else 0


def contextual_agreement(target, training, personal, family, features, poor):
    by_similarity = []
    for i in training:
        if family[i] == family[target]:
            continue
        score = sum(jaccard(a, b) for a, b in zip(features[i], features[target])) / 2
        if score > 0:
            by_similarity.append((-score, i))
    representatives = {}
    for _, i in sorted(by_similarity):
        representatives.setdefault(family[i], i)
        if len(representatives) == 48:
            break
    groups = [[personal[i]['stars'] for i in representatives.values() if (i in poor) == flag]
              for flag in (True, False)]
    if min(map(len, groups)) < 8 or sum(s <= 2.5 for s in groups[0]) < 2:
        return False
    estimates, variances = [], []
    for group in groups:
        weak = sum(s <= 3 for s in group)
        mean = (1 + weak) / (2 + len(group))
        estimates.append(mean)
        variances.append(mean * (1 - mean) / (3 + len(group)))
    return estimates[0] - estimates[1] > 1.28 * math.sqrt(sum(variances))


def run(capture, metadata_rows, dates, graded, changes, private_records=None):
    metadata = {r['id']: r['audience'] for r in metadata_rows}
    proposals = {(r['arm'], r['medium'], r['split'], r['budget'], r['group'], r['id']): r
                 for r in changes}
    assert len(proposals) == len(changes)
    matched, results = set(), []
    for data in capture:
        medium = data['medium']
        family = replay.family_keys(data['history'])
        rows = {r['work']['id']: r for r in data['history'] if r['work']['rating'] is not None}
        personal = {r['id']: r for r in dates if r['medium'] == medium}
        poor, available = reception(data['catalogue'], metadata)
        features = {i: [{v['id'] for v in r['features'].get(k, [])} for k in ('genres', 'tags')]
                    for i, r in rows.items()}
        for panel in graded['runs']:
            if panel['medium'] != medium:
                continue
            split, budget = panel['split'], panel['budget']
            by_group = defaultdict(list)
            for t in panel['targets']:
                by_group[t['group']].append(t)
            for arm in ('neighbours', 'linear'):
                counts = {mode: Counter() for mode in ('personal', 'poorAudience', 'localAgreement')}
                for group, targets in by_group.items():
                    if split == 'rolling-day':
                        train = {i for i in rows if i in personal and personal[i]['at'][:10] < group}
                    else:
                        train = rows.keys() - {t['id'] for t in targets}
                        if budget != 'all':
                            size, _, seed = budget.partition('#')
                            train = sorted(train, key=lambda i: hashlib.sha256(
                                f'solo:{seed or "1"}:{i}'.encode()).hexdigest())[:int(size)]
                    train = set(train) & personal.keys() & available
                    for target in targets:
                        i = target['id']
                        key = (arm, medium, split, budget, group, i)
                        if key not in proposals:
                            continue
                        change = proposals[key]
                        assert change['before'] == target['scores']['calibrated']
                        assert change['after'] < 50 <= change['before']
                        assert change['stars'] == target['stars'] and i not in train
                        matched.add(key)
                        accepted = ['personal']
                        if i in poor:
                            accepted.append('poorAudience')
                            if contextual_agreement(i, train, personal, family, features, poor):
                                accepted.append('localAgreement')
                        if private_records is not None:
                            private_records.append({**change, 'accepted': accepted})
                        for mode in accepted:
                            stars = target['stars']
                            category = 'disliked' if stars <= 2.5 else 'liked' if stars >= 4 else 'middle'
                            counts[mode][category] += 1
                            counts[mode]['fiveStar'] += int(stars == 5)
                results.append(dict(medium=medium, split=split, budget=budget, arm=arm, counts=counts))
    assert matched == set(proposals)
    return results


if __name__ == '__main__':
    if len(sys.argv) != 6:
        raise SystemExit('Usage: corroboration.py CAPTURE METADATA VERIFIED_DATES GRADED CLASSIFIER_CHANGES')
    private_records = []
    results = run(*(replay.read(p) for p in sys.argv[1:]), private_records=private_records)
    if path := os.environ.get('COAST_AUDIENCE_CORROBORATION_PRIVATE'):
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as file:
            json.dump(private_records, file)
    print(json.dumps(results, indent=2))
