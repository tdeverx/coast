"""Inspect the two named show holdouts with independent, title-and-donor-excluded errors."""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '2026-11-23-personal-credit-nudge'))
import crowd_local
import nudge
import residual


def write_new(path, value):
    with os.fdopen(os.open(path, os.O_EXCL | os.O_CREAT | os.O_WRONLY, 0o600), 'w') as f:
        json.dump(value, f, separators=(',', ':'), allow_nan=False)


def inspect(args):
    media = {r['id']: r for r in nudge.lineage.read(args.credits)}
    names = {r['title']: i for i, r in media.items() if r['kind'] == 'show'}
    ratings = {r['id']: r['stars'] for r in nudge.lineage.read(args.ratings)['ratings']
               if r['medium'] == 'show' and r['at'] and r['stars'] is not None}
    cap = next(d for d in nudge.lineage.read(args.capture) if d['medium'] == 'show')
    features = {r['work']['id']: r['features'] for r in cap['history']}
    features.update({r['id']: r['features'] for r in cap['catalogue']})
    panels = nudge.lineage.read(args.graded)['runs']
    whole = next(p for p in panels if p['medium'] == 'show' and p['split'] == 'franchise' and p['budget'] == 'all')
    canon = {r['id']: r for r in whole['targets']}
    a = {r['id']: r for r in nudge.lineage.read(args.audience)['rows'] if r.get('score') and r.get('votes')}
    genres = {i: {t['id'] for t in f.get('genres', [])} for i, f in features.items()}
    tags = {i: {t['id'] for t in f.get('tags', [])} for i, f in features.items()}
    metadata = {i: (a[i]['score'], a[i]['votes'], genres[i], tags[i]) for i in canon if i in a}
    graph = nudge.graph(canon, media, genres, 'show')
    fit_index = {}
    if args.native:
        native = [json.loads(s) for s in Path(args.native).read_text().splitlines()]
        assert native[0]['mode'] == 'jointExclusion' and native[0]['medium'] == 'show'
        assert native[0]['gradedHash'] == hashlib.sha256(Path(args.graded).read_bytes()).hexdigest()
        if not args.primary_only:
            assert native[-1]['type'] == 'complete'
        for r in native[1:]:
            if r['type'] == 'complete':
                continue
            key = r['target'], tuple(r['extraExcluded'])
            record = fit_index.setdefault(key, {'donors': {}})
            if r['type'] == 'named':
                assert 'target' not in record
                record['target'] = r
            elif r['type'] == 'donor':
                assert r['id'] not in record['donors']
                record['donors'][r['id']] = r['score']
    requests, rows = [], []
    for title, hide in [('Farzar', []), ('Rick and Morty', []), ('Rick and Morty', ['President Curtis'])]:
        if hide and args.primary_only:
            continue
        i, excluded = names[title], [names[s] for s in hide]
        mask = {j: s for j, s in ratings.items() if j != i and j not in excluded and canon[j]['cluster'] != canon[i]['cluster']}
        assert not (mask.keys() & {i, *excluded})
        credit, witnesses = {}, set()
        for arm in nudge.ARMS:
            delta, trace = nudge.proposal(i, mask, graph, arm, trace=True)
            credit[arm] = (delta, trace['people'])
            witnesses.update(d['id'] for p in trace['people'] for d in p['donors'])
        # Reserve extra candidate witnesses using metadata overlap only. A refreshed provider
        # record may restore a previously missing public vote count and change the first twelve.
        all_metadata = {j: (None, None, genres[j], tags[j]) for j in canon}
        top = crowd_local.work_neighbours(i, canon, all_metadata, mask)
        families = set()
        for _, j, family in top:
            if family in families:
                continue
            witnesses.add(j)
            families.add(family)
            if len(families) == 16:
                break
        requests.append(dict(target=i, donors=sorted(witnesses), extraExcluded=excluded))
        if not args.native:
            continue
        native = fit_index[i, tuple(excluded)]
        assert witnesses <= native['donors'].keys()
        root = native['target']
        errors = {j: nudge.lineage.utility(mask[j]) - b for j, b in native['donors'].items() if b is not None}
        assert all(j in mask for j in witnesses)
        nearest = crowd_local.work_neighbours(i, canon, metadata, mask)
        eligible, used_families = [], set()
        for _, j, family in nearest:
            if family not in used_families:
                if j not in errors:
                    raise ValueError('Missing double-excluded donor forecast; expand named witness request.')
                eligible.append(j)
                used_families.add(family)
                if len(eligible) == 12:
                    break
        donors = crowd_local.select_donors(nearest, metadata, errors, mask)
        source = a.get(i)
        shifts = {w: crowd_local.propose(source['score'], source['votes'], donors, cap=w)
                  if source else (0, 0, 0) for w in (0, 2, 4, 8)}
        variants = {}
        raw_base = root['score']
        pers = {str(p['id']): p['name'] for p in media[i].get('credits') or []}
        for arm, (delta, people) in credit.items():
            supported = residual.supported_delta(delta, people, errors)
            trace = [{'name': pers[p['id']], 'role': p['role'], 'contribution': p['delta'] * p['share'],
                      'donors': [dict(title=media[d['id']]['title'], stars=d['stars'], role=d['role']) for d in p['donors']]}
                     for p in people]
            variants[arm] = dict(rawDelta=delta, checkedDelta=supported, people=trace)
        displays = {}
        for name, delta in [('plain', 0), ('lead', credit['lead'][0]), ('combined', credit['combined'][0]),
                            ('checkedLead', variants['lead']['checkedDelta']),
                            ('checkedCombined', variants['combined']['checkedDelta'])]:
            baseline = nudge.lineage.display(raw_base + delta)
            displays[name] = {w: nudge.lineage.display(baseline + x[-1]) for w, x in shifts.items()}
        rows.append(dict(title=title, extraHidden=hide, native=root, stars=ratings[i], audience=source,
                         credit=variants, publicComponent=shifts, scores=displays,
                         donors=[dict(title=media[j]['title'], stars=mask[j], reception=metadata[j][0],
                                      votes=metadata[j][1], independent=native['donors'][j]) for j in eligible]))
    write_new(args.output, rows if args.native else requests)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for a in ('capture', 'credits', 'ratings', 'graded', 'audience', 'output'):
        cli.add_argument(a)
    cli.add_argument('--native', help='Completed named native JSONL. Without it, emit the native fit requests.')
    cli.add_argument('--primary-only', action='store_true',
                     help='Evaluate the two primary comparisons as soon as every required donor forecast is present.')
    inspect(cli.parse_args())
