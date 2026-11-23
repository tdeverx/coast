"""Test an absolute, viewer-calibrated public score before allowing a new red."""
import argparse
from collections import defaultdict
from pathlib import Path

from raw_public import earlier_days, full_history
from team_audience import compare, read, utility, write_new
from archived_teams import crowd_local


def public_fit(score, votes):
    return 50 + (utility(score / 2) - 50) * votes / (votes + 50)


def weighted_median(values):
    ordered = sorted(values)
    half = sum(w for _, w in ordered) / 2
    total = 0
    for index, (value, weight) in enumerate(ordered):
        total += weight
        if total > half:
            return value
        if total == half:
            return (value + ordered[index + 1][0]) / 2
    raise ValueError('A median requires positive weights.')


def inputs(capture, graded, public):
    reception = {r['id']: r for r in public['rows'] if r['votes'] > 0}
    result = {}
    for data in capture:
        medium = data['medium']
        panel = next(p for p in graded['runs'] if (p['medium'], p['split'], p['budget']) == (medium, 'work', 'all'))
        canonical = {t['id']: t for t in panel['targets']}
        features = {r['work']['id']: r['features'] for r in data['history']}
        features.update({r['id']: r['features'] for r in data['catalogue']})
        metadata = {i: (reception[i]['score'], reception[i]['votes'],
                        {g['id'] for g in features[i].get('genres', [])},
                        {t['id'] for t in features[i].get('tags', [])})
                    for i in canonical if i in reception}
        result[medium] = canonical, metadata
    return result


def correction(target, canon, metadata, labels):
    eligible = {j: stars for j, stars in labels.items() if j in metadata and metadata[j][0] < 6
                and canon[target]['cluster'] != canon[j]['cluster']}
    neighbours = crowd_local.work_neighbours(target, canon, metadata, eligible)
    # Identical family/genre/tag selection and vote attenuation to the earlier public check.
    differences = {j: utility(stars) - public_fit(*metadata[j][:2]) for j, stars in eligible.items()}
    donors = crowd_local.select_donors(neighbours, metadata, differences, eligible)
    if len(donors) < 2:
        return None, len(donors)
    offsets = [(d.error, d.weight) for d in donors]
    return weighted_median(offsets), len(donors)


def evaluate(held, by_medium, ratings, chronological):
    forecasts = defaultdict(list)
    for row, scores, earlier_shift in held:
        i, medium = row['id'], row['medium']
        base, lower = scores['base'], scores['bothRemovals']
        values = dict(native=base, exact=row['exact'], original=row['exact'],
                      medianNeutral=row['exact'], medianDislike=row['exact'])
        if (row['exact'] == base and lower < 50 <= base and earlier_shift < 0
                and row['votes'] and row['audience'] is not None and row['audience'] < 6):
            values['original'] = lower
            allowed = {r['id']: r['stars'] for r in ratings if r['medium'] == medium and r['id'] != i
                       and (not chronological or r['at'][:10] < row['group'])}
            offset, _ = correction(i, *by_medium[medium], allowed)
            if offset is not None:
                calibrated = public_fit(row['audience'], row['votes']) + offset
                if calibrated < 50:
                    values['medianNeutral'] = lower
                if calibrated <= utility(2.5):
                    values['medianDislike'] = lower
        for method, candidate in values.items():
            forecasts[method].append((row, candidate, base))
    result = {}
    for method, sample in forecasts.items():
        v = compare(sample)
        v['below50ByStars'] = {str(stars): sum(r['stars'] == stars and s < 50 for r,s,_ in sample)
                               for stars in sorted({r['stars'] for r,_,_ in sample})}
        v['fourPlusLower'] = sum(r['stars'] >= 4 and s < base for r,s,base in sample)
        v['redIds'] = sorted(r['id'] for r,s,_ in sample if s < 50)
        result[method] = v
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for key in ('capture', 'graded', 'tmdb', 'direct', 'dates', 'teams', 'movie', 'show',
                'archived', 'dated_holdouts', 'output'):
        p.add_argument(key, type=Path)
    a = p.parse_args()
    by_medium = inputs(read(a.capture), read(a.graded), read(a.tmdb))
    full = evaluate(full_history(read(a.teams), [a.movie, a.show]), by_medium, read(a.direct)['ratings'], False)
    earlier = evaluate(earlier_days(read(a.archived), a.dated_holdouts), by_medium, read(a.dates), True)
    write_new(a.output, dict(full=full, earlier=earlier))
