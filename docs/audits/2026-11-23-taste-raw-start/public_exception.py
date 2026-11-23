"""Veto a public-only red when a more similar poorly received work was personally liked.

Compare personal 4+ star exceptions against <=2.5 star confirmations using the existing
equal-weight genre/tag Jaccard. Only other franchises of the same medium are eligible.
A tie favours the exception. The sensitivity arm requires a positive-similarity dislike
witness even when no qualifying exception exists.
"""
import argparse
from collections import defaultdict
from pathlib import Path

from raw_public import earlier_days, full_history, run
from team_audience import compare, partial, read, utility, write_new


def metadata(capture, graded, verified, public):
    ratings = {r['id']: r for r in verified['ratings']}
    crowd = {r['id']: r for r in public['rows']}
    index = {}
    for data in capture:
        medium = data['medium']
        panel = next(p for p in graded['runs'] if (p['medium'], p['budget'], p['split']) == (medium, 'all', 'work'))
        features = {r['work']['id']: r['features'] for r in data['history']}
        features.update({r['id']: r['features'] for r in data['catalogue']})
        for t in panel['targets']:
            i = t['id']
            if i in ratings:
                assert ratings[i]['stars'] == t['stars'] and ratings[i]['medium'] == medium
                sets = [{g['id'] for g in features[i].get(k, [])} for k in ('genres', 'tags')]
                public_result = crowd.get(i)
                low = bool(public_result and public_result['votes'] > 0 and utility(public_result['score'] / 2) < 50)
                index[i] = dict(ratings[i], cluster=t['cluster'], low=low, genres=sets[0], tags=sets[1])
    assert index.keys() == ratings.keys()
    return index


def witnesses(index, work, day, liked_minimum):
    target = index[work]
    matches = {'liked': [], 'disliked': []}
    for j, donor in index.items():
        if donor['medium'] != target['medium'] or donor['cluster'] == target['cluster'] or not donor['low']:
            continue
        if day is not None and donor['at'][:10] >= day:
            continue
        if 2.5 < donor['stars'] < liked_minimum:
            continue
        overlap = partial.lineage.overlap
        similarity = (overlap(target['genres'], donor['genres']) + overlap(target['tags'], donor['tags'])) / 2
        if similarity > 0:
            matches['liked' if donor['stars'] >= liked_minimum else 'disliked'].append((similarity, j))
    assert all(j != work for values in matches.values() for _, j in values)
    return matches


def guard(matches, index, base, lowered, excluded=()):
    evidence = {k: max(((sim, j) for sim,j in values if index[j]['cluster'] not in excluded), default=(0, None))
                for k, values in matches.items()}
    exception, support = evidence['liked'][0], evidence['disliked'][0]
    blocked = exception > 0 and exception >= support
    return evidence, base if blocked else lowered, base if blocked or not support else lowered


def evaluate(data, index, earlier, liked_minimum):
    inputs = list(data)
    previous = run(inputs)
    public_reds = set(previous['corroborated']['newlyRed'])
    rated = defaultdict(list)
    details = []
    for row, s, _ in inputs:
        i, base, exact = row['id'], s['base'], row['exact']
        pre = broad = strict = exact
        if exact == base and i in public_reds:
            matches = witnesses(index, i, row['group'] if earlier else None, liked_minimum)
            pre = s['bothRemovals']
            evidence, broad, strict = guard(matches, index, base, pre)
            # Keep the frozen native, public-corroboration and exact-team forecasts. Check how
            # many public-only verdicts change when each other donor family is removed in turn.
            families = {index[j]['cluster'] for values in matches.values() for _, j in values}
            changes = {}
            for family in sorted(families):
                score = guard(matches, index, base, pre, {family})[-1]
                if score != strict:
                    changes[family] = score
            details.append(dict(id=i, stars=row['stars'], evidence=evidence, base=base,
                                previous=pre, veto=broad, required=strict, withoutFamily=changes))
        for name, score in [('exact', exact), ('previous', pre), ('veto', broad), ('supportRequired', strict)]:
            rated[name].append((row, score, base))
    stats = {}
    for name, pairs in rated.items():
        value = compare(pairs)
        value.update(likedRed=sum(r['stars'] >= 4 and s < 50 for r,s,_ in pairs),
                     likedLower=sum(r['stars'] >= 4 and s < base for r,s,base in pairs),
                     middleRed=sum(2.5 < r['stars'] < 4 and s < 50 for r,s,_ in pairs))
        stats[name] = value
    assert stats['previous']['dislikesBelow50'] == previous['exactThenCorroborated']['dislikesBelow50']
    return dict(stats=stats, changes=details)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for key in ('capture', 'graded', 'verified', 'public', 'teams', 'show', 'movie', 'archives', 'earlier', 'output'):
        cli.add_argument(key, type=Path)
    a = cli.parse_args()
    index = metadata(read(a.capture), read(a.graded), read(a.verified), read(a.public))
    full = list(full_history(read(a.teams), [a.show, a.movie]))
    earlier = list(earlier_days(read(a.archives), a.earlier))
    write_new(a.output, dict(full=evaluate(full, index, False, 4),
                             earlier=evaluate(earlier, index, True, 4),
                             fullAboveNeutral=evaluate(full, index, False, 3.5),
                             earlierAboveNeutral=evaluate(earlier, index, True, 3.5)))
