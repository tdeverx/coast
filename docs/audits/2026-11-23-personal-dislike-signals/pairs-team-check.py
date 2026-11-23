"""Reconstruct the identical-team tests separately and count the teams behind the hits."""
import json
import hashlib
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean


def read(path):
    return json.loads(Path(path).read_bytes())


def utility(stars):
    return max(0, 20 * (stars - .5)) if stars <= 3 else min(80, 50 + (stars - 3) * 30) + max(0, stars - 4) * 20


def check(metadata, dates, graded, inner, genre_capture=None):
    def signature(row):
        roles = {'Creator','Showrunner'} if row['kind']=='show' else {'Director'}
        return frozenset(str(c['id']) for c in row['credits'] or []
                         if c['role'] in roles and str(c['id']).isdigit())
    teams = {r['id']:signature(r) for r in metadata}
    genre = {r['work']['id']:{v['id'] for v in r['features'].get('genres',[])}
             for medium in (genre_capture or []) for r in medium['history']}
    ratings = {r['id']:r for r in dates}
    folds = {(r['medium'],r['split'],r['budget'],r['group']):r['points'] for r in inner}
    records, interesting = [], []
    for run in graded['runs']:
        medium, split, budget = [run[k] for k in ('medium','split','budget')]
        all_roots = next(r['targets'] for r in graded['runs'] if r['medium']==medium and r['split']=='work' and r['budget']=='all')
        families = {r['id']:r['cluster'] for r in all_roots}
        structural_stars = {r['id']:r['stars'] for r in all_roots}
        tallies = defaultdict(Counter)
        for group in {t['group'] for t in run['targets']}:
            held = [t for t in run['targets'] if t['group']==group]
            points = {p['id']:p['base'] for p in folds[medium,split,budget,group]}
            assert not (points.keys() & {t['id'] for t in held})
            if split=='rolling-day':
                assert all(ratings[i]['at'][:10]<group for i in points)
                known={i:ratings[i]['stars'] for i in families if i in ratings and ratings[i]['at'][:10]<group}
            else:
                permitted=families.keys()-{t['id'] for t in held}
                if budget!='all':
                    n, _, seed=budget.partition('#')
                    permitted=sorted(permitted,key=lambda i:hashlib.sha256(
                        f'solo:{seed or "1"}:{i}'.encode()).digest())[:int(n)]
                known={i:structural_stars[i] for i in permitted}
            assert points.keys()<=known.keys()
            train = defaultdict(list)
            for i in known:
                if teams.get(i):
                    train[teams[i]].append(i)
            for t in held:
                i = t['id']
                base = t['scores']['calibrated']
                if base is None:
                    continue
                donors = [j for j in train.get(teams.get(i),[]) if families[i]!=families[j]]
                eligible = donors and all(known[j]<=2.5 for j in donors)
                errors = defaultdict(list)
                if eligible:
                    for j in set(donors)&points.keys():
                        if genre_capture is not None:
                            intersection = genre[j] & genre[i]
                            if not intersection or len(intersection) / len(genre[j] | genre[i]) < .5:
                                continue
                        errors[families[j]].append(utility(ratings[j]['stars'])-points[j])
                for minimum in (1,2):
                    score = base
                    if len(errors) >= minimum:
                        score = max(0, min(base, math.floor(base + mean(map(mean, errors.values())) + .5)))
                    cnt = tallies[minimum]
                    cnt['changed'] += score!=base
                    cnt['trueRed'] += score<50<=base and t['stars']<=2.5
                    cnt['likedFalseRed'] += score<50<=base and t['stars']>=4
                    cnt['greenFiveLost'] += score<80<=base and t['stars']==5
                    cnt['fiveLower'] += score<base and t['stars']==5
                    if score<50<=base:
                        interesting.append((medium,split,budget,minimum,i,score,donors,t['stars'],group))
        records.append({'medium':medium,'split':split,'budget':budget,'variants':tallies})
    return records,interesting


if __name__ == '__main__':
    if len(sys.argv) not in (5,6):
        raise SystemExit('Usage: pairs-team-check.py METADATA VERIFIED_DATES GRADED INNER_PERSONAL_SCORES [GENRE_CAPTURE]')
    records,hits=check(*(read(p) for p in sys.argv[1:]))
    print(json.dumps(records,separators=(',',':')))
