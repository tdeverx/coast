"""Count chronological personal preference transfers on externally rated, verified series."""
import csv
import io
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from itertools import groupby
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '2026-11-23-personal-dislike-signals'))
import lineage


def crosswalk(identifiers):
    seen = defaultdict(set)
    for row in identifiers:
        if row['provider'] == 'imdb' and re.fullmatch(r'tt\d+', row['key']):
            seen[row['key']].add((row['kind'], row['id']))
    return {k: next(iter(v))[1] for k, v in seen.items() if len(v) == 1 and next(iter(v))[0] == 'show'}


def descriptor_map(capture, metadata):
    out = {}
    media = {m['id']: m for m in metadata if m['kind'] == 'show'}
    data = next(d for d in capture if d['medium'] == 'show')
    for r in data['history'] + data['catalogue']:
        i = r['id'] if 'id' in r else r['work']['id']
        item = media.get(i, {})
        f = r['features']
        genres = {v['id'] for v in f.get('genres', [])}
        crew = frozenset(lineage.authors(item, 'show')[0])
        if genres and crew:
            out[i] = (crew, genres, {('franchise', v['id']) for v in f.get('franchises', [])}
                      | {('collection', s) for s in r.get('collections', [])},
                      re.sub(r'[^\w]', '', item['title'].casefold()))
    return out


def analyse(archive, verified, descriptions):
    titles = {}
    matched = set()
    with zipfile.ZipFile(archive) as z:
        def name(suffix):
            return next(n for n in z.namelist() if n.endswith('/' + suffix))

        with z.open(name('links.csv')) as f:
            for row in csv.DictReader(io.TextIOWrapper(f)):
                work = verified.get('tt' + row['imdbId'])
                if work:
                    matched.add(work)
                    titles[row['movieId']] = work
        works = set(titles.values()) & descriptions.keys()
        def independent(i, j):
            return (i != j and descriptions[i][3] != descriptions[j][3]
                    and not descriptions[i][2] & descriptions[j][2])
        def similar(i, j):
            a, b = descriptions[i], descriptions[j]
            return a[0] == b[0] and independent(i, j) and lineage.overlap(a[1], b[1]) >= .5

        pairs = [(i, j) for i in sorted(works) for j in works if i < j and similar(i, j)]
        by_user = defaultdict(dict)
        if pairs:
            with z.open(name('ratings.csv')) as f:
                next(f)
                ids = {k.encode(): i for k, i in titles.items() if i in works}
                for line in f:
                    user, key, stars, stamp = line.rstrip().split(b',')
                    i = ids.get(key)
                    if i:
                        prior = by_user[user].get(i)
                        value = (int(stamp), float(stars))
                        if prior is None or value[0] < prior[0]:
                            by_user[user][i] = value
    counts = {n: {sign: Counter() for sign in ('negative', 'positive')} for n in (1, 2)}
    users = defaultdict(set)
    teams = defaultdict(set)
    for user, records in by_user.items():
        prior = defaultdict(list)
        ordered = sorted((stamp // 86400, i, s) for i, (stamp, s) in records.items())
        for _, day in groupby(ordered, key=lambda row: row[0]):
            batch = list(day)
            for _, i, s in batch:
                team = descriptions[i][0]
                earlier = [(j, v) for j, v in prior[team] if independent(i, j)]
                donors = [j for j, _ in earlier if similar(i, j)]
                if not donors:
                    continue
                sign = ('negative' if all(v <= 2.5 for _, v in earlier) else
                        'positive' if all(v >= 4.5 for _, v in earlier) else None)
                if not sign:
                    continue
                has_two = any(independent(j, k) for j in donors for k in donors if j < k)
                for needed in ((1, 2) if has_two else (1,)):
                    count = counts[needed][sign]
                    count['cases'] += 1
                    count['actuallyDisliked'] += s <= 2.5
                    count['actuallyMiddling'] += 2.5 < s < 4
                    count['actuallyLiked'] += s >= 4
                    count['actuallyFive'] += s == 5
                    users[needed, sign].add(user)
                    teams[needed, sign].add(team)
            for _, i, s in batch:
                prior[descriptions[i][0]].append((i, s))
    for needed in counts:
        for sign in counts[needed]:
            counts[needed][sign].update(users=len(users[needed, sign]), teams=len(teams[needed, sign]))
    return dict(verifiedSeries=len(matched), scorableSeries=len(works), independentCompatiblePairs=len(pairs),
                compatibleTeams=len({descriptions[i][0] for i, _ in pairs}),
                result=counts)


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('Usage: external-tv.py MOVIELENS_ZIP ID_CROSSWALK SOLO_CAPTURE CREDIT_METADATA')
    ids, capture, metadata = map(lineage.read, sys.argv[2:])
    print(json.dumps(analyse(sys.argv[1], crosswalk(ids), descriptor_map(capture, metadata)), indent=2))
