"""Can a personal pattern of disliking less-voted contemporaries predict another dislike?

Use vote counts from the frozen snapshot; only personal training ratings supply opinions.
Each unrelated comparable franchise contributes median votes and stars. Ties stay together.
"""
import argparse
from collections import Counter, defaultdict
from math import ceil
from pathlib import Path
from statistics import median
import json

from retained_panels import retained_panels
from team_audience import display, read, utility


def metadata(args):
    votes = {r['id']: r['votes'] for r in read(args.team)}
    facts = {}
    for panel in read(args.capture):
        f = {r['work']['id']:r['features'] for r in panel['history']}
        f.update({r['id']:r['features'] for r in panel['catalogue']})
        for i, v in f.items():
            decade = {d['id'] for d in v.get('decades',[])}
            genre = {g['id'] for g in v.get('genres',[])}
            if i in votes and votes[i] and genre and len(decade) == 1:
                facts[i] = (decade.pop(), genre)
    return votes, facts


def compare(i, allowed, family, facts, votes, direct):
    if i not in facts:
        return {}
    decade, genre = facts[i]
    families = defaultdict(list)
    for j in allowed & facts.keys():
        other_decade, other_genre = facts[j]
        if other_decade == decade and 2*len(genre & other_genre) >= len(genre | other_genre):
            families[family[j]].append(j)
    dist = [(median(votes[j] for j in ids), median(direct[j]['stars'] for j in ids)) for ids in families.values()]
    assert i not in allowed and family[i] not in families
    if len(dist) < 6:
        return {}
    counts = sorted(n for n, _ in dist)
    q1, q3 = (counts[ceil(p*len(dist))-1] for p in (.25,.75))
    if q1 >= q3:
        return {}
    bottom = [s for n,s in dist if n <= q1]
    top = [s for n,s in dist if n >= q3]
    if min(len(bottom), len(top)) < 3:
        return {}
    low_votes = votes[i] <= q1
    outcomes = dict(eligible=True, bottomQuartile=low_votes)
    if low_votes:
        outcomes.update(bottomCount=len(bottom), topCount=len(top), bottomStars=median(bottom),
                        bottomDislikes=sum(s<=2.5 for s in bottom), topStars=median(top), targetVotes=votes[i],
                        bottomMaxVotes=q1, topMinVotes=q3)
        if 2*outcomes['bottomDislikes'] > len(bottom) and outcomes['topStars'] >= 4:
            outcomes['proposed'] = display(median(utility(s) for s in bottom))
            assert outcomes['proposed'] < 50
    return outcomes


def replay(args):
    direct, cohorts = retained_panels(args)
    votes, facts = metadata(args)
    family = {r.id: r.family for r in cohorts['full']}
    results = {}
    for split, rows in cohorts.items():
        cases, moves, existing = [], [], set()
        coverage = defaultdict(Counter)
        for r in rows:
            i, base = r.id, r.before
            if base < 50:
                if r.stars <= 2.5:
                    existing.add(i)
                continue
            eligible = {j for j in direct if r.eligible(j)}
            diag = compare(i, eligible, family, facts, votes, direct)
            cat = 'miss' if r.stars <= 2.5 else 'middle' if r.stars < 4 else 'liked'
            count = coverage[cat]
            count['all'] += 1
            count['eligible'] += bool(diag)
            count['bottomQuartile'] += bool(diag.get('bottomQuartile'))
            if diag.get('bottomQuartile'):
                count['majorityDislike'] += 2*diag['bottomDislikes'] > diag['bottomCount']
                record = dict(id=i,title=r.title,actual=r.stars,baseline=base,**diag)
                cases.append(record)
                if 'proposed' in diag:
                    moves.append(record)
        results[split] = dict(scored=len(rows), previousTrueReds=len(existing), coverage=coverage, changed=moves, bottomQuartile=cases)
    return results


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('capture','direct','graded','team','archived','movie','show','earlier','grouped','witness'):
        cli.add_argument(name,type=Path)
    print(json.dumps(replay(cli.parse_args()),indent=2))
