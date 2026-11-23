"""Test positive personal evidence as a veto on the existing public red correction."""
import argparse
from collections import defaultdict
import hashlib
from pathlib import Path

from raw_public import earlier_days, full_history
from team_audience import compare, partial, read, utility, write_new


def evaluate(inputs, expected, ratings, facts):
    public_ids = set()
    results, inspected = defaultdict(list), []
    for row, scores, checked_shift in inputs:
        i, medium, base = row['id'], row['medium'], scores['base']
        exact, both = row['exact'], scores['bothRemovals']
        public_fit = 50
        if row['votes'] and row['audience'] is not None:
            public_fit += (utility(row['audience'] / 2) - 50) * row['votes'] / (row['votes'] + 50)
        supports_red = both < 50 <= base and public_fit < 50 and checked_shift < 0
        if supports_red:
            public_ids.add(i)
        original = exact if exact != base or not supports_red else both
        alternatives = {'original': original, 'fourStar': original, 'positive': original, 'familyPositive': original}
        if original < 50 <= base and exact == base:
            assert i in public_ids
            lead, _, family, genres = facts[medium][i]
            day = row.get('group') if row.get('split') == 'rolling-day' else None
            neighbours = []
            for j, other in ratings[medium].items():
                if i == j or (day and other['at'][:10] >= day):
                    continue
                other_lead, _, other_family, other_genres = facts[medium][j]
                same_family = family == other_family
                same_team = bool(lead and lead == other_lead and partial.overlap_half(genres, other_genres))
                if same_family or same_team:
                    neighbours.append(dict(id=j, stars=other['stars'], family=same_family, team=same_team))
            strongest = max((n['stars'] for n in neighbours), default=0)
            if strongest >= 4:
                alternatives['fourStar'] = base
            if strongest > 3:
                alternatives['positive'] = base
            if any(n['family'] and n['stars'] > 3 for n in neighbours):
                alternatives['familyPositive'] = base
            inspected.append(dict(id=i, medium=medium, title=row['title'], day=day, stars=row['stars'],
                                  base=base, publicRed=original, alternatives=alternatives, neighbours=neighbours))
        for arm, value in alternatives.items():
            if exact != base:
                assert value == exact
            results[arm].append((row, value, base))
    summary = {}
    for arm, sample in results.items():
        metrics = compare(sample)
        metrics.update(
            fourPlusRed=sum(r['stars'] >= 4 and score < 50 for r, score, _ in sample),
            fourPlusLowered=sum(r['stars'] >= 4 and score < base for r, score, base in sample),
            middleRed=sum(2.5 < r['stars'] < 4 and score < 50 for r, score, _ in sample),
            threeHalfLowered=sum(r['stars'] == 3.5 and score < base for r, score, base in sample),
            newlyRed=sorted(r['id'] for r, score, base in sample if score < 50 <= base),
        )
        summary[arm] = metrics
    reference = expected['exactThenCorroborated']
    for field in ('dislikesBelow50', 'fiveLower', 'lostGreen', 'fourPlusRed', 'middleRed', 'utilityMAE'):
        assert abs(summary['original'][field] - reference[field]) < 1e-9
    assert summary['original']['newlyRed'] == sorted(reference['newlyRed'])
    assert public_ids == set(expected['corroborated']['newlyRed'])
    return dict(summary=summary, publicRedDetails=inspected)


def main(args):
    graded = read(args.graded)
    for field in ('metadata', 'capture', 'dates'):
        assert graded['manifest'][field] == hashlib.sha256(getattr(args, field).read_bytes()).hexdigest()
    metadata = {m['id']: m for m in read(args.metadata)}
    known = {r['id']: r for r in read(args.dates)}
    ratings = defaultdict(dict)
    for r in read(args.verified)['ratings']:
        i = r['id']
        assert i in known and r['stars'] == known[i]['stars'] and r['at'][:10] == known[i]['at'][:10]
        ratings[r['medium']][i] = r
    assert sum(map(len, ratings.values())) == 870
    facts = {}
    for dataset in read(args.capture):
        kind = dataset['medium']
        work = next(p for p in graded['runs'] if (p['medium'],p['split'],p['budget']) == (kind, 'work', 'all'))
        genres = {r['work']['id']: {g['id'] for g in r['features'].get('genres', [])} for r in dataset['history']}
        facts[kind] = partial.index_works(metadata, genres, {r['id']: r for r in work['targets']}, kind)
        assert all(facts[kind][i][2] for i in ratings[kind])
    h = full_history(read(args.team), [args.movie, args.show])
    d = earlier_days(read(args.archived), args.earlier)
    report = dict(full=evaluate(h, read(args.full_reference), ratings, facts),
                  earlier=evaluate(d, read(args.earlier_reference), ratings, facts))
    write_new(args.output, report)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('graded', 'metadata', 'capture', 'dates', 'verified', 'team', 'movie', 'show',
                 'archived', 'earlier', 'full_reference', 'earlier_reference', 'output'):
        parser.add_argument(name, type=Path)
    main(parser.parse_args())
