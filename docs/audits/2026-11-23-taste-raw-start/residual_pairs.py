"""Compare the remaining dislikes to frozen five-star pairs and test unscripted-format evidence offline."""
import argparse
from collections import Counter, defaultdict
import hashlib
import math
from pathlib import Path
from statistics import mean, median

from retained_panels import retained_panels
from team_audience import read, write_new


# Sorted IDs of the eight verified dislikes already below 50 in the retained experiment.
ORIGINAL_EIGHT = '7804e13081b791886cc8c2e4c03f937113d295f9a327be46ca8ad27e1a37b1a3'


def checksum(ids):
    return hashlib.sha256('\n'.join(sorted(ids)).encode()).hexdigest()


def matched(rows, direct, pairs):
    lookup = defaultdict(list)
    for row in rows:
        lookup[row.medium, row.title, row.stars].append(row)
    paired = {p['title']: p for p in pairs}
    low = [r for r in rows if r.stars <= 2.5]
    assert len(pairs) == len(paired) == len(low) == 40
    assert set(paired) == {r.title for r in low}
    assert checksum(r.id for r in low if r.before < 50) == ORIGINAL_EIGHT
    cases = []
    for row in low:
        if row.before < 50:
            continue
        pair = paired[row.title]
        fav, = lookup[row.medium, pair['favourite'], 5]
        left, right = pair['dislikeEvidence'], pair['favouriteEvidence']
        signals = []
        for trait in left['negative']:
            witnesses = []
            for name, stars in trait['works']:
                other, = lookup[row.medium, name, stars]
                assert row.eligible(other.id) and fav.eligible(other.id)
                witnesses.append(dict(id=other.id, title=name, stars=stars, day=direct[other.id]['at'][:10]))
            signals.append(dict(trait=trait['trait'], kind=trait['dimension'], witnesses=witnesses))
        cases.append(dict(id=row.id, title=row.title, medium=row.medium, score=row.before, stars=row.stars,
                          day=direct[row.id]['at'][:10], favourite=fav.title, favouriteId=fav.id,
                          favouriteScore=fav.before, favouriteNegatives=len(right['negative']),
                          positiveOnMiss=len(left['positive']), positiveOnFavourite=len(right['positive']),
                          shared=pair['shared'], negatives=signals))
    summary = dict(byMedium=dict(Counter(r['medium'] for r in cases)),
                   distinctFavourites=len({r['favouriteId'] for r in cases}), medianScore=median(r['score'] for r in cases),
                   lower=sum(r['score'] < r['favouriteScore'] for r in cases),
                   tied=sum(r['score'] == r['favouriteScore'] for r in cases),
                   higher=sum(r['score'] > r['favouriteScore'] for r in cases),
                   scores70plus=sum(r['score'] >= 70 for r in cases),
                   scoreBands=dict(Counter(r['score'] // 10 * 10 for r in cases)),
                   positiveOnMiss=sum(bool(r['positiveOnMiss']) for r in cases),
                   positiveOnFavourite=sum(bool(r['positiveOnFavourite']) for r in cases),
                   recurringNegativeOnMiss=sum(bool(r['negatives']) for r in cases),
                   recurringNegativeOnFavourite=sum(bool(r['favouriteNegatives']) for r in cases),
                   withEarlierDayNegative=sum(any(w['stars'] <= 2.5 and w['day'] < r['day']
                                                  for t in r['negatives'] for w in t['witnesses']) for r in cases))
    return cases, summary


def nearest_examples(rows, misses, features, metadata):
    """Search all other-family 4½–5-star and <=2½-star works for explanatory examples after grading."""
    weights = dict(genres=1, tags=2, themes=2, cast=1, directors=1, writers=1, creators=1, networks=.6, studios=.6)
    for medium in ('movie', 'show'):
        sample = [r for r in rows if r.medium == medium]
        traits, names = {}, {}
        for row in sample:
            keys = {(k, x['id']): x['name'] for k in weights for x in features[row.id].get(k, [])}
            keys.update({('creators', str(c['id'])): c['name'] for c in metadata[row.id]['credits'] or []
                         if c['role'] == 'Creator'})
            traits[row.id] = set(keys)
            names.update(keys)
        df = Counter(k for keys in traits.values() for k in keys)
        idf = {k: weights[k[0]] * math.log((len(sample) + 1) / (n + 2)) for k, n in df.items()}
        norm = {i: math.sqrt(sum(idf[k] for k in sorted(keys))) for i, keys in traits.items()}
        for target in sample:
            if target.id not in misses:
                continue
            def compare(other):
                shared = traits[target.id] & traits[other.id]
                similarity = sum(idf[k] for k in sorted(shared)) / max(1, norm[target.id] * norm[other.id])
                return -similarity, other.id, other, sorted(shared, key=lambda k: (-idf[k], k))
            neighbours = sorted(compare(r) for r in sample if target.eligible(r.id))
            for label, liked in [('closestLiked', True), ('closestDisliked', False)]:
                score, _, other, shared = next(n for n in neighbours if
                                                (n[2].stars >= 4.5 if liked else n[2].stars <= 2.5))
                misses[target.id][label] = dict(id=other.id, title=other.title, stars=other.stars, similarity=-score,
                                                shared=[names[k] for k in shared[:8]])


def programme_format(features):
    genres = {t['name'].casefold() for t in features.get('genres', [])}
    tags = {t['name'].casefold() for t in features.get('tags', [])}
    if genres & {'reality', 'talk'} or tags & {'game show', 'reality tv', 'reality show', 'talent show', 'talk show'}:
        return 'unscripted entertainment'
    if 'documentary' in genres or 'docuseries' in tags:
        return 'documentary'
    return None


def format_test(cohorts, features):
    shows = [r for r in cohorts['full'] if r.medium == 'show' and programme_format(features[r.id])]
    kinds = {r.id: programme_format(features[r.id]) for r in shows}
    results = {}
    for split, rows in cohorts.items():
        arms = {'lowMajority': [], 'lowMedian': []}
        for r in rows:
            if r.id not in kinds or r.before < 50:
                continue
            groups = defaultdict(list)
            for donor in shows:
                if r.eligible(donor.id) and kinds[donor.id] == kinds[r.id]:
                    groups[donor.family].append(donor.stars)
            ratings = [mean(v) for v in groups.values()]
            low = sum(s <= 2.5 for s in ratings)
            if low < 2:
                continue
            change = dict(id=r.id, title=r.title, stars=r.stars, before=r.before, after=49,
                          format=kinds[r.id], lowFamilies=low, families=len(ratings))
            if low * 2 > len(ratings):
                arms['lowMajority'].append(change)
            if median(ratings) < 3:
                arms['lowMedian'].append(change)
        results[split] = {name: dict(extraDislikes=sum(r['stars'] <= 2.5 for r in hits),
                                     likedLowered=sum(r['stars'] > 3 for r in hits),
                                     neutralLowered=sum(r['stars'] == 3 for r in hits), hits=hits)
                          for name, hits in arms.items()}
    return dict(members=[dict(title=r.title, stars=r.stars, format=kinds[r.id]) for r in shows], splits=results)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('capture', 'graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier',
                'grouped', 'witness', 'pairs', 'metadata', 'output'):
        parser.add_argument(key, type=Path)
    args = parser.parse_args()
    direct, cohorts = retained_panels(args)
    features = {}
    for block in read(args.capture):
        features.update({r['work']['id']: r['features'] for r in block['history']})
        features.update({r['id']: r['features'] for r in block['catalogue']})
    cases, summary = matched(cohorts['full'], direct, read(args.pairs))
    metadata = {r['id']: r for r in read(args.metadata)}
    nearest_examples(cohorts['full'], {r['id']: r for r in cases}, features, metadata)
    write_new(args.output, dict(summary=summary, pairs=cases, formats=format_test(cohorts, features)))
