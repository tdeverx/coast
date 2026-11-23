"""Retrospective comparison of TMDB agreement models on the frozen personal-score holdouts."""
import hashlib
import json
import math
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_bytes())


def utility(stars):
    if stars <= 3:
        return max(0, 20 * (stars - .5))
    return 50 + 30 * min(1, stars - 3) + 20 * max(0, stars - 4)


@dataclass(frozen=True)
class Title:
    reception: float
    votes: int
    traits: tuple

    @property
    def reliability(self):
        return self.votes / (self.votes + 50)


def family_keys(history):
    parents = {}

    def root(key):
        while key in parents:
            key = parents[key]
        return key

    for row in history:
        work = row['work']['id']
        entourage = ['collection:' + k for k in row.get('collections', [])]
        entourage += ['feature:' + t['id'] for t in row['features'].get('franchises', [])]
        for key in entourage:
            a, b = sorted((root(work), root(key)))
            if a != b:
                parents[b] = a
    return {r['work']['id']: root(r['work']['id']) for r in history}


class Regression:
    def __init__(self):
        self.n = 0
        self.mass = self.wx = self.wy = self.xx = self.yy = self.xy = 0.

    def add(self, x, y, weight):
        self.n += 1
        self.mass += weight
        self.wx += weight * x
        self.wy += weight * y
        self.xx += weight * x * x
        self.yy += weight * y * y
        self.xy += weight * x * y

    def slope(self, minimum):
        if self.n < minimum or self.mass < minimum / 2:
            return None
        x, y = self.wx / self.mass, self.wy / self.mass
        xx = self.xx - self.wx * x
        xy = self.xy - self.wy * x
        yy = self.yy - self.wy * y
        if xx < 1e-8:
            return None
        raw = xy / xx
        error = math.sqrt(max(0., yy - raw * xy) / (self.mass - 2) / xx)
        return (x, max(0., raw - error) * self.mass / (self.mass + 8), self.mass)


def supported_mean(value, by_family):
    # Tags and genres each get one share. A heavily tagged title cannot multiply
    # the same votes. Unobserved traits retain the broader prior.
    estimates = []
    for contexts in by_family:
        if contexts:
            mass = sum(n for _, n in contexts)
            estimates.append(sum(n * (v * n / (n + 12) + value * 12 / (n + 12)) for v, n in contexts) / mass)
    return sum(estimates) / len(estimates) if estimates else value


def fit(rows):
    stats = defaultdict(Regression)
    for _, title, residual in rows:
        stats[None].add(title.reception, residual, title.reliability)
        for family in title.traits:
            for trait in family:
                stats[trait].add(title.reception, residual, title.reliability)
    return {k: summary for k, reg in stats.items() if (summary := reg.slope(16 if k is None else 8))}


def predict(model, title):
    if None not in model or title is None:
        return 0., 0.
    x = title.reception
    center, slope, _ = model[None]
    global_value = slope * (x - center)
    local = []
    for family in title.traits:
        values = []
        for k in family:
            if k in model:
                center, slope, mass = model[k]
                values.append((slope * (x - center), mass))
        local.append(values)
    return title.reliability * global_value, title.reliability * supported_mean(global_value, local)


class Gain:
    def __init__(self):
        self.n = 0
        self.square = self.dot = 0.

    def add(self, delta, error):
        # delta already has its observation's crowd-count reliability.
        self.n += 1
        self.dot += delta * error
        self.square += delta * delta

    def gate(self, minimum):
        if self.n < minimum or self.square < .01:
            return None
        # Require cross-fit SSE to improve over no audience correction.
        if 2 * self.dot <= self.square:
            return 0., self.n
        return min(1., self.dot / self.square), self.n


def gates(rows, partitions):
    gains = defaultdict(Gain)
    for fold in range(4):
        model = fit([r for r in rows if partitions[r[0]] != fold])
        for key, t, residual in rows:
            if partitions[key] != fold:
                continue
            _, delta = predict(model, t)
            gains[None].add(delta, residual)
            for family in t.traits:
                for trait in family:
                    gains[trait].add(delta, residual)
    return {k: v for k, g in gains.items() if (v := g.gate(16 if k is None else 8))}


def gated(raw, gate, title):
    if title is None or None not in gate:
        return 0.
    w = gate[None][0]
    local = [[gate[k] for k in family if k in gate] for family in title.traits]
    return raw * supported_mean(w, local)


