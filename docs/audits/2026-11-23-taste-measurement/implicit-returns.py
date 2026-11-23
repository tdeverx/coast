"""Compare return-to-another-season evidence with a frozen, ratings-masked Coast baseline.

python3 implicit-returns.py private-session-input.json frozen-capture.json frozen-show-folds.json frozen-chronological-controls.json
Outputs only aggregate metrics. Dependencies are Python's standard library.
"""
import collections
import hashlib
import json
import math
import sys
from datetime import datetime

def load(path):
    with open(path) as src:
        return json.load(src)

def stamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()

def fold_of(work):
    return hashlib.sha256(work.encode()).digest()[0] % 5

def observations(events, supply, roots, asof):
    clocks = collections.defaultdict(set)
    earliest = collections.defaultdict(dict)
    for work in roots:
        for event in events[work]:
            if stamp(event['at']) > asof:
                continue
            clocks[event['at']].add(event['media_id'])
            earliest[work].setdefault(event['media_id'], event)
    records = {}
    for work in roots:
        unique = list(earliest[work].values())
        if not unique:
            continue
        latest = max(stamp(e['at']) for e in unique)
        now = collections.Counter(s for s, t in supply[work] if t <= asof - 90 * 86400)
        then = collections.Counter(s for s, t in supply[work] if t <= latest)
        days = collections.defaultdict(set)
        for event in unique:
            at, release = event['at'], event['release']
            near_release = release and -.5 <= (stamp(at) - stamp(release)) / 86400 < 2
            clock_grid = (event['source'] in ('trakt', 'jellyfin') and near_release
                          and at[14:16] in ('00', '30') and at[17:19] == '00')
            if len(clocks[at]) < 3 and not clock_grid:
                days[event['season_number']].add(at[:10])
        if days:
            records[work] = (sum(len(value) >= 2 for value in days.values()) >= 2,
                             sum(then.values()), sum(now.values()),
                             sum(n >= 2 for n in then.values()), sum(n >= 2 for n in now.values()))
    return records

WEIGHTS = {'genres': 1, 'tags': 1, 'themes': .8, 'franchises': .85, 'directors': .72,
           'writers': .6, 'cast': .55, 'studios': .4, 'networks': .4, 'decades': .16,
           'countries': .1, 'languages': .08, 'ageRatings': .14}

def vector(features, frequencies=None):
    values, seen = {}, set()
    for family, strength in WEIGHTS.items():
        terms = []
        for term in features.get(family, []):
            if family in ('genres', 'themes', 'tags'):
                name = term['name'].lower()
                if name in seen:
                    continue
                seen.add(name)
            key = (family, term['id'])
            if frequencies is None or frequencies[key] >= 3:
                terms.append(key)
        if terms:
            values.update({key: strength / math.sqrt(len(terms)) for key in terms})
    return values

def learn(rows):
    frequencies = collections.Counter(key for features, _, _ in rows for key in vector(features))
    bins = collections.defaultdict(list)
    for _, outcome, opportunity in rows:
        bins[opportunity].append(outcome)
    prior = (1 + sum(y for _, y, _ in rows)) / (2 + len(rows))
    offsets = {}
    for group, labels in bins.items():
        p = (sum(labels) + 8 * prior) / (len(labels) + 8)
        offsets[group] = math.log(p / (1 - p))
    samples = [(vector(f, frequencies), y, offsets[z]) for f, y, z in rows]
    weights, intercept = {}, 0
    for _ in range(120):
        gradient = collections.Counter()
        intercept_change = 0
        for features, outcome, offset in samples:
            s = intercept + offset + sum(weights.get(k, 0) * v for k, v in features.items())
            error = outcome - 1 / (1 + math.exp(-s))
            intercept_change += error
            for k, v in features.items():
                gradient[k] += error * v
        intercept += .5 * intercept_change / len(rows)
        for k, g in gradient.items():
            current = weights.get(k, 0)
            weights[k] = current + 6 * (g - 2 * current) / len(rows)
    return lambda f: intercept + sum(weights.get(k, 0) * v for k, v in vector(f, frequencies).items())

def metrics(rows, score):
    num = den = 0
    for fold in {r[0] for r in rows}:
        group = [r for r in rows if r[0] == fold]
        for pos in [r for r in group if r[2] >= 4]:
            for neg in [r for r in group if r[2] <= 3]:
                num += (pos[score] > neg[score]) + .5 * (pos[score] == neg[score])
                den += 1
    def top(genre):
        group = [r for r in rows if genre is None or genre in r[3]]
        return sum(r[2] >= 4 for r in sorted(group, key=lambda r: (-r[score], r[1]))[:20])
    return dict(order=round(100 * num / den, 2), pairs=den, top=top(None),
                animationTop=top('Animation'), sciFiTop=top('Sci-Fi & Fantasy'))

def main():
    raw, capture, control, timeline = map(load, sys.argv[1:])
    data = next(m for m in capture if m['medium'] == 'show')
    history = {r['work']['id']: r for r in data['history']}
    metadata = {r['id']: r['features'] for r in data['catalogue'] if r['observed']}
    reliable = sorted(r['firstWatch'] for r in data['history'] if r['work']['rating'] is not None
                      and r.get('firstWatch') and r['work'].get('lastExperiencedAt'))
    cut = reliable[int(.75 * len(reliable))] / 1000
    events, supply = collections.defaultdict(list), collections.defaultdict(list)
    for e in raw['watches']:
        if e['kind'] == 'episode' and not e['special'] and (e['season_number'] or 0) > 0:
            events[e['root']].append(e)
    for e in raw['census']:
        supply[e['root']].append((e['season'], stamp(e['release'])))
    results = collections.defaultdict(list)
    for fold in [0, 1, 2, 3, 4, 'time']:
        if fold == 'time':
            asof = cut
            roots = [i for i, r in history.items() if r.get('firstWatch') and r['firstWatch'] / 1000 < cut]
            held = [r for r in timeline if r['model'] == 'baseline' and r['medium'] == 'show'
                    and r['split'] == 'chronological' and not r['rated']]
        else:
            asof = data['asOf'] / 1000
            roots = [i for i in history if fold_of(i) != fold]
            held = [r for r in control if not r['rated'] and r['fold'] == fold]
        records = observations(events, supply, roots, asof)
        for arm in ('ten episodes', 'eligible seasons', 'available by last watch'):
            train = []
            for work, (outcome, then_eps, all_eps, then_seasons, all_seasons) in records.items():
                if arm == 'ten episodes':
                    if then_eps < 10:
                        continue
                    stratum = int(math.log2(max(1, then_eps)) // 1.5)
                else:
                    if all_seasons < 2 or (arm == 'available by last watch' and then_seasons < 2):
                        continue
                    stratum = (min(5, int(math.log2(1 + all_eps))), min(5, all_seasons))
                train.append((history[work]['features'], outcome, stratum))
            fit = learn(train)
            for r in held:
                if r['score'] is None:
                    continue
                key = r['id']
                assert key not in records
                features = metadata.get(key, history[key]['features'])
                delta = max(-12, min(12, 10 * fit(features)))
                predicted = int(.5 + max(0, min(100, r['score'] + delta)))
                results['time' if fold == 'time' else 'work', arm].append(
                    (fold, key, r['stars'], [t['name'] for t in features.get('genres', [])], r['score'], predicted))
    for key, rows in results.items():
        print(*key, len(rows), 'baseline', metrics(rows, 4), 'candidate', metrics(rows, 5))

if __name__ == '__main__':
    main()
