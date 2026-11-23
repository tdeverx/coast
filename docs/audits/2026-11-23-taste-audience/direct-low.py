"""Can the viewer's absolute rating for poorly received neighbours independently predict a dislike?"""
import hashlib
import json
import math
import statistics
import sys
from collections import Counter, defaultdict

import corroboration as prior


def utility(stars):
    if stars <= 3:
        return max(0, 20 * (stars - .5))
    return 50 + 30 * min(1, stars - 3) + 20 * max(0, stars - 4)


def ordered_matches(i, features, families):
    ranks = []
    for j in features:
        if families[i] == families[j]:
            continue
        similarity = sum(prior.jaccard(a, b) for a, b in zip(features[i], features[j])) / 2
        if similarity > 0:
            ranks.append((-similarity, j))
    return [j for _, j in sorted(ranks)]


def representatives(ranks, train, families):
    chosen = {}
    for j in ranks:
        if j in train:
            chosen.setdefault(families[j], j)
            if len(chosen) == 48:
                break
    return chosen.values()


def training_set(group, held, split, budget, all_ids, labels, usable):
    if split == 'rolling-day':
        train = {i for i in all_ids if i in labels and labels[i]['at'][:10] < group}
    else:
        train = all_ids - {r['id'] for r in held}
        if budget != 'all':
            n, _, seed = budget.partition('#')
            train = set(sorted(train, key=lambda i: hashlib.sha256(
                f'solo:{seed or "1"}:{i}'.encode()).hexdigest())[:int(n)])
    return train & labels.keys() & usable


def run(capture, metadata, dates, graded):
    audience = {r['id']: r['audience'] for r in metadata}
    reports = []
    for data in capture:
        medium = data['medium']
        family = prior.replay.family_keys(data['history'])
        rows = {r['work']['id']: r for r in data['history'] if r['work']['rating'] is not None}
        labels = {r['id']: r for r in dates if r['medium'] == medium}
        features = {i: [{v['id'] for v in r['features'].get(k, [])} for k in ('genres', 'tags')]
                    for i, r in rows.items()}
        poor, available = prior.reception(data['catalogue'], audience)
        ranks = {i: ordered_matches(i, features, family) for i in poor & rows.keys()}
        for panel in graded['runs']:
            if panel['medium'] != medium:
                continue
            by_group = defaultdict(list)
            for r in panel['targets']:
                by_group[r['group']].append(r)
            counts = Counter()
            mins = {}
            for group, held in by_group.items():
                train = training_set(group, held, panel['split'], panel['budget'], rows.keys(), labels, available)
                for target in held:
                    i = target['id']
                    assert i not in train
                    base = target['scores']['calibrated']
                    counts['total'] += 1
                    if base is None:
                        continue
                    counts['scored'] += 1
                    if i not in poor:
                        continue
                    counts['lowerQuartile'] += 1
                    local = list(representatives(ranks[i], train, family))
                    assert len(local) == len(set(family[j] for j in local))
                    low = [labels[j]['stars'] for j in local if j in poor]
                    if min(len(low), len(local) - len(low)) < 8:
                        continue
                    counts['enoughFamiliesInBothBands'] += 1
                    if sum(s <= 2.5 for s in low) < 2:
                        continue
                    counts['twoIndependentDislikes'] += 1
                    if not prior.contextual_agreement(i, train, labels, family, features, poor):
                        continue
                    counts['relativeAgreement'] += 1
                    u = [50] + [utility(s) for s in low]
                    mean = statistics.mean(u)
                    upper = mean + 1.28155 * statistics.stdev(u) / math.sqrt(len(u))
                    for key, value in [('mean', mean), ('upper', upper)]:
                        mins[key] = min(mins.get(key, value), value)
                    counts['absoluteMeanBelow50'] += mean < 50
                    if mean < 50 and base >= 50 and math.floor(mean + .5) < 50:
                        stars = target['stars']
                        category = 'Disliked' if stars <= 2.5 else 'Liked' if stars >= 4 else 'Middle'
                        counts['meanOnlyNewRed' + category] += 1
                    if upper >= 50:
                        continue
                    counts['upperBoundBelow50'] += 1
                    candidate = min(base, math.floor(mean + .5))
                    counts['scoreChanged'] += candidate != base
                    stars = target['stars']
                    if candidate < 50 <= base:
                        counts['newRed'] += 1
                        counts['newRedDislikes'] += stars <= 2.5
                        counts['newRedMiddle'] += 3 <= stars <= 3.5
                        counts['newRedLiked'] += stars >= 4
                    counts['fiveStarLostGreen'] += stars == 5 and candidate < 80 <= base
            reports.append({k:panel[k] for k in ('medium','split','budget')} |
                           {'counts':dict(counts), 'minimumAmongAgreeingContexts':mins})
    return reports


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('Usage: direct-low.py CAPTURE METADATA VERIFIED_DATES GRADED')
    print(json.dumps(run(*(prior.replay.read(p) for p in sys.argv[1:])), indent=2))