def metrics(data, arm):
    counts = Counter()
    shifts = defaultdict(list)
    agree = order = 0.
    pairs = sep = 0
    for records in data:
        for target, title, before, deltas in records:
            stars = target['stars']
            if before is None:
                counts['abstentions'] += 1
                continue
            after = deltas[arm]
            counts['scored'] += 1
            counts['changed'] += before != after
            if title is None:
                counts['missingReception'] += 1
                assert before == after
            if stars <= 2.5:
                counts['dislikes'] += 1
                counts['dislikesRed'] += after < 50
                counts['dislikesNewlyRed'] += after < 50 <= before
                shifts['dislikes'].append(after - before)
            if stars >= 4:
                counts['liked'] += 1
                counts['likedNewlyRed'] += after < 50 <= before
            if stars == 5:
                for label in ['five'] + (['againstCrowdFive'] if title and stars - title.reception / 2 >= 1 else []):
                    counts[label] += 1
                    counts[label + 'Lower'] += after < before
                    counts[label + 'Higher'] += after > before
                    counts[label + 'LostGreen'] += after < 80 <= before
                    counts[label + 'GainedGreen'] += before < 80 <= after
                    shifts[label].append(after - before)
            shifts['absoluteErrorChange'].append(abs(after - utility(stars)) - abs(before - utility(stars)))
        for (a, _, sa, da), (b, _, sb, db) in combinations(records, 2):
            d = a['stars'] - b['stars']
            if not d or sa is None or sb is None:
                continue
            p = (da[arm] - db[arm]) * d
            order += (p > 0) + .5 * (p == 0)
            pairs += 1
            if min(a['stars'], b['stars']) <= 2.5 and max(a['stars'], b['stars']) >= 4:
                agree += (p > 0) + .5 * (p == 0)
                sep += 1
    return {'counts': dict(counts), 'meanDeltas': {k: round(sum(v) / len(v), 3) for k, v in shifts.items()},
            'order': round(order / pairs, 5) if pairs else None,
            'dislikeLikedOrder': round(agree / sep, 5) if sep else None}


def run(capture, dates, metadata, replay, panels, strict=False):
    if strict:
        from strict_local import local_gates, local_delta
    info = {m['id']: m for m in metadata}
    labels = {d['id']: d for d in dates}
    inputs = {(p['medium'], p['split'], p['budget'], p['group']): p['points'] for p in panels}
    reports = []
    private = []
    for dataset in capture:
        medium = dataset['medium']
        features = {r['work']['id']: r['features'] for r in dataset['history']}
        features.update({r['id']: r['features'] for r in dataset['catalogue']})
        titles = {}
        for k, f in features.items():
            a = info.get(k, {}).get('audience')
            if a and a.get('votes', 0) > 0 and a.get('scale') == 10 and 0 < a.get('score', 0) <= 10:
                tags = tuple(tuple(sorted({(kind, v['id']) for v in f.get(kind, [])})) for kind in ('genres', 'tags'))
                titles[k] = Title(a['score'], a['votes'], tags)
        families = family_keys(dataset['history'])
        partitions = {k: int(hashlib.sha256(('agreement-gate:' + f).encode()).hexdigest()[:8], 16) % 4 for k, f in families.items()}
        for panel in replay['runs']:
            if panel['medium'] != medium:
                continue
            key = (medium, panel['split'], panel['budget'])
            fold = defaultdict(list)
            for target in panel['targets']:
                fold[target['group']].append(target)
            observed = []
            for group, held in fold.items():
                pts = inputs[(*key, group)]
                hold_ids = {t['id'] for t in held}
                assert not any(p['id'] in hold_ids for p in pts)
                if panel['split'] == 'rolling-day':
                    assert all(labels[p['id']]['at'][:10] < group for p in pts)
                rows = [(p['id'], titles[p['id']], utility(labels[p['id']]['stars']) - p['base'])
                        for p in pts if p['id'] in titles]
                model = fit(rows)
                if strict:
                    local_gate = local_gates(rows, partitions, families, fit)
                else:
                    gate = gates(rows, partitions)
                group_result = []
                for h in held:
                    k = h['id']
                    before = h['scores']['calibrated']
                    title = titles.get(k)
                    if strict:
                        shifts = [('baseline', 0.), ('strict', local_delta(model, local_gate, title))]
                    else:
                        global_value, local = predict(model, title)
                        shifts = [('baseline', 0.), ('global', global_value), ('context', local), ('gated', gated(local, gate, title))]
                    deltas = {arm: None if before is None else max(0, min(100, math.floor(before + v + .5)))
                              for arm, v in shifts}
                    group_result.append((h, title, before, deltas))
                    private.append(dict(medium=medium, split=key[1], budget=key[2], group=group,
                                      id=k, title=info.get(k, {}).get('title'), stars=h['stars'],
                                      audience=title.reception if title else None, votes=title.votes if title else None,
                                      **deltas))
                observed.append(group_result)
            reports.append({'medium': medium, 'split': key[1], 'budget': key[2],
                            'arms': {a: metrics(observed, a) for a in (('baseline', 'strict') if strict else ('baseline', 'global', 'context', 'gated'))}})
    return reports, private


if __name__ == '__main__':
    args = sys.argv[1:]
    strict = args[:1] == ['--strict']
    if strict:
        args = args[1:]
    if len(args) != 7:
        raise SystemExit('Pass [--strict], capture, dates, metadata, graded receipt, private inner predictions, new public aggregate JSON and new private title ledger.')
    capture, dates, meta, graded, inner, out, ledger = args
    receipt = read(graded)
    for key, path in [('capture', capture), ('dates', dates), ('metadata', meta)]:
        assert digest(path) == receipt['manifest'][key]
    reports, private = run(read(capture), read(dates), read(meta), receipt, read(inner), strict)
    assert len(reports) == 32
    with open(out, 'x') as f:
        json.dump({'baselineHash': digest(graded), 'trainingScoreHash': digest(inner), 'runs': reports}, f, indent=1)
        f.write('\n')
    with os.fdopen(os.open(ledger, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as f:
        json.dump(private, f)
