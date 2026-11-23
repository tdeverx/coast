"""Single-viewer content profiles. Arguments: session input, capture, movie folds, show folds, controls, dated controls."""
import collections
import math
import runpy
import random
import sys
from pathlib import Path

common = runpy.run_path(str(Path(__file__).with_name('implicit-returns.py')))
load, stamp, vector, fold_of = (common[k] for k in ('load', 'stamp', 'vector', 'fold_of'))
DAY = 86400

def dot(a, b):
    return sum(val * b.get(k, 0) for k, val in a.items())

def unit(a):
    n = math.sqrt(dot(a, a))
    return {k: v/n for k, v in a.items()} if n else {}

def fit_pairs(groups, profiles):
    # Compare opening works from distinct rest-of-history opportunities. One-off choices are observed too.
    positives = [r for r in groups if r[1]]
    ordinary = [r for r in groups if not r[1]]
    if min(len(positives), len(ordinary)) < 5:
        return None, len(positives), len(ordinary)
    samples = []
    for i, _, date, size in positives:
        controls = sorted(ordinary, key=lambda r: (abs(math.log2(size/r[3])) + abs(r[2]-date)/(3*365*DAY), r[0]))[:5]
        for j, *_ in controls:
            diff = collections.Counter(profiles[i])
            diff.subtract(profiles[j])
            samples.append({k: v for k, v in diff.items() if v and k[0] != 'franchises'})
    beta = {}
    for _ in range(80):
        gradient = collections.Counter()
        for f in samples:
            error = 1/(1+math.exp(dot(f, beta)))
            for k, v in f.items():
                gradient[k] += error*v
        for k, v in gradient.items():
            beta[k] = beta.get(k, 0) + 3*(v/len(samples) - .035*beta.get(k, 0))
    return beta, len(positives), len(ordinary)

def conditioned(medium, watched, events, census, film_groups, asof):
    groups = []
    if medium == 'movie':
        anchors = {}
        for family in film_groups.values():
            seen = sorted((watched[i], i) for i, d in family.items() if i in watched and d <= asof)
            eligible = sum(d <= asof - 90*DAY for d in family.values())
            if eligible < 2 or not seen:
                continue
            first, root = seen[0]
            if first > asof - 90*DAY:
                continue
            # Roots with overlapping collection IDs get one vote.
            outcome = any(t-first >= DAY for t, _ in seen[1:])
            prior = anchors.get(root)
            anchors[root] = (root, outcome or (prior and prior[1]) or False, first, max(eligible, prior[3] if prior else 0))
        return list(anchors.values())
    clocks = collections.defaultdict(set)
    for i in watched:
        for r in events[i]:
            if r['when'] <= asof:
                clocks[r['at']].add(r['media_id'])
    for root, first in watched.items():
        eligible = collections.Counter(season for season, t in census[root] if t <= asof - 90*DAY)
        if first > asof - 90*DAY or sum(n >= 2 for n in eligible.values()) < 2:
            continue
        days = collections.defaultdict(set)
        for r in events[root]:
            if r['when'] > asof or len(clocks[r['at']]) >= 3:
                continue
            if (r['source'] in ('trakt','jellyfin') and r['release'] and -.5 <= (r['when'] - stamp(r['release']))/DAY < 2
                and r['at'][14:16] in ('00','30') and r['at'][17:19] == '00'):
                continue
            days[r['season_number']].add(r['at'][:10])
        if days:
            groups.append((root, sum(len(s) >= 2 for s in days.values()) >= 2, first, sum(eligible.values())))
    return groups

def order(groups, field):
    wins = pairs = coverage = 0
    for rs in groups:
        rs = [r for r in rs if r[field] is not None]
        coverage += len(rs)
        pos = [r[field] for r in rs if r['stars'] >= 4]
        neg = [r[field] for r in rs if r['stars'] <= 3]
        wins += sum((p>n) + .5*(p==n) for p in pos for n in neg)
        pairs += len(pos)*len(neg)
    return (round(100*wins/pairs, 2) if pairs else None, pairs, coverage)

def paired_interval(groups):
    rng=random.Random(39)
    differences=[]
    for rs in groups:
        p=[r for r in rs if r['stars']>=4 and r['base'] is not None and r['mix'] is not None]
        n=[r for r in rs if r['stars']<=3 and r['base'] is not None and r['mix'] is not None]
        if p and n:
            def credit(a,b,k):
                return (a[k]>b[k])+.5*(a[k]==b[k])
            differences.append([[credit(a,b,'mix')-credit(a,b,'base') for b in n] for a in p])
    values=[]
    if not differences:
        return None
    for _ in range(600):
        wins=pairs=0
        for d in differences:
            nx,ny=len(d),len(d[0])
            xs=rng.choices(range(nx),k=nx)
            ys=rng.choices(range(ny),k=ny)
            wins+=sum(d[x][y] for x in xs for y in ys)
            pairs+=nx*ny
        values.append(100*wins/pairs)
    return [round(sorted(values)[i],2) for i in (15,584)]

