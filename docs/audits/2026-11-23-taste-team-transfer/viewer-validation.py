"""Admit an exact-team penalty only after it demonstrated value in this viewer's prior history."""
import json
import os
import sys
from collections import Counter, defaultdict
from itertools import groupby
from pathlib import Path


def prior_outcomes(train, movies):
    seen_by_team = defaultdict(list)
    evidence = defaultdict(list)
    n = 0
    for day, workday in groupby(sorted(train), key=lambda row: row[0]):
        batch = list(workday)
        for _, i, stars in batch:
            m = movies[i]
            if n < 25 or not m['eligible']:
                continue
            team = tuple(m['crew'])
            others = [(j, value) for j, value in seen_by_team[team] if movies[j]['family'] != m['family']]
            if not others or any(value > 2.5 for j, value in others):
                continue
            genres = set(m['kind'])
            for j, _ in others:
                donor = movies[j]
                if not donor['eligible'] or donor['coast'] != m['coast']:
                    continue
                other = set(donor['kind'])
                if 2 * len(genres & other) >= len(genres | other):
                    evidence[team].append(stars)
                    break
        for _, i, stars in batch:
            if movies[i]['crew']:
                seen_by_team[tuple(movies[i]['crew'])].append((i, stars))
        n += len(batch)
    return evidence


def run(data, private_directory):
    stats = Counter()
    outcomes = {n: Counter() for n in (1, 2)}
    admits = defaultdict(list)
    movies = data['movies']
    for user in data['users']:
        assert all(d < user['cutoff'] for d, _, _ in user['train'])
        evidence = prior_outcomes(user['train'], movies)
        allowed = defaultdict(set)
        for _, i, stars in user['held']:
            stats['originalOpportunities'] += 1
            team = tuple(movies[i]['crew'])
            other = [s for t, s in evidence.items() if t != team]
            all_stars = [s for vals in other for s in vals]
            stats['atLeastOneEarlierDifferentTeam'] += bool(other)
            successes = sum(max(vals) <= 2.5 for vals in other)
            if (not successes or max(all_stars) >= 4
                    or 2 * sum(s <= 2.5 for s in all_stars) < len(all_stars)):
                continue
            for n in (1, 2):
                if successes >= n:
                    allowed[n].add(i)
                    outcomes[n].update(cases=1, dislikes=stars <= 2.5, middling=2.5 < stars < 4,
                                       liked=stars >= 4, fives=stars == 5)
        for n, ids in allowed.items():
            outcomes[n]['viewers'] += 1
            admits[n].append({**user, 'held': [r for r in user['held'] if r[1] in ids],
                              'donors': {i: d for i, d in user['donors'].items() if i in ids}})
    if private_directory:
        for n in (1, 2):
            kept = {r[1] for u in admits[n] for r in u['train'] + u['held']}
            pack = dict(movies={i: movies[i] for i in kept}, users=admits[n], summary=outcomes[n])
            path = Path(private_directory) / f'trust-{n}.json'
            with os.fdopen(os.open(path, os.O_EXCL | os.O_CREAT | os.O_WRONLY, 0o600), 'w') as f:
                json.dump(pack, f, separators=(',', ':'))
    return dict(coverage=stats, requiredOtherSuccessfulTeams=outcomes)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: viewer-validation.py PRIVATE_PREPARED_SAMPLE')
    with open(sys.argv[1]) as f:
        data = json.load(f)
    print(json.dumps(run(data, os.environ.get('COAST_TRUST_OUTPUT_DIRECTORY')), indent=2))
