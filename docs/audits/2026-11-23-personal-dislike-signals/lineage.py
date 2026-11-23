"""Offline test of repeated personal errors across independent creative teams."""
import hashlib
import json
import math
import os
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from statistics import mean


def read(path):
    return json.loads(Path(path).read_bytes())


def utility(stars):
    if stars <= 3:
        return max(0, 20 * (stars - .5))
    return 50 + 30 * min(1, stars - 3) + 20 * max(0, stars - 4)


def authors(metadata, medium):
    leads = {'Director'} if medium == 'movie' else {'Creator', 'Showrunner'}
    writes = {'Writer', 'Screenplay', 'Teleplay', 'Head Writer'}
    credits = [(str(p['id']), p['role']) for p in metadata.get('credits') or []
               if str(p['id']).isdigit()]
    return ({k for k, role in credits if role in leads},
            {k for k, role in credits if role in leads | writes})


def overlap(a, b):
    return len(a & b) / len(a | b) if a or b else 0.


def graph(media, kind, family):
    auth = {i: authors(media[i], kind) if i in media else (set(), set()) for i in family}
    postings = defaultdict(set)
    for i, (_, team) in auth.items():
        for person in team:
            postings[person].add(i)
    match = {}
    for i, (leads, team) in auth.items():
        others = set().union(*(postings[p] for p in team))
        found = []
        for j in sorted(others):
            if family[i] == family[j]:
                continue
            shared = team & auth[j][1]
            has_lead = bool(leads & auth[j][0])
            similarity = (overlap(leads, auth[j][0]) if has_lead else 0.) + overlap(team, auth[j][1])
            found.append((j, (similarity / 2.)**2, has_lead and len(shared) >= 2))
        match[i] = found
    return match


def proposal(work, source, matches, family, dates, before=None):
    representatives = {}
    for j, weight, team in matches[work]:
        if j not in source or (before and dates[j]['at'][:10] >= before):
            continue
        fam = family[j]
        if fam not in representatives or weight > representatives[fam][0]:
            representatives[fam] = weight, [(j, team)]
        elif weight == representatives[fam][0]:
            representatives[fam][1].append((j, team))
    if not representatives:
        return 0., None, []
    nodes = list(representatives.values())
    mass = sum(w for w, _ in nodes)
    delta = sum(w * mean(source[j] for j, _ in v) for w, v in nodes) / max(1., mass)
    strength = max(w for w, _ in nodes)
    multiperson = any(team for w, value in nodes if w == strength for _, team in value)
    strongest = [j for w, value in nodes if w == strength for j, _ in value]
    return delta, ('team' if multiperson else 'other') + ('Down' if delta < 0 else 'Up'), strongest


def estimate(source, matches, family, dates, dated):
    outcomes = defaultdict(lambda: defaultdict(list))
    for i, error in source.items():
        delta, group, _ = proposal(i, source, matches, family, dates, dates[i]['at'][:10] if dated else None)
        if delta:
            outcomes[group][family[i]].append((delta, error))
    slopes = {}
    for group, examples in outcomes.items():
        if len(examples) < 8:
            continue
        xy = sum(mean(d * e for d, e in vals) for vals in examples.values())
        xx = sum(mean(d*d for d, _ in vals) for vals in examples.values())
        if 2 * xy > xx and xx > 0:
            slopes[group] = min(1., xy / xx) * len(examples) / (len(examples) + 4)
    return slopes


def display(value):
    return max(0, min(100, math.floor(value + .5)))


