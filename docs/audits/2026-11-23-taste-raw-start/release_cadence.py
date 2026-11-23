"""Does a viewer consistently prefer a weekly or a same-day premiere in comparable shows?

Pair other batch and weekly shows by genres and premiere date, without looking at ratings.
Require at least three disjoint family pairs. One arm asks whether most shows sharing
the target cadence were disliked while the other side usually earned at least four stars.
A second gives a small signed nudge if at least three non-tied comparisons agree and
at least three quarters of the informative pairs favour the same cadence.
"""
import argparse
from collections import Counter, defaultdict
from datetime import date
from itertools import combinations
from pathlib import Path
from statistics import median

from retained_panels import retained_panels
from separate_credits import similar_genres
from team_audience import display, read, utility, write_new


def premieres(census):
    releases = defaultdict(lambda: defaultdict(set))
    for row in census:
        if row['season'] == 1 and row['episode'] in (1, 2, 3, 4) and row['release']:
            releases[row['root']][row['episode']].add(date.fromisoformat(row['release'][:10]))
    result = {}
    for i, episodes in releases.items():
        if len(episodes) != 4 or any(len(days) != 1 for days in episodes.values()):
            continue
        days = [next(iter(episodes[n])) for n in range(1, 5)]
        gaps = [(b - a).days for a, b in zip(days, days[1:])]
        if min(gaps) < 0:
            continue
        if days[-1] == days[0]:
            result[i] = ('batch', days[0], days[-1])
        elif (days[-1] - days[0]).days >= 14 and all(d == 0 or 5 <= d <= 9 for d in gaps):
            result[i] = ('weekly', days[0], days[-1])
    return result


def paired_analogues(ids, genres, release, family):
    # Precompute rating-blind nearest comparable pairs; each family can vote once per target.
    edges = []
    for a, b in combinations(sorted(ids), 2):
        if family[a] == family[b] or release[a][0] == release[b][0] or not similar_genres(genres[a], genres[b]):
            continue
        if abs(release[a][1].year - release[b][1].year) > 5:
            continue
        similarity = len(genres[a] & genres[b]) / len(genres[a] | genres[b])
        distance = abs((release[a][1] - release[b][1]).days)
        first, second = (a, b) if release[a][0] == 'batch' else (b, a)
        edges.append((-similarity, distance, first, second))
    return sorted(edges)


def replay(args):
    direct, panels = retained_panels(args)
    previous = read(args.credit_replay)
    screened = premieres(read(args.events)['census'])
    capture = next(p for p in read(args.capture) if p['medium'] == 'show')
    features = {h['work']['id']: h['features'] for h in capture['history']}
    features.update({h['id']: h['features'] for h in capture['catalogue']})
    genres = {i: {g['id'] for g in f.get('genres', [])} for i, f in features.items()}
    release = {i: val for i, val in screened.items() if i in direct and genres.get(i)}
    family = {r.id: r.family for r in panels['full']}
    edges = paired_analogues(release, genres, release, family)
    result = {}
    for split, rows in panels.items():
        original_hits = sorted(r.id for r in rows if r.stars <= 2.5 and r.before < 50)
        assert original_hits == previous[split]['previous']
        overrides = {r['id']: r for r in previous[split]['changes']['sameKindCompany']}
        coverage, changes = Counter(), {'strict': [], 'nudge': []}
        for r in rows:
            before = r.before
            if r.id in overrides:
                assert overrides[r.id]['before'] == before
                before = overrides[r.id]['after']
            if r.id not in release or before < 50:
                continue
            day = date.fromisoformat(r.group) if split == 'earlier' else None
            # The fourth episode must have aired by the evaluation date, including on donors.
            if day and release[r.id][2] >= day:
                continue
            coverage['hasCadence'] += 1
            allowed = {i for i in release if r.eligible(i) and similar_genres(genres[r.id], genres[i])
                       and (not day or release[i][2] < day)}
            used, pairs = set(), []
            for _, _, a, b in edges:
                if a in allowed and b in allowed and family[a] not in used and family[b] not in used:
                    used.update((family[a], family[b]))
                    pairs.append((a, b) if release[r.id][0] == 'batch' else (b, a))
            if len(pairs) < 3:
                continue
            coverage['atLeastThreePairs'] += 1
            coverage['eligibleDislikes'] += r.stars <= 2.5
            first = [direct[a]['stars'] for a, _ in pairs]
            second = [direct[b]['stars'] for _, b in pairs]
            forecasts = {}
            if sum(v <= 2.5 for v in first) * 2 > len(first) and median(second) >= 4:
                forecasts['strict'] = 49
            support = sum(a > b for a, b in zip(first, second))
            oppose = sum(a < b for a, b in zip(first, second))
            if max(support, oppose) >= 3 and max(support, oppose) * 4 >= 3 * (support + oppose):
                # Tied comparisons dilute the effect; protect existing below-neutral calls.
                forecasts['nudge'] = display(before + 4 * (support - oppose) / len(pairs))
            for arm, after in forecasts.items():
                if after != before:
                    changes[arm].append(dict(id=r.id, title=r.title, before=before, after=after,
                                             stars=r.stars, pairs=pairs))
        for arm, values in changes.items():
            grade = Counter(str(v['stars']) for v in values)
            delta = sum(abs(v['after'] - utility(v['stars'])) - abs(v['before'] - utility(v['stars'])) for v in values)
            print(split, arm, 'coverage', dict(coverage), 'moved by rating', dict(sorted(grade.items())),
                  'change in mean absolute error', round(delta / len(rows), 4))
        result[split] = dict(coverage=coverage, changes=changes)
    write_new(args.output, result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                'credit_replay', 'events', 'capture', 'output'):
        parser.add_argument(key, type=Path)
    replay(parser.parse_args())
