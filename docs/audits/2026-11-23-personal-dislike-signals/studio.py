"""A private user's ratings on one studio's output, matched against their other similar titles."""
import importlib.util
import json
import math
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean


def module(name, relative):
    path = Path(__file__).resolve().parents[1] / relative
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


base = module('base_dislike_replay', '2026-11-23-taste-v2-counterevidence/replay.py')
controls = module('replay_controls', '2026-11-23-taste-audience/control.py')


def jaccard(a, b):
    return len(a & b) / len(a | b) if a or b else 0


def descriptive_index(history):
    features = {r['work']['id']: {k: {t['id'] for t in r['features'].get(k, [])}
                                  for k in ('genres', 'tags', 'studios')}
                for r in history if r['work']['rating'] is not None}
    similar = {}
    for target, item in features.items():
        ranked = []
        for other, peer in features.items():
            if other == target:
                continue
            overlap = jaccard(item['genres'], peer['genres'])
            if overlap < .5:
                continue
            ranked.append((-overlap, -jaccard(item['tags'], peer['tags']), other))
        similar[target] = [p[-1] for p in sorted(ranked)]
    return features, similar


def forecasts(target, train, labels, family, features, similar):
    studios = features[target]['studios']
    exemplars = defaultdict(dict)
    for i in similar[target]:
        if i in train and family[i] != family[target]:
            for studio in studios & features[i]['studios']:
                exemplars[studio].setdefault(family[i], i)
    candidates = {'studio': [], 'matched': []}
    blocked = False
    for studio, members in exemplars.items():
        ids = members.values()
        liked = sum(labels[i] >= 4 for i in ids)
        if liked >= 2 and 2 * liked > len(ids):
            blocked = True
        low = sum(labels[i] <= 2.5 for i in ids)
        if liked or base.cap(low, len(ids)) is None:
            continue
        estimate = math.floor((50 + sum(controls.fit_score(labels[i]) for i in ids)) / (1+len(ids)) + .5)
        if estimate >= 50:
            continue
        distinct = set()
        contrasts = 0
        for i in ids:
            comparators = {}
            for j in similar[i]:
                if j not in train or family[j] in (family[i], family[target]):
                    continue
                other_studios = features[j]['studios']
                if other_studios and studio not in other_studios:
                    comparators.setdefault(family[j], j)
                    if len(comparators) == 3:
                        break
            if comparators:
                distinct.update(comparators)
                contrasts += labels[i] + 1 <= mean(labels[j] for j in comparators.values())
        candidates['studio'].append((estimate, studio))
        if len(distinct) >= 3 and base.cap(contrasts, len(ids)) is not None:
            candidates['matched'].append((estimate, studio))
    return ({arm: max(rows) for arm, rows in candidates.items() if rows and not blocked},
            any(len(m) >= 2 for m in exemplars.values()))


def replay(capture, dated, archive, private):
    results = []
    for dataset in capture:
        medium, history = dataset['medium'], dataset['history']
        family = base.family_keys(history)
        features, similar = descriptive_index(history)
        labels = {r['id']: r['stars'] for r in dated if r['medium'] == medium}
        dates = {r['id']: (r['at'][:10], r['stars']) for r in dated if r['medium'] == medium}
        structural = {r['work']['id']: r['work']['rating'] for r in history if r['work']['rating'] is not None}
        for run in archive['runs']:
            if run['medium'] != medium:
                continue
            split, budget = run['split'], run['budget']
            grouped = defaultdict(list)
            for target in run['targets']:
                grouped[target['group']].append(target)
            totals = {arm: Counter() for arm in ('studio', 'matched')}
            for group, held in grouped.items():
                train = controls.training(structural, dates, held, group, budget, split).keys() & labels.keys()
                assert not train.intersection(t['id'] for t in held)
                for t in held:
                    initial, i = t['scores']['calibrated'], t['id']
                    if initial is None:
                        continue
                    proposals, replicated = forecasts(i, train, labels, family, features, similar)
                    for arm, counts in totals.items():
                        after = min(initial, proposals[arm][0]) if arm in proposals else initial
                        s = t['stars']
                        counts.update(dict(scored=1, dislikes=s <= 2.5, five=s == 5,
                                           fiveGreenBefore=s == 5 and initial >= 80,
                                           repeatStudioForDislike=s <= 2.5 and replicated,
                                           dislikesRed=s <= 2.5 and after < 50,
                                           likedNewlyRed=s >= 4 and after < 50 <= initial,
                                           middleNewlyRed=2.5 < s < 4 and after < 50 <= initial,
                                           fiveLostGreen=s == 5 and after < 80 <= initial,
                                           fiveLowered=s == 5 and after < initial, changed=after != initial))
                        if after != initial:
                            private.append(dict(medium=medium, split=split, budget=budget, group=group, id=i,
                                                arm=arm, stars=s, before=initial, after=after, studio=proposals[arm][1]))
            results.append(dict(medium=medium, split=split, budget=budget, arms=totals))
    return results


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Usage: studio.py PRIVATE_CAPTURE VERIFIED_DATES GRADED_REPLAY')
    changes = []
    results = replay(*(base.read(p) for p in sys.argv[1:]), changes)
    if path := os.environ.get('COAST_STUDIO_PRIVATE'):
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
            json.dump(changes, f)
    print(json.dumps(results, separators=(',', ':')))