def metrics(rows, arm):
    tallies = Counter()
    by_group = defaultdict(list)
    lows, favs = [], []
    for r in rows:
        stars, baseline, score = r['stars'], r['base'], r[arm]
        assert score is not None
        by_group[r['group']].append((stars, score))
        tallies.update({'scored':1, 'donorCoverage':bool(r['strongest']), 'changed':baseline != score,
                        'multiTeam':(r['type'] or '').startswith('team')})
        if stars <= 2.5:
            lows.append(score - baseline)
            tallies.update({'dislikes':1, 'dislikesLower':score < baseline, 'dislikesHigher':score > baseline,
                            'dislikesRed':score < 50, 'dislikesWithDonor':bool(r['strongest'])})
        if stars >= 4:
            tallies.update({'liked':1,'likedRed':score < 50,'likedNewRed':score < 50 <= baseline})
        if stars == 5:
            favs.append(score - baseline)
            tallies.update({'five':1, 'fiveLower':score < baseline, 'fiveHigher':score > baseline,
                            'fiveLostGreen':score < 80 <= baseline, 'fiveGainedGreen':baseline < 80 <= score})
    pairs = wins = 0
    for by_fold in by_group.values():
        for (a,x),(b,y) in combinations(by_fold,2):
            if a == b:
                continue
            pairs += 1
            wins += .5 if x == y else int((a-b)*(x-y)>0)
    return dict(counts=tallies, meanDislikeShift=round(mean(lows),3) if lows else None,
                meanFiveShift=round(mean(favs),3) if favs else None,
                withinFoldOrder=round(wins/pairs,5) if pairs else None)


def run(metadata, dates, native, inner):
    media = {v['id']:v for v in metadata}
    votes = {v['id']:v for v in dates}
    receipt = {(r['medium'],r['split'],r['budget'],r['group']):r['points'] for r in inner}
    output, private = [], []
    for kind in ('movie','show'):
        panels = [r for r in native['runs'] if r['medium']==kind]
        whole = next(r for r in panels if r['budget']=='all' and r['split']=='work')
        family = {v['id']:v['cluster'] for v in whole['targets']}
        matches = graph(media,kind,family)
        for panel in panels:
            groups = defaultdict(list)
            for t in panel['targets']:
                groups[t['group']].append(t)
            records = []
            for group, held in groups.items():
                points = receipt[kind,panel['split'],panel['budget'],group]
                dated = panel['split']=='rolling-day'
                source = {p['id']:utility(votes[p['id']]['stars'])-p['base'] for p in points}
                assert len(source)==len(points)
                assert not source.keys() & {t['id'] for t in held}
                if dated:
                    assert all(votes[i]['at'][:10]<group for i in source)
                slopes = estimate(source,matches,family,votes,dated)
                for t in held:
                    baseline = t['scores']['calibrated']
                    if baseline is None:
                        continue
                    delta, cell, donors = proposal(t['id'],source,matches,family,votes)
                    assert all(family[i]!=family[t['id']] for i in donors)
                    slope = slopes.get(cell,0.)
                    r = dict(id=t['id'],title=media.get(t['id'],{}).get('title'),group=group,stars=t['stars'],
                             base=baseline,raw=display(baseline+delta),adjusted=display(baseline+slope*delta),
                             type=cell,strongest=[dict(id=i,stars=votes[i]['stars'],error=source[i])
                                                  for i in donors],coefficient=round(slope,4))
                    records.append(r)
                    if donors:
                        private.append(dict(medium=kind,split=panel['split'],budget=panel['budget'],**r))
            output.append(dict(medium=kind,split=panel['split'],budget=panel['budget'],
                               arms={arm:metrics(records,arm) for arm in ('base','raw','adjusted')}))
    return output, private


if __name__ == '__main__':
    if len(sys.argv)!=5:
        raise SystemExit('Usage: lineage.py SUPPLIED_CREDIT_METADATA VERIFIED_DATES GRADED INNER_PERSONAL_SCORES')
    metadata, dates, graded, inner = map(read,sys.argv[1:])
    for idx, key in [(1,'metadata'),(2,'dates')]:
        assert hashlib.sha256(Path(sys.argv[idx]).read_bytes()).hexdigest()==graded['manifest'][key]
    result, details = run(metadata,dates,graded,inner)
    if path := os.environ.get('COAST_PERSONAL_LINEAGE_PRIVATE'):
        with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as file:
            json.dump(details,file,separators=(',',':'))
    print(json.dumps(result,separators=(',',':')))
