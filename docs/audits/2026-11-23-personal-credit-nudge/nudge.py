"""Offline test of a bounded, personal creator and executive producer adjustment."""
import argparse
import hashlib
import importlib.util
import json
import os
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from statistics import mean, median

PREVIOUS = Path(__file__).resolve().parent.parent / '2026-11-23-personal-dislike-signals'
sys.path.insert(0, str(PREVIOUS))
import lineage

spec = importlib.util.spec_from_file_location('native_masks', PREVIOUS / 'lineage-exact.py')
native_masks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native_masks)
ARMS = ('lead', 'exec', 'combined')


def roles(item, kind):
    leads = {'Director'} if kind == 'movie' else {'Creator', 'Showrunner'}
    result = {}
    for credit in item.get('credits') or []:
        person = str(credit['id'])
        if not person.isdigit():
            continue
        if credit['role'] in leads:
            result[person] = 'lead'
        elif credit['role'] == 'Executive Producer':
            result.setdefault(person, 'exec')
    return result


def graph(canonical, media, genres, kind, donor_media=None):
    """Build possible pairs from metadata without seeing any holdout ratings."""
    postings = defaultdict(list)
    donor_media = media if donor_media is None else donor_media
    for donor in sorted(canonical):
        for person, role in roles(donor_media.get(donor, {}), kind).items():
            postings[person].append((donor, role))
    result = {}
    for work, target in canonical.items():
        edges = []
        for person, target_role in sorted(roles(media.get(work, {}), kind).items()):
            for donor, donor_role in postings[person]:
                family = canonical[donor]['cluster']
                if family == target['cluster']:
                    continue
                similarity = lineage.overlap(genres.get(work, set()), genres.get(donor, set()))
                confidence = .25 if target_role != donor_role else (1 if target_role == 'lead' else .5)
                edges.append((person, target_role, donor_role, donor, family,
                              confidence * (.25 + .75 * similarity)))
        result[work] = edges
    return result


def proposal(work, known, graph, arm='combined', *, trace=False):
    assert arm in ARMS
    by_person = defaultdict(lambda: defaultdict(list))
    target_roles = {}
    for person, target_role, donor_role, donor, family, weight in graph[work]:
        if donor not in known or (arm != 'combined' and (target_role != arm or donor_role != arm)):
            continue
        voter = max(-1., min(1., (known[donor] - 3) / 2))
        by_person[person][family].append((weight, voter, donor, donor_role))
        target_roles[person] = target_role
    if not by_person:
        return 0., {'covered': False, 'people': []}

    deltas = {}
    family_people = defaultdict(dict)
    people = {}
    for person, families in by_person.items():
        mass = signed = absolute = 0.
        role = target_roles[person]
        if trace:
            people[person] = {'id': person, 'role': role, 'donors': []}
        for family, tuples in families.items():
            weight = max(w for w, *_ in tuples)
            vote = sum(w*v for w,v,*_ in tuples) / sum(w for w,*_ in tuples)
            mass += weight
            signed += weight * vote
            absolute += weight * abs(vote)
            family_people[family][person] = weight
            if trace:
                for w, v, donor, donor_role in tuples:
                    people[person]['donors'].append(dict(id=donor, family=family, role=donor_role, weight=w,
                                                         stars=known[donor], vote=v))
        cap = 8. if role == 'lead' else 4.
        deltas[person] = cap * signed / (3 + mass) * abs(signed) / absolute if absolute else 0.

    weights = defaultdict(float)
    role_mass = Counter()
    for members in family_people.values():
        factor = max(members.values()) / sum(members.values())
        for person, weight in members.items():
            weights[person] += weight * factor
            role_mass[target_roles[person]] += weight * factor
    exec_share = role_mass['exec'] / sum(role_mass.values())
    if role_mass['lead']:
        exec_share = min(1/3, exec_share)
    total = 0.
    for person, weight in weights.items():
        role = target_roles[person]
        share = (exec_share if role == 'exec' else 1 - exec_share) * weight / role_mass[role]
        total += deltas[person] * share
        if trace:
            people[person].update(delta=deltas[person], share=share)
    return total, {'covered': True, 'people': list(people.values())}


