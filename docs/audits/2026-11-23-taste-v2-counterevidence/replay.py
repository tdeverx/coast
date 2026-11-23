"""Offline diagnostic for the pre-specified repeated-negative override. Standard library only."""
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from functools import lru_cache
from itertools import combinations


def read(path):
    with open(path, encoding='utf-8') as file:
        return json.load(file)


def family_keys(history):
    parents = {}

    def root(key):
        while key in parents:
            key = parents[key]
        return key

    for r in history:
        shared = [('collection', k) for k in r.get('collections', [])]
        shared += [('franchise', k['id']) for k in r['features'].get('franchises', [])]
        for key in shared:
            a, b = root(r['work']['id']), root(key)
            if a != b:
                parents[a] = b
    return {r['work']['id']: root(r['work']['id']) for r in history}


def exact_traits(row, credits):
    traits = {(f, v['id']) for f in ('tags', 'cast', 'directors', 'writers') for v in row['features'].get(f, [])}
    traits.update(('creators', str(c['id'])) for c in credits.get(row['work']['id']) or []
                  if c['role'] == 'Creator' and str(c['id']).isdigit())
    return traits


@lru_cache(maxsize=None)
def cap(low, n):
    if low < 2 or low * 2 <= n:
        return None
    # Exact tail probability for a Beta(low+1, n-low+1) posterior at one half.
    probability = sum(math.comb(n + 1, i) for i in range(low + 1)) / 2 ** (n + 1)
    if probability < .85:
        return None
    mean = (low + 1) / (n + 2)
    return math.floor(50 - 20 * (2 * mean - 1) + .5)


def evidence(training, labels, traits, families):
    votes = defaultdict(lambda: defaultdict(list))
    for work in training:
        if work in labels:
            for trait in traits[work]:
                votes[trait][families[work]].append(labels[work]['stars'])
    result = {}
    for trait, by_family in votes.items():
        disliked_by_family = {f: sum(stars) / len(stars) <= 2.5 for f, stars in by_family.items()}
        result[trait] = (sum(disliked_by_family.values()), len(by_family), disliked_by_family)
    return result


def override(score, work, features, families, learned):
    if score is None:
        return None
    result = score
    family = families[work]
    for trait in features[work]:
        if trait not in learned:
            continue
        low, n, families_for_trait = learned[trait]
        cutoff = cap(low - families_for_trait.get(family, False), n - int(family in families_for_trait))
        if cutoff is not None:
            result = min(result, cutoff)
    return result


def rate(success, count):
    return round(100 * success / count, 2) if count else None


def metrics(groups, index):
    paired, wins = [0, 0, 0], [0, 0, 0]
    outcomes = Counter()
    for group in groups.values():
        for stars, base, score in group:
            value = (base, score)[index]
            outcomes['scored'] += 1
            outcomes['disliked'] += stars <= 2.5
            outcomes['weak'] += stars <= 3
            outcomes['liked'] += stars >= 4
            outcomes['five'] += stars == 5
            outcomes['weakGreen'] += stars <= 3 and value >= 80
            outcomes['fiveGreen'] += stars == 5 and value >= 80
            outcomes['dislikedRed'] += stars <= 2.5 and value < 50
            outcomes['weakRed'] += stars <= 3 and value < 50
            outcomes['likedRed'] += stars >= 4 and value < 50
            outcomes['neutralRed'] += stars == 3.5 and value < 50
        for x, y in combinations(group, 2):
            a, b = sorted((x, y), key=lambda item: item[0])
            if a[0] == b[0]:
                continue
            win = 1 if a[index + 1] < b[index + 1] else .5 if a[index + 1] == b[index + 1] else 0
            for k, include in enumerate((True, a[0] <= 3 and b[0] >= 4, a[0] == 3.5 and b[0] == 5)):
                if include:
                    wins[k] += win
                    paired[k] += 1
    return dict(sorted(outcomes.items())), [rate(w, n) for w, n in zip(wins, paired)]


def evaluate(capture, dates, credits, replay):
    for data in capture:
        medium, history = data['medium'], data['history']
        rated = {r['work']['id'] for r in history if r['work']['rating'] is not None}
        labels = {r['id']: r for r in dates if r['medium'] == medium}
        families = family_keys(history)
        traits = {r['work']['id']: exact_traits(r, credits) for r in history}
        for run in replay['runs']:
            if run['medium'] != medium:
                continue
            budget, split = run['budget'], run['split']
            folds, scored = defaultdict(list), defaultdict(list)
            changes = Counter()
            for target in run['targets']:
                folds[target['group']].append(target)
            for group, held in folds.items():
                if split == 'rolling-day':
                    train = {w for w, r in labels.items() if r['at'][:10] < group}
                else:
                    train = rated.difference(r['id'] for r in held)
                    if budget != 'all':
                        limit, _, seed = budget.partition('#')
                        order = lambda w: hashlib.sha256(('solo:' + (seed or '1') + ':' + w).encode()).hexdigest()
                        train = sorted(train, key=order)[:int(limit)]
                model = evidence(train, labels, traits, families)
                for r in held:
                    base = r['scores']['calibrated']
                    if base is None:
                        continue
                    result = override(base, r['id'], traits, families, model)
                    scored[group].append((r['stars'], base, result))
                    if result != base:
                        changes[str(r['stars'])] += 1
            outcomes, before = metrics(scored, 0)
            revised, after = metrics(scored, 1)
            yield {'medium': medium, 'split': split, 'budget': budget, 'touchedByStars': dict(sorted(changes.items())),
                   'graded': outcomes, 'control': revised, 'gradedConcordance': before, 'controlConcordance': after}


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('Usage: replay.py CAPTURE VERIFIED_DATES VERIFIED_CREDITS GRADED_HOLDOUTS')
    capture, dates, metadata, replay = map(read, sys.argv[1:])
    credits = {r['id']: r['credits'] for r in metadata}
    # Keep the published evidence small: one row per cohort, including unchanged controls.
    summary = {'countColumns': ['scored', 'disliked', 'weak', 'liked', 'five'],
               'outcomeColumns': ['dislikedRed', 'weakRed', 'likedRed', 'neutralRed', 'weakGreen', 'fiveGreen'],
               'concordanceColumns': ['all', 'likedVsWeak', 'fiveVsThreePointFive'],
               'cohorts': []}
    for result in evaluate(capture, dates, credits, replay):
        before, after = result['graded'], result['control']
        summary['cohorts'].append({
            'medium': result['medium'], 'split': result['split'], 'budget': result['budget'],
            'counts': [before[k] for k in summary['countColumns']], 'changedStars': result['touchedByStars'],
            'before': [before[k] for k in summary['outcomeColumns']],
            'after': [after[k] for k in summary['outcomeColumns']],
            'rankingBefore': result['gradedConcordance'], 'rankingAfter': result['controlConcordance'],
        })
    print(json.dumps(summary, separators=(',', ':')))