def main():
    raw, captures, movie_fold, show_fold, controls, dated = map(load, sys.argv[1:])
    events, census, films = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(dict)
    for e in raw['watches']:
        if e['kind'] == 'movie' or (e['kind']=='episode' and (e['season_number'] or 0)>0 and not e['special']):
            events[e['root']].append(dict(e, when=stamp(e['at'])))
    for e in raw['census']:
        census[e['root']].append((e['season'],stamp(e['release'])))
    for e in raw['films']:
        films[e['family']][e['work']] = stamp(e['release'])
    for batch, grid in zip(captures, [movie_fold, show_fold]):
        medium = batch['medium']
        rows = {r['work']['id']:r for r in batch['history']}
        descriptor = {i:r['features'] for i,r in rows.items()}
        descriptor.update({r['id']:r['features'] for r in batch['catalogue'] if r['observed']})
        first = {i:min(e['when'] for e in events[i]) for i in rows if events[i]}
        observed = conditioned(medium, first, events, census, films, batch['asOf']/1000)
        # Descriptive label audit only; these ratings never enter a fitted profile.
        for group in (True,False):
            labels = [rows[i]['work']['rating'] for i,outcome,*_ in observed if outcome==group]
            rated = [v for v in labels if v is not None]
            print(medium,'returned',group,'total/rated/liked/weak',len(labels),len(rated),
                  sum(v>=4 for v in rated),sum(v<=3 for v in rated))
        cohort = [r for r in rows.values() if r['work']['rating'] is not None and r.get('firstWatch') and r['work'].get('lastExperiencedAt')]
        cut = sorted(r['firstWatch'] for r in cohort)[int(.75*len(cohort))]/1000
        results = collections.defaultdict(list)
        for split in ['work','franchise','first watch','rating 2022','rating 2024']:
            for fold in range(5 if split in ('work','franchise') else 1):
                asof = batch['asOf']/1000
                if split == 'work':
                    held = [r for r in grid if not r['rated'] and r['fold']==fold]
                    roots = [i for i in first if fold_of(i)!=fold]
                elif split == 'franchise':
                    eligible = [r for r in controls if r['medium']==medium and r['model']=='baseline' and r['split']=='franchise' and not r['rated']]
                    held = [r for r in eligible if r['fold']==fold]
                    # Construct the same connected-franchise folds for *all* history, including unrated siblings.
                    parents = {}
                    def root(key):
                        while key in parents: key=parents[key]
                        return key
                    for i, r in rows.items():
                        keys=['collection:'+x for x in r.get('collections',[])]+['feature:'+f['id'] for f in r['features'].get('franchises',[])]
                        for key in keys:
                            a,b=root(key),root(i)
                            if a!=b:parents[max(a,b)]=min(a,b)
                    assert all(fold_of(root(r['id']))==r['fold'] for r in eligible)
                    roots = [i for i in first if fold_of(root(i))!=fold]
                elif split == 'first watch':
                    held = [r for r in controls if r['medium']==medium and r['model']=='baseline' and r['split']=='chronological' and not r['rated']]
                    asof=cut-1e-5
                    roots=[i for i in first if first[i]<=asof]
                else:
                    start=int(split[-4:]);asof=stamp(str(start)+'-01-01T00:00:00Z')-1e-5
                    held=[r for r in dated if r['medium']==medium and r['year']==start]
                    assert all(first[r['id']]>asof for r in held)
                    roots=[i for i in first if first[i]<=asof]
                assert not ({r['id'] for r in held} & set(roots))
                watched={i:first[i] for i in roots}
                # Compute term frequencies only over this viewer’s past watched works.
                frequencies=collections.Counter(k for i in roots for k in vector(descriptor[i]))
                def content(f):
                    return unit({k:v*math.sqrt(1+math.log((1+len(roots))/(1+n))) for k,v in vector(f).items()
                                 if (n:=frequencies[k])>=2})
                xs={i:content(descriptor[i]) for i in roots}
                centre=collections.Counter()
                for v in xs.values():centre.update(v)
                centre=unit(centre)
                pos=set();neg=set()
                for e in raw['decisions']:
                    i=e['work'];seen_at=stamp(e['at'] if e['known'] else e['recorded'])
                    if i not in watched or seen_at>asof:continue
                    if e['action']=='favourite':
                        (pos.discard if e['value'] is False else pos.add)(i)
                    elif e['action']=='drop':neg.add(i)
                    elif e['action'] in ('restore','pause','resume'):neg.discard(i)
                # A favourite and an intentional drop are directional; require independent examples of both signs.
                signed=None
                if min(len(pos),len(neg))>=3:
                    signed=collections.Counter()
                    for side,labels in [(1,pos),(-1,neg)]:
                        for i in labels:signed.update({k:side*v/len(labels) for k,v in xs[i].items()})
                pairs,P,C=fit_pairs(conditioned(medium,watched,events,census,films,asof),xs)
                scored=[]
                for r in held:
                    i=r['id'];x=content(descriptor[i]);base=r.get('score')
                    if 'score' in r and base is None:continue
                    signed_score=dot(x,signed) if signed is not None and x else None
                    comparison=dot(x,pairs) if pairs is not None and x else None
                    blend=max(0,min(100,round(base+8*max(-1,min(1,comparison))))) if base is not None and comparison is not None else base
                    scored.append(dict(id=i,stars=r['stars'],base=base,centre=dot(x,centre) if x else None,signed=signed_score,pair=comparison,mix=blend))
                results[split].append(scored)
                if fold==0: print(medium,split,'first split support',len(roots),'comparisons',P,C,'directional',len(pos),len(neg))
            print(medium,split,{k:order(results[split],k) for k in ('base','centre','signed','pair','mix')},
                  'paired blend interval', paired_interval(results[split]))

if __name__=='__main__':
    main()