def verify_rule():
    def score(ratings, roles=None):
        pairs = [('p', 'lead', 'lead', str(i), str(i), 1) for i in range(len(ratings))]
        return proposal('t', dict(zip(map(str,range(len(ratings))), ratings)), {'t': roles or pairs})[0]
    assert score([4,2]) == score([3]) == 0
    assert 0 < score([5]) == -score([1]) < score([5,5]) < 8
    assert score([5]) == 2 and score([1,1]) < -2
    dup = [('p','lead','lead','0','f',1),('p','lead','lead','1','f',1),
           ('q','lead','lead','0','f',1),('q','lead','lead','1','f',1)]
    assert score([5,5],dup) == 2
    assert roles({'credits':[{'id':'1','role':k} for k in ['Executive Producer','Creator','Executive Producer']]
                             +[{'id':'2','role':'Co-Executive Producer'},{'id':'3','role':'Actor'}]}, 'show') == {'1':'lead'}


def order(rows, arm):
    groups = defaultdict(list)
    for r in rows:
        groups[r['group']].append(r)
    comparable = [0,0]
    wins = [0,0]
    for group in groups.values():
        for a,b in combinations(group,2):
            rank = a['stars'] - b['stars']
            if rank == 0:
                continue
            diff = rank * (a[arm] - b[arm])
            earned = .5 if diff == 0 else float(diff > 0)
            comparable[0] += 1
            wins[0] += earned
            if min(a['stars'],b['stars']) <= 2.5 and max(a['stars'],b['stars']) >= 4:
                comparable[1] += 1
                wins[1] += earned
    return dict(zip(('withinFold','likeOverDislike'),
                    [dict(wins=w,pairs=n,accuracy=w/n if n else None) for w,n in zip(wins,comparable)]))


def summarize(rows, arm, baseline):
    sets = dict(all=rows, dislike=[r for r in rows if r['stars']<=2.5],
                liked=[r for r in rows if r['stars']>=4], five=[r for r in rows if r['stars']==5])
    out = {}
    for k, subset in sets.items():
        deltas = [r[arm] - r[baseline] for r in subset]
        out[k] = dict(n=len(subset), down=sum(d<0 for d in deltas), up=sum(d>0 for d in deltas),
                      unchanged=deltas.count(0), meanShift=mean(deltas) if deltas else None,
                      meanScore=mean(r[arm] for r in subset) if subset else None,
                      mae=mean(abs(r[arm] - lineage.utility(r['stars'])) for r in subset) if subset else None,
                      green=sum(r[arm]>=80 for r in subset),
                      lostGreen=sum(r[arm]<80<=r[baseline] for r in subset),
                      newGreen=sum(r[baseline]<80<=r[arm] for r in subset),
                      red=sum(r[arm]<50 for r in subset), newRed=sum(r[arm]<50<=r[baseline] for r in subset),
                      lostRed=sum(r[baseline]<50<=r[arm] for r in subset),
                      coverage=sum(r.get(arm+'Coverage',False) for r in subset))
    out.update(order(rows,arm))
    return out


def record_patterns(cells, evidence):
    """Describe the signed personal opinions feeding a credited person on this target."""
    for person in evidence['people']:
        by_family = defaultdict(list)
        for d in person['donors']:
            by_family[d['family']].append((d['weight'], d['vote']))
        votes = [sum(w*v for w,v in pairs) / sum(w for w,_ in pairs) for pairs in by_family.values()]
        lo, hi = min(votes), max(votes)
        direction = 'mixed' if lo < 0 < hi else 'positive' if hi > 0 else 'negative' if lo < 0 else 'neutral'
        count = '3+' if len(votes) >= 3 else str(len(votes))
        cells[(count, direction)].append(person['delta'])


