"""Inspect evidence on other titles for the 40 pre-existing dislike/favourite pairs."""
import importlib.util
import json
import os
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_bytes())


spec = importlib.util.spec_from_file_location('families', Path(__file__).resolve().parents[1] /
    '2026-11-23-taste-v2-counterevidence' / 'replay.py')
families = importlib.util.module_from_spec(spec)
spec.loader.exec_module(families)
dimensions = ('genres', 'themes', 'tags', 'creators', 'writers', 'directors', 'cast', 'networks', 'studios')


def traits(row, meta):
    result = {(d, t['id']): t['name'] for d in dimensions for t in row.get(d, [])}
    for t in meta.get('credits') or []:
        if t['role'] == 'Creator' and str(t['id']).isdigit():
            result['creators', 'tmdb:' + str(t['id'])] = t['name']
    return result


def scan(a, b, pool, features, clusters, names):
    exclusive = features[a].keys() - features[b].keys()
    negative = []
    positive = []
    for key in sorted(exclusive):
        if key[0] == 'genres':
            continue
        matches = [(p['id'], p['stars']) for p in pool if key in features[p['id']]]
        grouped = defaultdict(list)
        for work, stars in matches:
            grouped[clusters[work]].append(stars)
        values = [statistics.mean(g) for g in grouped.values()]
        low = sum(x <= 2.5 for x in values)
        high = sum(x >= 4 for x in values)
        if low >= 2 and low * 2 > len(values):
            negative.append((key, low, high, len(values), matches))
        elif high >= 2 and not low and high * 2 > len(values):
            positive.append((key, low, high, len(values), matches))
    def evidence(v):
        key, low, high, num, matches = v
        return dict(dimension=key[0], trait=features[a][key], low=low, high=high, families=num,
                    works=sorted((names[w], s) for w, s in matches))
    return {'negative': list(map(evidence, negative)), 'positive': list(map(evidence, positive))}


def analyse(capture, meta, dated, native, explanations):
    all_meta = {r['id']:r for r in meta}
    names = {i:r['title'] for i, r in all_meta.items()}
    verified = {r['id']:r['stars'] for r in dated}
    output, named = {}, []
    for data in capture:
        medium = data['medium']
        rows = {r['work']['id']:r for r in data['history']}
        clusters = families.family_keys(data['history'])
        native_rows = next(r['targets'] for r in native['runs'] if r['medium'] == medium and
                           r['split'] == 'work' and r['budget'] == 'all')
        presentation = {i:r['features'] for i,r in rows.items()}
        presentation.update({r['id']:r['features'] for r in data['catalogue']})
        features = {i:traits(presentation[i],all_meta.get(i,{})) for i in rows}
        counts = Counter()
        for p in explanations:
            if p['medium'] != medium:
                continue
            def resolve(title, stars, score):
                hits = [t['id'] for t in native_rows if t['group'] == str(p['fold']) and
                        t['stars'] == stars and names[t['id']] == title and t['scores']['calibrated'] == score]
                assert len(hits) == 1
                return hits[0]
            q = p['comparison']
            a = resolve(p['title'],p['stars'],p['score'])
            b = resolve(q['title'],5,q['score'])
            training = [t for t in native_rows if t['group'] != str(p['fold']) and verified.get(t['id']) == t['stars']]
            peers = [(names[t['id']],t['stars']) for t in training if clusters[t['id']] == clusters[a]]
            pool = [t for t in training if clusters[t['id']] not in {clusters[a],clusters[b]}]
            assert a != b and not ({a,b} & {t['id'] for t in pool})
            left = scan(a,b,pool,features,clusters,names)
            right = scan(b,a,pool,features,clusters,names)
            ln,rn = left['negative'],right['negative']
            counts['pairs'] += 1
            counts['dislikeHasNegative'] += bool(ln)
            counts['favouriteHasNegative'] += bool(rn)
            counts['dislikeOnlyHasNegative'] += bool(ln) and not rn
            counts['bothHaveNegative'] += bool(ln and rn)
            counts['dislikeHasPositive'] += bool(left['positive'])
            counts['favouriteHasPositive'] += bool(right['positive'])
            counts['dislikeOnlyNegativeFavouritePositive'] += bool(ln and right['positive']) and not rn
            counts['dislikeHasOtherRatedInFranchise'] += bool(peers)
            counts['hasAnySharedSpecificTrait'] += any(k[0] != 'genres' for k in features[a].keys() & features[b].keys())
            for dim in dimensions:
                counts['dislikeNegative_' + dim] += any(x['dimension'] == dim for x in ln)
                counts['favouriteNegative_' + dim] += any(x['dimension'] == dim for x in rn)
            named.append(dict(title=names[a],favourite=names[b],shared=q['shared'],dislikeEvidence=left,
                              favouriteEvidence=right,otherFranchiseRatings=peers))
        for k in ('completion','repeated','deliberateReturn','dropped','explicit','childRatings'):
            for label,fn in [('Dislikes',lambda t:t['stars']<=2.5),('FiveStars',lambda t:t['stars']==5)]:
                counts['own'+k+label]=sum(bool(rows[t['id']]['work'].get(k)) for t in native_rows if fn(t))
        output[medium] = dict(counts)
    assert len(named) == 40
    return output,named


if __name__ == '__main__':
    if len(sys.argv) != 6:
        raise SystemExit('Usage: pairs.py CAPTURE METADATA VERIFIED_DATES GRADED PRIVATE_BREAKDOWNS_JSONL')
    audits = [json.loads(line) for line in Path(sys.argv[5]).read_text().splitlines() if line]
    out, names = analyse(*(read(p) for p in sys.argv[1:5]),audits)
    print(json.dumps(out, indent=2))
    if file := os.environ.get('COAST_PRIVATE_MATCHED_PAIRS'):
        with os.fdopen(os.open(file, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600),'w') as f:
            json.dump(names,f)
