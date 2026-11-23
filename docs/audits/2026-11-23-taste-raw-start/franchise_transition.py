"""Does the viewer dislike instalments after a directing change in other film franchises?

Use release order in the frozen catalogue and stable collection and director IDs.
Never use personal opinions of the target's own franchise. A training transition
needs direct ratings on both movies, with the predecessor rated at least four.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median

from retained_panels import retained_panels
from team_audience import read, write_new


def transitions(capture, supply, metadata, releases):
    movies = next(p for p in capture if p['medium'] == 'movie')
    families, dates = defaultdict(set), defaultdict(set)
    director_facets = defaultdict(set)
    for row in movies['history'] + movies['catalogue']:
        work = row['id'] if 'id' in row else row['work']['id']
        families[work].update(f['id'] for f in row['features'].get('franchises', []) if f['id'].startswith('tmdb:'))
        director_facets[work].update(c['id'][5:] for c in row['features'].get('directors', [])
                                     if c['id'].startswith('tmdb:') and c['id'][5:].isdigit())
        if row.get('release'):
            dates[work].add(datetime.fromtimestamp(row['release'] / 1000, timezone.utc).date().isoformat())

    local = defaultdict(set)
    for row in supply['films']:
        local[row['family']].add(row['work'])
        dates[row['work']].add(row['release'][:10])
    source_groups = {key: set().union(*(families.get(i, set()) for i in ids)) for key, ids in local.items()}
    for key, ids in local.items():
        if len(source_groups[key]) == 1:
            for i in ids:
                families[i].update(source_groups[key])
    directors = {r['id']: {str(c['id']) for c in r.get('credits') or []
                            if c['role'] == 'Director' and str(c['id']).isdigit()}
                 for r in metadata if r['kind'] == 'movie'}
    for i, director_ids in director_facets.items():
        if not directors.get(i):
            directors[i] = director_ids
    for row in releases:
        if row['id'] in families and not dates[row['id']]:
            stored = [row['release_date']] if row.get('release_date') else row['dates']
            dates[row['id']].update(stamp[:10] for stamp in stored if stamp)
    groups = defaultdict(list)
    for i, keys in families.items():
        for group in keys:
            groups[group].append(i)
    observed = {}
    for group, members in groups.items():
        if len(members) < 2 or any(len(families[i]) != 1 or len(dates[i]) != 1 for i in members):
            continue
        days = defaultdict(list)
        for i in members:
            days[next(iter(dates[i]))].append(i)
        stages = [days[d] for d in sorted(days)]
        for left, right in zip(stages, stages[1:]):
            if len(left) != 1 or len(right) != 1:
                continue
            a, b = left[0], right[0]
            if directors.get(a) and directors.get(b):
                observed[b] = (a, group, 'continuing' if directors[a] & directors[b] else 'changed')
    return observed


def rate_groups(rated):
    return {f: median(values) for f, values in rated.items()}


def evidence(held, direct, transitions_by_title, donors):
    predecessor, target_family, status = transitions_by_title[held.id]
    groups = {'changed': defaultdict(list), 'continuing': defaultdict(list)}
    for a, b, family, direction in donors:
        if family == target_family or not held.eligible(a) or not held.eligible(b):
            continue
        assert held.id not in (a, b)
        if direct[a]['stars'] >= 4:
            groups[direction][family].append(direct[b]['stars'])
    same = rate_groups(groups[status])
    other = rate_groups(groups['continuing' if status == 'changed' else 'changed'])
    # Count positive counterexamples from families outside the target-direction sample.
    other = {key: val for key, val in other.items() if key not in same}
    same_low = sum(s <= 2.5 for s in same.values())
    other_high = sum(s >= 4 for s in other.values())
    low_majority = same_low >= 2 and same_low * 2 > len(same)
    resolution = other_high >= 2 and other_high * 2 > len(other)
    return dict(predecessor=predecessor, direction=status, families=len(same), disliked=same_low,
                median=median(same.values()) if same else None, controls=len(other), likedControls=other_high,
                majority=low_majority, contrast=low_majority and resolution)


def replay(args):
    direct, panels = retained_panels(args)
    previous = read(args.previous)
    transitions_by_title = transitions(read(args.capture), read(args.supply), read(args.metadata), read(args.releases))
    donors = [(a, b, family, direction) for b, (a, family, direction) in transitions_by_title.items()
              if a in direct and b in direct]
    output = {}
    for name, rows in panels.items():
        extra = {r['id']: r for r in previous[name]['changes']['sameKindCompany']}
        arms = ('before', 'contrast', 'majority')
        metrics = {a: Counter() for a in arms}
        checks = []
        for row in rows:
            before = extra[row.id]['after'] if row.id in extra else row.before
            if row.id in extra:
                assert extra[row.id]['before'] == row.before
            case = None
            if row.medium == 'movie' and row.id in transitions_by_title:
                case = evidence(row, direct, transitions_by_title, donors)
                checks.append(dict(id=row.id, title=row.title, stars=row.stars, before=before, **case))
            for arm in arms:
                after = 49 if arm != 'before' and case and case[arm] and before >= 50 else before
                counts = metrics[arm]
                counts['total'] += 1
                counts['redDislikes'] += row.stars <= 2.5 and after < 50
                counts['keptOriginal'] += row.stars <= 2.5 and row.before < 50 and after == row.before
                counts['keptPreviousCandidate'] += row.id in extra and after == before
                counts['newRedDislikes'] += row.stars <= 2.5 and after < before
                counts['loweredThree'] += row.stars == 3 and after < before
                counts['loweredLiked'] += row.stars > 3 and after < before
                counts['loweredFive'] += row.stars == 5 and after < before
        assert metrics['before']['redDislikes'] == len(previous[name]['previous']) + len(extra)
        output[name] = dict(metrics=metrics, cases=checks)
    write_new(args.output, output)
    for split, report in output.items():
        cases = report['cases']
        print(split, 'coverage', len(cases), 'eligible dislikes', sum(c['stars'] <= 2.5 for c in cases),
              'direction', dict(Counter(c['direction'] for c in cases)), 'contrast', dict(report['metrics']['contrast']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                  'capture', 'supply', 'metadata', 'releases', 'previous', 'output'):
        parser.add_argument(field, type=Path)
    replay(parser.parse_args())
