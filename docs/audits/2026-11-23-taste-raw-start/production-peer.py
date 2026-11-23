"""Offline whole-title counterevidence test. Run with CAPTURE CREDIT_METADATA GRADED PAIRED DIRECT_RATINGS.

Freeze the proposed rule before unmasking held ratings. Select another independently
rated franchise with at least one shared director/creator, writer or executive producer
and two different additional cast/crew people. Compare stable person IDs in two separate
views using IDF-weighted cosine. The geometric mean balances the two views. Require that
both titles rank the other uniquely first. Missing credits or tied distances abstain.

Only a donor rated <=2.5 triggers the proposed correction. For a given target, check
whether negative donors in other reciprocal pairs successfully predicted low ratings.
Exclude both target/donor franchises and all of their senior people from validation.
Collapse pairs connected by franchise or senior person to one vote. Require two
independent validation groups, no four-star-or-better contradiction, and utility below
50 after shrinking the group means by one neutral observation. A qualifying prediction
may decrease to the conservative higher of the donor's utility and validated estimate.
Output the unvalidated donor-only alternative to expose the price of that safeguard.
"""
import json
import math
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from statistics import mean

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '2026-11-23-hidden-title-audience'))
from blend import blend, compare, display, utility

SENIOR = {'Director','Creator','Showrunner','Writer','Screenplay','Head Writer','Teleplay','Executive Producer'}


def people(m, casts):
    crew = [p for p in m.get('credits') or [] if str(p.get('id','')).isdigit()]
    senior = {str(p['id']) for p in crew if p['role'] in SENIOR}
    cast = {c['id'].split(':')[1] for c in casts if c['id'].startswith('tmdb:')}
    others = (cast | {str(p['id']) for p in crew}) - senior
    return senior, others


def indexed(sets):
    freq = Counter(person for persons in sets.values() for person in persons)
    weight = {p:(1+math.log((len(sets)+1)/(n+1)))**2 for p,n in freq.items()}
    norm = {i:math.sqrt(sum(weight[p] for p in ps)) for i,ps in sets.items()}
    return weight,norm


def reciprocal(roots, families, descriptions):
    seniors = {i:descriptions[i][0] for i in roots}
    others = {i:descriptions[i][1] for i in roots}
    senior_weight,senior_norm = indexed(seniors)
    other_weight,other_norm = indexed(others)
    candidates = defaultdict(list)
    for a,b in combinations(roots,2):
        if families[a] == families[b]:
            continue
        shared_senior,shared_other = seniors[a] & seniors[b],others[a] & others[b]
        if not shared_senior or len(shared_other)<2:
            continue
        main = sum(senior_weight[p] for p in shared_senior)/(senior_norm[a]*senior_norm[b])
        other = sum(other_weight[p] for p in shared_other)/(other_norm[a]*other_norm[b])
        score = math.sqrt(main*other)
        candidates[a].append((score,b))
        candidates[b].append((score,a))
    first = {}
    for i, options in candidates.items():
        options.sort(reverse=True)
        if len(options)==1 or options[0][0]-options[1][0] > 1e-12:
            first[i] = options[0][1]
    return [(i,j) for i,j in first.items() if i<j and first.get(j)==i]


def pair_key(pair, descriptions, families):
    a,b=pair
    return {('person',p) for p in descriptions[a][0]|descriptions[b][0]} | {
        ('franchise',families[a]),('franchise',families[b])}


def validate(target, donor, pairs, stars, keys):
    query = keys[tuple(sorted((target,donor)))]
    components = []
    for pair in pairs:
        if keys[pair] & query:
            continue
        a,b=pair
        # Neither target star nor its donor's star enters this independent validation.
        assert not {target,donor}&{a,b}
        labels = [stars[t] for t,d in ((a,b),(b,a)) if stars[d]<=2.5]
        if not labels:
            continue
        tokens = set(keys[pair])
        combined = [labels]
        for k in range(len(components)-1,-1,-1):
            component, prior=components[k]
            if component & tokens:
                tokens.update(component)
                combined.extend(prior)
                components.pop(k)
        components.append((tokens,combined))
    if len(components)<2 or any(s>=4 for _,g in components for pair in g for s in pair):
        return None
    group_means = [mean(mean(utility(s) for s in pair) for pair in group) for _,group in components]
    estimate=display(mean([50,*group_means]))
    return estimate if estimate<50 else None


