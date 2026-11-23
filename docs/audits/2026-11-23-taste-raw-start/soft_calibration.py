"""Evaluate a bounded final display adjustment, optionally requiring previously underestimated comparable works."""
from argparse import ArgumentParser
from collections import Counter, defaultdict
import json
from pathlib import Path
from statistics import mean

from retained_panels import GROUPED, retained_panels
from separate_credits import similar_genres
from team_audience import display, read, utility, write_new


def lift(selected, raw, native, restore):
    if not 50 < selected < 80:
        return selected
    return display(selected + min(restore * max(0, raw - native), selected - 50, 80 - selected))


def inputs(args, direct):
    graded = read(args.graded)
    tiers = {(r['medium'], r['split']): {t['id']: t for t in r['targets']} for r in graded['runs']
             if r['budget'] == 'all' or (r['split'], r['budget']) == ('rolling-day', 'dated ratings only')}
    inner = {(r['medium'], r['split'], r['group']): {t['id']: t['base'] for t in r['points']}
             for r in read(args.inner) if r['budget'] in ('all', 'dated ratings only')}
    whole = {}
    for path in args.raw:
        receipt, *predictions, footer = [json.loads(line) for line in path.read_text().splitlines()]
        assert receipt['type'] == 'receipt' and footer['type'] == 'complete'
        for r in predictions:
            assert r['type'] == 'prediction' and r['id'] not in whole
            assert r['medium'] == direct[r['id']]['medium'] and r['stars'] == direct[r['id']]['stars']
            assert r['native'] == display(r['projected'])
            whole[r['id']] = r
    if args.raw:
        assert whole.keys() == direct.keys()
    return tiers, inner, whole


def descriptions(capture, metadata, direct):
    features = {row['work']['id']: row['features'] for panel in capture for row in panel['history']}
    features.update({row['id']: row['features'] for panel in capture for row in panel['catalogue']})
    credits = {r['id']: r.get('credits') or [] for r in metadata if r['id'] in direct}
    genres, cues, postings = {}, {}, defaultdict(set)
    for i, rating in direct.items():
        f = features[i]
        genres[i] = {g['id'] for g in f.get('genres', [])}
        relevant = {'Director'} if rating['medium'] == 'movie' else {'Creator', 'Showrunner'}
        cues[i] = {('tag', t['id']) for t in f.get('tags', []) if t['id'].startswith('tmdb:')}
        cues[i].update((p['role'], str(p['id'])) for p in credits.get(i, [])
                       if p.get('role') in relevant and str(p.get('id', '')).isdigit())
        for cue in cues[i]:
            postings[cue].add(i)
    return genres, cues, postings


def family_days(dates, tiers):
    first = {}
    for record in dates:
        item = tiers[record['medium'], 'franchise'].get(record['id'])
        if item:
            key = (record['medium'], item['cluster'])
            day = record['at'][:10]
            first[key] = min(day, first.get(key, day))
    return first


def qualifying_cues(row, step, direct, tiers, inner, features, dated, first_days):
    genres, cues, postings = features
    split = 'franchise' if row.split == 'full' else 'rolling-day' if row.split == 'earlier' else row.split
    tier = tiers[row.medium, split]
    group = tier[row.id]['group']
    training = inner[row.medium, split, group] if row.split != 'earlier' else {}
    families_by_id = tiers[row.medium, split if split in GROUPED else 'franchise']
    result = []
    for cue in sorted(cues[row.id]):
        donors = {j for j in postings[cue] if row.eligible(j) and similar_genres(genres[row.id], genres[j])}
        families = {families_by_id[j]['cluster'] for j in donors}
        if len(families) < 2 or any(direct[j]['stars'] < 4 for j in donors):
            continue
        for j in donors:
            # A same-outer-fold donor in full replay has an already jointly excluded native forecast.
            if row.split == 'earlier':
                donor = dated.get(j)
                if donor is None or donor.group > min(first_days[row.medium, row.family], first_days[row.medium, donor.family]):
                    break
                prediction = donor.native
            elif row.split == 'full' and tier[j]['group'] == group:
                prediction = tier[j]['scores']['calibrated']
            else:
                prediction = training.get(j)
            if prediction is None or utility(direct[j]['stars']) - prediction < step:
                break
        else:
            result.append((cue, families))
    return result


def run(args):
    direct, panels = retained_panels(args)
    tiers, inner, whole = inputs(args, direct)
    features = descriptions(read(args.capture), read(args.metadata), direct)
    dated = {r.id: r for r in panels['earlier']}
    first_days = family_days(read(args.dates), tiers)
    margin = read(args.margin)['cohorts']
    output = {}
    for split, rows in panels.items():
        if split == 'full' and not whole:
            continue
        adjusted = {c['id']: c for c in margin[split]['candidates']}
        cases = []
        for row in rows:
            if split == 'full':
                raw = whole[row.id]['raw']
                assert whole[row.id]['native'] == row.native
            else:
                panel = tiers[row.medium, split if split in GROUPED else 'rolling-day'][row.id]
                assert panel['group'] == row.group and panel['stars'] == row.stars
                assert panel['scores']['calibrated'] == row.native
                raw = panel['scores']['balanced']
            chosen = adjusted.get(row.id)
            if chosen:
                assert chosen['before'] == row.before
            selected = chosen['cueScaled'] if chosen else row.before
            gentle, half = (lift(selected, raw, row.native, a) for a in (.25, .5))
            support = qualifying_cues(row, half-selected, direct, tiers, inner, features, dated, first_days) if half > selected else []
            dual = any(a[0] == 'tag' and b[0] != 'tag' and a_fam.isdisjoint(b_fam)
                       for a, a_fam in support for b, b_fam in support)
            cases.append(dict(id=row.id, title=row.title, stars=row.stars, medium=row.medium, native=row.native, raw=raw,
                              selected=selected, quarter=gentle, half=half, oneCue=half if support else selected,
                              twoCues=half if dual else selected, cues=[k for k, _ in support]))
        metrics = {}
        for arm in ('selected', 'quarter', 'half', 'oneCue', 'twoCues'):
            moved = [r for r in cases if r[arm] != r['selected']]
            assert all(r[arm] > r['selected'] for r in moved)
            assert all(r[arm] == r['selected'] for r in cases if r['selected'] <= 50 or r['selected'] >= 80)
            metrics[arm] = dict(changedByStars=dict(sorted(Counter(r['stars'] for r in moved).items())),
                                newlyGreenByStars=dict(sorted(Counter(r['stars'] for r in moved if r[arm] >= 80).items())),
                                dislikeRises=sum(r['stars'] <= 2.5 for r in moved),
                                retainedRedIds=sorted(r['id'] for r in cases if r['stars'] <= 2.5 and r[arm] < 50),
                                mae=mean(abs(r[arm]-utility(r['stars'])) for r in cases))
        output[split] = dict(metrics=metrics, cases=cases)
    write_new(args.output, output)


if __name__ == '__main__':
    cli = ArgumentParser(description=__doc__)
    for field in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                  'inner', 'capture', 'metadata', 'margin', 'output'):
        cli.add_argument(field, type=Path)
    cli.add_argument('--raw', type=Path, nargs=2, metavar=('MOVIE', 'SHOW'))
    cli.add_argument('--dates', type=Path, required=True)
    run(cli.parse_args())
