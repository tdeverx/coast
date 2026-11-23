"""Prepare a private, stable-ID joined MovieLens replay. Inputs stay outside the repo."""
import csv
import gzip
import hashlib
import io
import json
import math
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict
from functools import cache


def read(path):
    with open(path) as file:
        return json.load(file)


def prepare(archive, imdb, crosswalk, capture, metadata):
    dataset = zipfile.ZipFile(archive)
    prefix, = [p[:-len('ratings.csv')] for p in dataset.namelist() if p.endswith('/ratings.csv')]
    shard = int(os.environ.get('COAST_MOVIELENS_SHARD', '0'))
    if shard not in (0, 1):
        raise ValueError('Expected a registered viewer sample.')
    def rows(path):
        return csv.DictReader(io.TextIOWrapper(dataset.open(prefix + path)))

    @cache
    def sampled(person):
        if prefix != 'ml-25m/':
            return True
        return hashlib.sha256(('coast-team-external-25m:' + person).encode()).digest()[0] % 16 == shard

    links = {r['movieId']: r for r in rows('links.csv')}
    imdb_counts = Counter(r['imdbId'] for r in links.values() if r['imdbId'])
    tmdb_counts = Counter(r['tmdbId'] for r in links.values() if r['tmdbId'])
    imdb_ids = {'tt' + r['imdbId']: i for i, r in links.items() if r['imdbId'] and imdb_counts[r['imdbId']] == 1}
    leads = {}
    with gzip.open(imdb, 'rb') as f:
        assert f.readline().strip() == b'tconst\tdirectors\twriters'
        keys = {k.encode(): v for k, v in imdb_ids.items()}
        for line in f:
            key = line.split(b'\t', 1)[0]
            if key in keys:
                people = line.split(b'\t')[1]
                if people != b'\\N':
                    leads[keys[key]] = tuple(sorted(set(people.decode().split(','))))
    external = {(r['provider'], r['key']): r['id'] for r in read(crosswalk) if r['kind'] == 'movie'}
    details = {r['id']: r for r in read(metadata) if r['kind'] == 'movie'}
    saved = next(r for r in read(capture) if r['medium'] == 'movie')
    features = {r['id']: r['features'] for r in saved['catalogue']}
    features.update({r['work']['id']: r['features'] for r in saved['history']})
    family_ids = {r['work']['id']: r.get('collections') or [] for r in saved['history']}
    parents = {}

    def root(key):
        while key in parents:
            key = parents[key]
        return key

    for key, f in features.items():
        for franchise in [s['id'] for s in f.get('franchises', [])] + ['coast:'+s for s in family_ids.get(key, [])]:
            x, y = root(key), root(franchise)
            if x != y:
                parents[max(x, y)] = min(x, y)
    movies = {}
    seen_coast = defaultdict(list)
    for r in rows('movies.csv'):
        i = r['movieId']
        link = links[i]
        ext = {external[k] for k in [('imdb', 'tt'+link['imdbId']), ('tmdb', link['tmdbId'])] if k in external}
        known = next(iter(ext)) if len(ext) == 1 else None
        if known:
            seen_coast[known].append(i)
        record = details.get(known, {})
        f = dict(features.get(known, {}))
        descriptive_genres = {s['id'] for s in f.get('genres', [])}
        coast_team = sorted({str(s['id']) for s in record.get('credits') or [] if s['role'] == 'Director'})
        imdb_team = leads.get(i, ())
        eligible = bool(record.get('has_saved_features') and descriptive_genres and coast_team
                        and len(coast_team) == len(imdb_team))
        if not descriptive_genres:
            f['genres'] = [{'id': v.lower().replace('sci-fi','science fiction'), 'name': v}
                           for v in r['genres'].split('|') if v != '(no genres listed)']
        year = re.search(r'\((\d{4})\)\s*$', r['title'])
        if not f.get('decades') and year:
            decade = str(int(year[1]) // 10 * 10) + 's'
            f['decades'] = [{'id': decade, 'name': decade}]
        f['directors'] = [{'id': 'imdb:'+v, 'name': v} for v in imdb_team]
        movies[i] = {'features': f, 'family': root(known) if known else 'movielens:'+i, 'eligible': eligible,
                     'crew': imdb_team, 'coast': coast_team, 'kind': sorted(descriptive_genres)}
    # Aliases to one canonical film would allow the same work on both sides.
    aliases = {i for ids in seen_coast.values() if len(ids) > 1 for i in ids}
    aliases.update(i for i, r in links.items() if imdb_counts[r['imdbId']] > 1 or tmdb_counts[r['tmdbId']] > 1)
    by_user = defaultdict(list)
    for r in rows('ratings.csv'):
        if sampled(r['userId']) and r['movieId'] not in aliases:
            by_user[r['userId']].append((int(r['timestamp']) // 86400, r['movieId'], float(r['rating'])))
    summary = Counter(archiveUsers=len(by_user), movies=len(movies), eligibleMovies=sum(r['eligible'] for r in movies.values()),
                      omittedAliasMovieIds=len(aliases))
    users = []
    for uid, rated in by_user.items():
        ordered = sorted(rated)
        cutoff = ordered[math.floor(.8 * len(ordered))][0]
        train = [r for r in ordered if r[0] < cutoff]
        held = [r for r in ordered if r[0] >= cutoff]
        if len(train) < 25:
            continue
        assert not ({i for _, i, _ in train} & {i for _, i, _ in held})
        summary.update(eligibleUsers=1, held=len(held), heldDislikes=sum(y <= 2.5 for _, _, y in held),
                       heldLiked=sum(y >= 4 for _, _, y in held), heldFives=sum(y == 5 for _, _, y in held))
        proposals = {}
        by_team = defaultdict(list)
        for _, j, s in train:
            if movies[j]['crew']:
                by_team[movies[j]['crew']].append((j, s))
        for _, i, y in held:
            target = movies[i]
            if not target['eligible']:
                continue
            summary['heldWithCrewAndFamily'] += 1
            crew = target['crew']
            others = [(j, s) for j, s in by_team.get(crew,[]) if movies[j]['family'] != target['family']]
            if not others:
                continue
            summary['heldWithSameDirector'] += 1
            if any(s > 2.5 for j, s in others):
                continue
            candidates = defaultdict(list)
            for j, _ in others:
                m = movies[j]
                if not m['eligible'] or m['coast'] != target['coast']:
                    continue
                a, b = set(m['kind']), set(target['kind'])
                if 2 * len(a & b) >= len(a | b):
                    candidates[m['family']].append(j)
            if candidates:
                proposals[i] = dict(candidates)
        if proposals:
            users.append(dict(id=uid, cutoff=cutoff, train=train, held=[r for r in held if r[1] in proposals], donors=proposals))
    return dict(movies=movies, users=users, summary=summary)


if __name__ == '__main__':
    if len(sys.argv) != 7:
        raise SystemExit('Usage: external.py MOVIELENS_ZIP IMDB_CREW_GZ CROSSWALK SOLO_CAPTURE METADATA PRIVATE_OUTPUT')
    result = prepare(*sys.argv[1:6])
    with os.fdopen(os.open(sys.argv[6], os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600), 'w') as f:
        json.dump(result, f, separators=(',',':'))
    print(json.dumps({**result['summary'], 'usersWithPotentialTransfer':len(result['users']),
                      'targetsWithPotentialTransfer':sum(len(u['held']) for u in result['users']),
                      'archiveSHA256':hashlib.file_digest(open(sys.argv[1],'rb'),'sha256').hexdigest()}))
