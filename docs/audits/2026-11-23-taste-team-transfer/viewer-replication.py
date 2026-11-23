"""Stream the other MovieLens 25M viewers for the frozen two-successful-team gate."""
import csv
import hashlib
import importlib.util
import io
import json
import os
import sys
import zipfile
from collections import Counter, defaultdict
from itertools import groupby
from pathlib import Path

spec = importlib.util.spec_from_file_location('viewer_validation', Path(__file__).with_name('viewer-validation.py'))
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


def ambiguous(links, identities):
    imdb = Counter(r['imdbId'] for r in links if r['imdbId'])
    tmdb = Counter(r['tmdbId'] for r in links if r['tmdbId'])
    ids = {(v['provider'], v['key']): v['id'] for v in identities if v['kind'] == 'movie'}
    by_coast = defaultdict(list)
    omitted = set()
    for r in links:
        i = r['movieId']
        if imdb[r['imdbId']] > 1 or tmdb[r['tmdbId']] > 1:
            omitted.add(i.encode())
        known = {ids[k] for k in (('imdb', 'tt' + r['imdbId']), ('tmdb', r['tmdbId'])) if k in ids}
        if len(known) == 1:
            by_coast[next(iter(known))].append(i)
    omitted.update(i.encode() for works in by_coast.values() if len(works) > 1 for i in works)
    return omitted


def evaluate_user(uid, ordered, movies, state, admitted):
    cutoff = ordered[len(ordered)*4//5][0]
    train = [v for v in ordered if v[0] < cutoff]
    if len(train) < 25:
        return
    held = ordered[len(train):]
    state.update(eligibleViewers=1, heldRatings=len(held))
    history = defaultdict(list)
    for _, i, stars in train:
        if movies[i]['crew']:
            history[tuple(movies[i]['crew'])].append((i, stars))
    evidence = None
    keep, donors = [], {}
    for day, i, stars in held:
        m = movies[i]
        if not m['eligible']:
            continue
        team = tuple(m['crew'])
        earlier = [(j, s) for j, s in history.get(team, ()) if movies[j]['family'] != m['family']]
        if not earlier or any(s > 2.5 for _, s in earlier):
            continue
        genres = set(m['kind'])
        matches = defaultdict(list)
        for j, _ in earlier:
            v = movies[j]
            if not v['eligible'] or v['coast'] != m['coast']:
                continue
            other = set(v['kind'])
            if 2 * len(genres & other) >= len(genres | other):
                matches[v['family']].append(j)
        if not matches:
            continue
        state['originalOpportunities'] += 1
        if evidence is None:
            evidence = validation.prior_outcomes(train, movies)
        groups = [values for t, values in evidence.items() if t != team]
        state['earlierDifferentTeam'] += bool(groups)
        if sum(max(vals) <= 2.5 for vals in groups) < 2:
            continue
        values = [s for g in groups for s in g]
        if max(values) >= 4 or 2*sum(s <= 2.5 for s in values) < len(values):
            continue
        donors[i] = dict(matches)
        keep.append((day, i, stars))
        state.update(cases=1, dislikes=stars <= 2.5, liked=stars >= 4, middling=2.5 < stars < 4, fives=stars == 5)
    if keep:
        state['participatingViewers'] += 1
        if admitted is not None:
            admitted.append(dict(id=uid, cutoff=cutoff, train=train, held=keep, donors=donors))


def run(archive, identities, movies, private_path):
    states = defaultdict(Counter)
    admitted = []
    with zipfile.ZipFile(archive) as z:
        with z.open('ml-25m/links.csv') as f:
            omit = ambiguous(list(csv.DictReader(io.TextIOWrapper(f))), identities)
        with z.open('ml-25m/ratings.csv') as f:
            next(f)
            last_uid = 0
            for user, group in groupby(f, lambda line: line.partition(b',')[0]):
                assert last_uid < int(user)
                last_uid = int(user)
                shard = hashlib.sha256(b'coast-team-external-25m:' + user).digest()[0] % 16
                bucket = str(shard) if shard <= 1 else 'untouched'
                rows = []
                for line in group:
                    _, movie, stars, stamp = line.rstrip().split(b',')
                    if movie not in omit:
                        rows.append((int(stamp)//86400, movie.decode(), float(stars)))
                if rows:
                    evaluate_user(user.decode(), sorted(rows), movies, states[bucket],
                                  admitted if bucket == 'untouched' else None)
    kept = {i for u in admitted for _, i, _ in u['train'] + u['held']}
    private = dict(movies={i: movies[i] for i in kept}, summary=states['untouched'], users=admitted)
    with os.fdopen(os.open(private_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(private, f, separators=(',', ':'))
    return states


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('Usage: viewer-replication.py ML_25M_ZIP ID_CROSSWALK ORIGINAL_PREPARED_SAMPLE NEW_PRIVATE_OUTPUT')
    with open(sys.argv[2]) as f: identities = json.load(f)
    with open(sys.argv[3]) as f: movies = json.load(f)['movies']
    print(json.dumps(run(sys.argv[1], identities, movies, sys.argv[4]), indent=2))
