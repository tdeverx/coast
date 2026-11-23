"""Replay the frozen exact and returning-team corrections with current public reception.

Requires the original capture, metadata, verified rating dates, graded forecast and inner
donor forecasts, plus the saved partial exceptions and refreshed public vote snapshot.
Individual score output is private. The archived folds are overlapping sensitivity tests.
"""
import argparse
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
from statistics import mean
import sys

audits = Path(__file__).resolve().parents[1]
for path in ('2026-11-23-taste-team-transfer', '2026-11-23-personal-credit-nudge',
             '2026-11-23-hidden-title-audience'):
    sys.path.insert(0, str(audits / path))
import blend
import crowd_local
import partial


def replay(args):
    read = partial.lineage.read
    graded = read(args.graded)
    for k in ('capture', 'metadata', 'dates'):
        assert hashlib.sha256(Path(getattr(args, k)).read_bytes()).hexdigest() == graded['manifest'][k]
    meta = {r['id']: r for r in read(args.metadata)}
    dates = {r['id']: r for r in read(args.dates)}
    pub = {r['id']: r for r in read(args.tmdb)['rows']}
    inner = {(r['medium'], r['split'], r['budget'], r['group']): r['points'] for r in read(args.inner)}
    exceptions = {(r['medium'], r['split'], r['budget'], r['group'], r['id']): r for r in read(args.saved)}
    old = {(r['medium'], r['split'], r['budget']): r['combined']
           for r in read(audits / '2026-11-23-taste-team-transfer/partial-results.json')}
    seen = set()
    result = []
    utility, display = partial.lineage.utility, partial.lineage.display
    for dataset in read(args.capture):
        medium = dataset['medium']
        panels = [p for p in graded['runs'] if p['medium'] == medium]
        if not panels:
            continue
        canonical = {r['id']: r for p in panels if (p['split'], p['budget']) == ('work','all')
                     for r in p['targets']}
        genres = {r['work']['id']: {g['id'] for g in r['features'].get('genres', [])} for r in dataset['history']}
        features = {r['work']['id']: r['features'] for r in dataset['history']}
        features.update({r['id']: r['features'] for r in dataset['catalogue']})
        crowd = {i: (pub[i]['score'], pub[i]['votes'], *({g['id'] for g in features[i].get(k, [])}
                                                         for k in ('genres', 'tags')))
                 for i in canonical if i in pub and pub[i]['votes'] > 0}
        graph = crowd_local.make_neighbours(canonical, crowd)
        facts = partial.index_works(meta, genres, canonical, medium)
        for p in panels:
            split, budget = p['split'], p['budget']
            start = len(result)
            groups = defaultdict(list)
            for t in p['targets']:
                groups[t['group']].append(t)
            for g, held in groups.items():
                known = partial.exact.allowed_ratings(canonical, dates, held, g, split, budget)
                forecasts = {r['id']: r['base'] for r in inner[medium, split, budget, g]}
                assert forecasts.keys() <= known.keys() and not (known.keys() & {t['id'] for t in held})
                errors = {j: utility(known[j]) - v for j, v in forecasts.items()}
                leads, writers, teams = defaultdict(list), defaultdict(list), defaultdict(list)
                for j in known:
                    lead, writing, _, _ = facts[j]
                    if lead:
                        teams[lead].append(j)
                    for person in lead:
                        leads[person].append(j)
                    for person in writing:
                        writers[person].append(j)
                for target in held:
                    i, base = target['id'], target['scores']['calibrated']
                    if base is None:
                        continue
                    _, donors = partial.adjust(i, known, forecasts, facts, leads, writers, teams)
                    after = {}
                    for arm, ids in donors.items():
                        families = defaultdict(list)
                        for j in sorted(ids):
                            families[facts[j][2]].append(errors[j])
                        delta = min(0., mean(mean(v) for v in families.values())) if families else 0.
                        after[arm] = display(base + delta)
                    extensions = [after[a] for a in partial.arms if after[a] != base]
                    team = after['exact'] if after['exact'] != base else max(extensions, default=base)
                    if extensions:
                        key = (medium, split, budget, g, i)
                        assert after == exceptions[key]['after'] and team == exceptions[key]['combined']
                        seen.add(key)
                    score, votes = crowd[i][:2] if i in crowd else (None, 0)
                    public_fit = 50 + (utility(score / 2) - 50) * votes / (votes + 50) if votes else None
                    neighbours = crowd_local.select_donors(graph[i], crowd, errors, known)
                    proposals = {w: crowd_local.propose(score, votes, neighbours, cap=w)[2] if votes else 0
                                 for w in (4,8)}
                    r = dict(medium=medium, split=split, budget=budget, group=g, id=i, title=meta[i]['title'],
                             stars=target['stars'], base=base, exact=after['exact'], team=team, audience=score, votes=votes,
                             checked8Delta=proposals[8])
                    r.update({f'cap{w}': display(team + d) for w,d in proposals.items()})
                    r.update({f'blend{w}': blend.blend(r, w, 'team') for w in (20, 40)})
                    r['veto'] = base if team < base and public_fit is not None and public_fit > base else team
                    result.append(r)
            # Ensure the re-created corrections reproduce every published panel.
            group_rows = result[start:]
            ref = old[medium, split, budget]
            assert len(group_rows) == ref['scored']
            assert sum(r['stars'] <= 2.5 and r['exact'] < 50 <= r['base'] for r in group_rows) == ref['exactRed']
            assert sum(r['stars'] >= 4 and r['team'] < r['exact'] for r in group_rows) == ref['incrementalLikedLowered']
    assert seen == set(exceptions)
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('capture', 'metadata', 'dates', 'graded', 'inner', 'saved', 'tmdb', 'private_output'):
        p.add_argument(name)
    args = p.parse_args()
    rows = replay(args)
    with os.fdopen(os.open(args.private_output, os.O_CREAT | os.O_WRONLY | os.O_EXCL, 0o600),'w') as f:
        json.dump(rows, f, separators=(',', ':'), allow_nan=False)
    print(f'{len(rows)} scored appearances across {len({(r["medium"],r["split"],r["budget"]) for r in rows})} panels')