def summarize_patterns(cells):
    return [dict(families=n, direction=d, cases=len(values), median=median(values),
                 smallest=min(values), largest=max(values)) for (n,d),values in sorted(cells.items())]


def run(capture, metadata, verified, graded):
    media = {r['id']:r for r in metadata}
    dates = {r['id']:r for r in verified}
    genres = {r['work']['id']:{g['id'] for g in r['features'].get('genres',[])}
              for medium in capture for r in medium['history']}
    ledger, results = [], []
    for kind in ('movie','show'):
        panels = [p for p in graded['runs'] if p['medium']==kind]
        whole = next(p for p in panels if p['split']=='work' and p['budget']=='all')
        canonical = {t['id']:t for t in whole['targets']}
        matches = graph(canonical,media,genres,kind)
        harmon = {i for i in canonical if '57194' in roles(media.get(i,{}),kind)}
        for panel in panels:
            full_work = panel['split'] == 'work' and panel['budget'] == 'all'
            patterns = {arm:defaultdict(list) for arm in ARMS}
            groups = defaultdict(list)
            for t in panel['targets']:
                groups[t['group']].append(t)
            records = []
            for group, targets in groups.items():
                known = native_masks.allowed_ratings(canonical,dates,targets,group,panel['split'],panel['budget'])
                known = {i:s for i,s in known.items() if i in dates and s == dates[i]['stars']}
                assert not known.keys() & {t['id'] for t in targets}
                if panel['split']=='rolling-day':
                    assert all(dates[i]['at'][:10]<group for i in known)
                for t in targets:
                    i, base = t['id'], t['scores']['calibrated']
                    if base is None:
                        continue
                    assert panel['split'] == 'rolling-day' or t['cluster'] == canonical[i]['cluster']
                    row = dict(id=i,title=media.get(i,{}).get('title'),stars=t['stars'],base=base,
                               group=group,medium=kind,split=panel['split'],budget=panel['budget'])
                    for arm in ARMS:
                        detail = arm == 'combined' and i in harmon and panel['split'] in ('work','rolling-day') and panel['budget'] in ('all','dated ratings only')
                        d, evidence = proposal(i,known,matches,arm,trace=detail or full_work)
                        if full_work:
                            record_patterns(patterns[arm], evidence)
                        row[arm+'Delta'] = d
                        row[arm+'Coverage'] = evidence['covered']
                        row[arm] = lineage.display(base+d)
                        assert abs(d) < 8 and (bool(known) or d == 0)
                        if detail:
                            row['evidence'] = evidence
                    records.append(row)
            ledger.extend(records)
            result = {key:panel[key] for key in ('medium','split','budget')}
            result['arms'] = {arm:summarize(records,arm,'base') for arm in ('base', *ARMS)}
            result['execIncrementOverLead'] = summarize(records,'combined','lead')
            if full_work:
                result['personalPatterns'] = {arm:summarize_patterns(patterns[arm]) for arm in ARMS}
            results.append(result)
    return results, ledger


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    for key in ('capture','metadata','dates','graded','private_ledger'):
        ap.add_argument(key)
    args = ap.parse_args()
    verify_rule()
    native = lineage.read(args.graded)
    for key in ('capture','metadata','dates'):
        assert hashlib.sha256(Path(getattr(args,key)).read_bytes()).hexdigest() == native['manifest'][key]
    result, rows = run(lineage.read(args.capture),lineage.read(args.metadata),lineage.read(args.dates),native)
    assert len(result)==32 and len(rows)==13477
    with os.fdopen(os.open(args.private_ledger,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'w') as f:
        json.dump(rows,f,separators=(',',':'),allow_nan=False)
    print(json.dumps(result,separators=(',',':'),allow_nan=False))