def run(capture, meta, graded, paired, verified):
    rows={r['id']:r for r in paired if r['direct']}
    direct={r['id']:r['stars'] for r in verified['ratings'] if r['at'] and r['stars'] is not None}
    assert set(rows)==set(direct) and len(rows)==870 and all(r['stars']==direct[i] for i,r in rows.items())
    assert sum(s<=2.5 for s in direct.values())==40 and sum(s==5 for s in direct.values())==125
    features={r['work']['id']:r['features'] for d in capture for r in d['history']}
    features.update({r['id']:r['features'] for d in capture for r in d['catalogue']})
    families={t['id']:t['cluster'] for panel in graded['runs']
              if panel['split']=='franchise' and panel['budget']=='all' for t in panel['targets']}
    descriptions={m['id']:people(m,features[m['id']].get('cast',[])) for m in meta if m['id'] in rows}
    assert set(descriptions)==set(rows)
    variants = {name:{i:r['native'] for i,r in rows.items()} for name in ('native','donorOnly','validated')}
    coverage={}
    for medium in ('movie','show'):
        roots=sorted(i for i,r in rows.items() if r['medium']==medium)
        pairs=reciprocal(roots,families,descriptions)
        keys={p:pair_key(p,descriptions,families) for p in pairs}
        counts=Counter(pairs=len(pairs))
        for a,b in pairs:
            for t,d in ((a,b),(b,a)):
                assert t!=d and families[t]!=families[d]
                if direct[d]>2.5:
                    continue
                counts['lowDonorCandidates']+=1
                raw=display(utility(direct[d]))
                variants['donorOnly'][t]=min(variants['native'][t],raw)
                limit=validate(t,d,pairs,direct,keys)
                if limit is not None:
                    counts['admitted']+=1
                    variants['validated'][t]=min(variants['native'][t],max(raw,limit))
        coverage[medium]=counts
    # Follow-up specified after observing the unguarded peer errors. Cancel only when
    # vote-count-shrunk reception exceeds the untouched personal estimate. Missing votes
    # leave the original peer proposal intact. Compare the two pre-existing direct blends.
    veto={}
    for i,r in rows.items():
        personal,peer=variants['native'][i],variants['donorOnly'][i]
        votes=r['votes']
        public=50+(utility(r['audience']/2)-50)*votes/(votes+50) if votes and r['audience'] is not None else None
        veto[i]=personal if public is not None and public>personal else peer
    variants['donorWithPublicVeto']=veto
    for w in (20,40):
        variants[f'donorThenBlend{w}']={
            i:blend(dict(r,peer=variants['donorOnly'][i]),w,'peer') for i,r in rows.items()}
    results={}
    for name,pred in variants.items():
        obs=[(r,pred[i],r['native']) for i,r in rows.items()]
        result=compare(obs)
        result['fourPlusNewRed']=sum(s<50<=b and r['stars']>=4 for r,s,b in obs)
        result['middleNewRed']=sum(s<50<=b and 2.5<r['stars']<4 for r,s,b in obs)
        result['worstFavouriteChange']=min(s-b for r,s,b in obs if r['stars']==5)
        result['favouriteScoreChanges']=sum(s!=b for r,s,b in obs if r['stars']==5)
        result['Farzar']=next(s for r,s,b in obs if r['title']=='Farzar')
        result['Rick and Morty']=next(s for r,s,b in obs if r['title']=='Rick and Morty')
        results[name]=result
    return {'coverage':coverage,'comparison':results}


if __name__=='__main__':
    print(json.dumps(run(*(json.loads(Path(p).read_bytes()) for p in sys.argv[1:])),indent=2))
