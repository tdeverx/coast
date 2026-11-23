"""Replay personal prediction errors across film directors and show creators."""
import hashlib
import importlib.util
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean

previous = Path(__file__).resolve().parents[1] / '2026-11-23-personal-dislike-signals'
sys.path.insert(0, str(previous))
import lineage

spec = importlib.util.spec_from_file_location('exact', previous / 'lineage-exact.py')
exact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exact)


def descriptors(capture, metadata):
    media = {m['id']: m for m in metadata}
    rules = {'action': 'action & adventure', 'adventure': 'action & adventure',
             'science fiction': 'sci-fi & fantasy', 'fantasy': 'sci-fi & fantasy'}
    traits = {}
    for panel in capture:
        for row in panel['history']:
            i = row['work']['id']
            m = media.get(i, {})
            traits[i] = dict(leads=frozenset(lineage.authors(m, panel['medium'])[0]),
                             name=re.sub(r'[^\w]', '', m.get('title', '').casefold()),
                             genres={rules.get(v['id'], v['id']) for v in row['features'].get('genres', [])},
                             series={('franchise', f['id']) for f in row['features'].get('franchises', [])}
                                    | {('collection', v) for v in row.get('collections', [])})
    return traits


def run(capture, metadata, dates, graded, inner):
    traits = descriptors(capture, metadata)
    labels = {d['id']: d for d in dates}
    receipts = {(p['medium'], p['split'], p['budget'], p['group']): {o['id']: o['base'] for o in p['points']}
                for p in inner}
    canon, by_group = {}, defaultdict(list)
    for panel in graded['runs']:
        key = (panel['medium'], panel['split'], panel['budget'])
        if key[1:] == ('work', 'all'):
            canon[key[0]] = {t['id']: t for t in panel['targets']}
        for t in panel['targets']:
            by_group[key + (t['group'],)].append(t)

    def training(medium, split, budget, group):
        key = (medium, split, budget)
        held = by_group.get(key + (group,), [])
        known = exact.allowed_ratings(canon[medium], labels, held, group, split, budget)
        if split != 'rolling-day':
            assert held
            forecasts = receipts[key + (group,)]
        else:
            usable_days = [k[-1] for k in receipts if k[:3] == key and k[-1] <= group]
            forecasts = dict(receipts[key + (max(usable_days),)]) if usable_days else {}
            for d in usable_days:
                if d < group:
                    forecasts.update({t['id']: t['scores']['calibrated'] for t in by_group[key + (d,)]
                                      if t['scores']['calibrated'] is not None})
            assert all(labels[i]['at'][:10] < group for i in forecasts)
        assert forecasts.keys() <= known.keys()
        return known, forecasts

    # A recorded shared franchise or title never supplies an outside-family vote.
    opportunities = defaultdict(list)
    for left in canon:
        for i, t in canon[left].items():
            a = traits[i]
            if not a['leads']:
                continue
            for right in canon:
                for j, other in canon[right].items():
                    b = traits[j]
                    if not (a['leads'] & b['leads']) or lineage.overlap(a['leads'], b['leads']) < .5:
                        continue
                    if t['cluster'] == other['cluster'] or a['series'] & b['series'] or a['name'] == b['name']:
                        continue
                    opportunities[i].append((j, right, a['leads'] == b['leads'],
                                             lineage.overlap(a['genres'], b['genres']) >= .5))

    totals, changed = [], []
    for panel in graded['runs']:
        medium, split, budget = (panel[k] for k in ('medium', 'split', 'budget'))
        counts = {arm: Counter() for arm in ('exact', 'partial')}
        for group in {t['group'] for t in panel['targets']}:
            inputs = {k: training(k, split, budget, group) for k in canon}
            held = by_group[medium, split, budget, group]
            assert not (inputs[medium][0].keys() & {t['id'] for t in held})
            for t in held:
                i, s, original = t['id'], t['stars'], t['scores']['calibrated']
                if original is None:
                    continue
                for arm, ct in counts.items():
                    candidates = [(j, kind, genre_match) for j, kind, equal, genre_match in opportunities[i]
                                  if (equal or arm == 'partial') and j in inputs[kind][0]]
                    known = [inputs[kind][0][j] for j, kind, _ in candidates]
                    cross = [(j, kind) for j, kind, match in candidates if match and kind != medium]
                    ct['scored'] += 1
                    ct['matchedCross'] += bool(cross)
                    ct['matchedCrossDisliked'] += bool(cross) and s <= 2.5
                    ct['matchedCrossFive'] += bool(cross) and s == 5
                    sign = -1 if known and max(known) <= 2.5 else 1 if known and min(known) >= 4.5 else 0
                    ct['unanimousNegative'] += bool(cross) and sign == -1
                    ct['unanimousPositive'] += bool(cross) and sign == 1
                    families = defaultdict(list)
                    support = []
                    if sign:
                        for j, kind in cross:
                            feedback, predicted = inputs[kind]
                            if j in predicted:
                                families[canon[kind][j]['cluster']].append(lineage.utility(feedback[j]) - predicted[j])
                                support.append(j)
                    error = mean(mean(values) for values in families.values()) if families else 0.
                    score = lineage.display(original + sign * max(0., sign * error))
                    ct['changed'] += score != original
                    ct['dislikesNewRed'] += s <= 2.5 and score < 50 <= original
                    ct['likedNewRed'] += s >= 4 and score < 50 <= original
                    ct['dislikesRaised'] += s <= 2.5 and score > original
                    ct['fiveLower'] += s == 5 and score < original
                    ct['fiveLostGreen'] += s == 5 and score < 80 <= original
                    ct['fiveGainedGreen'] += s == 5 and score >= 80 > original
                    ct['middlingNewGreen'] += 2.5 < s < 4 and score >= 80 > original
                    if score != original:
                        changed.append(dict(medium=medium, split=split, budget=budget, group=group, arm=arm,
                                            id=i, stars=s, original=original, score=score, donors=sorted(support)))
        totals.append(dict(medium=medium, split=split, budget=budget, counts=counts))
    return totals, changed


if __name__ == '__main__':
    if len(sys.argv) != 6:
        raise SystemExit('Usage: cross-format.py SOLO_CAPTURE METADATA VERIFIED_DATES GRADED INNER_SCORES')
    args = [lineage.read(p) for p in sys.argv[1:]]
    for field, path in zip(('capture', 'metadata', 'dates'), sys.argv[1:4]):
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == args[3]['manifest'][field]
    result, changes = run(*args)
    if path := os.environ.get('COAST_CROSS_FORMAT_PRIVATE'):
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
            json.dump(changes, f)
    print(json.dumps(result, separators=(',', ':')))
