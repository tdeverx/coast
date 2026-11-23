"""Compare fixed, vote-count-weighted blends against the full personal and guarded local estimates."""
import argparse
from collections import defaultdict
from itertools import combinations
import json
from pathlib import Path
from random import Random
from statistics import mean
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '2026-11-23-personal-dislike-signals'))
from lineage import display, utility

WEIGHTS = (0, 5, 10, 20, 40, 100)


def blend(row, weight, baseline):
    base = row[baseline]
    if not weight or not row['votes'] or row['audience'] is None:
        return base
    portion = weight / 100 * (row['votes'] / (row['votes'] + 50))
    return display(base + portion * (utility(row['audience'] / 2) - base))


def compare(sample):
    error, naive_error, saved = [], [], []
    green_lost = favs_lower = green_new = against_lower = against = low_lower = low_higher = low_red = 0
    buckets = defaultdict(list)
    errors_by_rating = defaultdict(list)
    for r, score, base in sample:
        stars = r['stars']
        buckets[r['medium']].append((stars, score))
        error.append(abs(score - utility(stars)))
        group = 'low' if stars <= 2.5 else 'five' if stars == 5 else 'other'
        errors_by_rating[group].append(error[-1])
        naive_error.append(abs(score - stars * 20))
        saved.append(abs(base - utility(stars)) - error[-1])
        if stars == 5:
            favs_lower += score < base
            green_lost += score < 80 <= base
            green_new += base < 80 <= score
            if r['audience'] is not None and stars - r['audience'] / 2 >= 1:
                against += 1
                against_lower += score < base
        if stars <= 2.5:
            low_lower += score < base
            low_higher += score > base
            low_red += score < 50
    rankings = {}
    for medium, pairs in buckets.items():
        ordered = ties = unequal = 0
        for (a,x),(b,y) in combinations(pairs, 2):
            if a == b:
                continue
            unequal += 1
            ordered += (a-b) * (x-y) > 0
            ties += x == y
        rankings[medium] = (ordered + ties / 2) / unequal if unequal else None
    return dict(titles=len(sample), utilityMAE=mean(error), linearMAE=mean(naive_error),
                closer=sum(s > 0 for s in saved), further=sum(s < 0 for s in saved),
                lowerDislikes=low_lower, higherDislikes=low_higher, dislikesBelow50=low_red, fiveLower=favs_lower,
                lostGreen=green_lost, newGreen=green_new, againstFive=against, againstFiveLower=against_lower,
                ordering=rankings, utilityMAEByMedium={m:mean(abs(s - utility(a)) for a,s in pairs)
                                                      for m,pairs in buckets.items()},
                utilityMAEByRating={k:mean(v) for k,v in errors_by_rating.items()})


def franchise_intervals(rows, baseline):
    """Paired estimate for mean error change, resampling whole franchises within medium."""
    weights = (20, 40)
    estimates = {m: {w: [] for w in weights} for m in ('movie', 'show', 'pooled')}
    rng = Random(20261123)
    families = defaultdict(dict)
    for r in rows:
        family = families[r['medium']].setdefault(r['cluster'], [0, 0., 0.])
        actual, base = utility(r['stars']), r[baseline]
        family[0] += 1
        for j, w in enumerate(weights, 1):
            family[j] += abs(blend(r, w, baseline) - actual) - abs(base - actual)
    by_medium = {m: list(f.values()) for m,f in families.items()}
    for _ in range(2000):
        combined = [0, 0., 0.]
        for medium, records in by_medium.items():
            sampled = rng.choices(records, k=len(records))
            sums = [sum(values) for values in zip(*sampled)]
            combined = [a+b for a,b in zip(combined, sums)]
            for j, w in enumerate(weights, 1):
                estimates[medium][w].append(sums[j] / sums[0])
        for j, w in enumerate(weights, 1):
            estimates['pooled'][w].append(combined[j] / combined[0])
    return {m: {w: [sorted(vals)[49], sorted(vals)[1949]] for w,vals in arms.items()}
            for m,arms in estimates.items()}


def shared_credit_order(rows, metadata):
    """A diagnostic restricted to differently rated, unrelated works with a shared credit."""
    from audience import nudge
    result = {}
    for medium in ('movie', 'show'):
        selected = [r for r in rows if r['medium'] == medium]
        roles = {r['id']: nudge.roles(metadata.get(r['id'], {}), medium) for r in selected}
        pairs = defaultdict(list)
        for a,b in combinations(selected, 2):
            if a['stars'] == b['stars'] or a['cluster'] == b['cluster']:
                continue
            ar, br = roles[a['id']], roles[b['id']]
            people = ar.keys() & br.keys()
            if not people:
                continue
            role = 'sameLead' if any(ar[p] == br[p] == 'lead' for p in people) else 'includesExecutive'
            higher, lower = (a,b) if a['stars'] > b['stars'] else (b,a)
            pair = higher['id'], lower['id']
            pairs[role].append(pair)
            if higher['stars'] >= 4 and lower['stars'] <= 2.5:
                pairs[role + 'LikeOverDislike'].append(pair)
        scores = {w: {r['id']: blend(r, w, 'combined') for r in selected} for w in WEIGHTS}
        result[medium] = {
            group: dict(pairs=len(sample), ordering={
                w: mean((vector[a] > vector[b]) + .5 * (vector[a] == vector[b]) for a,b in sample)
                for w, vector in scores.items()})
            for group,sample in pairs.items()
        }
    return result


def report(rows, verified, credits=None):
    labels = {(r['medium'],r['id']):r['stars'] for r in verified if r.get('at') and r.get('stars') is not None}
    target_rows = [r for r in rows if (r['medium'],r['id']) in labels]
    assert len(target_rows) == len(labels) and {(r['medium'], r['id']) for r in target_rows} == labels.keys()
    assert all(labels[r['medium'], r['id']] == r['stars'] for r in target_rows)
    results = {}
    for baseline in ('combined', 'guardedCombined'):
        results[baseline] = {
            w: compare([(r, blend(r, w, baseline), r[baseline]) for r in target_rows]) for w in WEIGHTS
        }
    results['pairedUtilityMAEChange95'] = franchise_intervals(target_rows, 'combined')
    if credits:
        results['sharedCreditOrder'] = shared_credit_order(target_rows, {r['id']:r for r in credits})
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paired_private')
    parser.add_argument('verified_direct_export')
    parser.add_argument('--credit-metadata', help='Metadata snapshot already verified by the paired replay.')
    args = parser.parse_args()
    read = lambda f: json.loads(Path(f).read_bytes())
    out = report(read(args.paired_private), read(args.verified_direct_export)['ratings'],
                 read(args.credit_metadata) if args.credit_metadata else None)
    print(json.dumps(out, indent=2, allow_nan=False))
