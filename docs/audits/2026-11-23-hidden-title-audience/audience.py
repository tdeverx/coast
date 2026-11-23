"""Pair one-title-out personal scores with held-title credit and audience adjustments."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import os
from pathlib import Path
from statistics import mean
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '2026-11-23-personal-credit-nudge'))
import crowd_local
import nudge
import residual

CAPS = (0, 2, 4, 8)
BASES = ('native', 'lead', 'guardedLead', 'exec', 'combined', 'guardedCombined')
read = nudge.lineage.read
display = nudge.lineage.display
utility = nudge.lineage.utility


def native_receipts(paths, graded, graded_hash, partial):
    expected = {(p['medium'], t['id']) for p in graded['runs'] if p['split'] == 'work' and p['budget'] == 'all'
                for t in p['targets']}
    values = {}
    seen_media = set()
    for path in paths:
        with open(path) as f:
            header = json.loads(next(f))
            medium = header['medium']
            assert header['type'] == 'receipt' and header['mode'] == 'leaveOneTitleOut'
            assert header['gradedHash'] == graded_hash and medium not in seen_media
            seen_media.add(medium)
            count = 0
            complete = False
            for line in f:
                row = json.loads(line)
                assert not complete and row['medium'] == medium
                if row['type'] == 'complete':
                    assert row['completed'] == count == header['targets']
                    complete = True
                    continue
                assert row['type'] == 'target'
                key = row['medium'], row['id']
                assert key not in values and key in expected
                values[key] = row['score']
                count += 1
            assert partial or complete
    return values, expected


def work_rows(dataset, graded, nested, titles, labels, current, native):
    medium = dataset['medium']
    panel = next(p for p in graded['runs'] if (p['medium'], p['split'], p['budget']) == (medium, 'franchise', 'all'))
    canonical = {t['id']: t for t in panel['targets']}
    # The frozen franchise grouping defines outer folds, independently of the viewer's stars.
    family_fold = defaultdict(set)
    for t in canonical.values():
        family_fold[t['cluster']].add(t['group'])
    assert all(len(v) == 1 for v in family_fold.values())
    ratings = {i: labels[i]['stars'] for i in canonical if i in labels and labels[i]['medium'] == medium}
    assert all(s == canonical[i]['stars'] for i, s in ratings.items())
    features = {row['work']['id']: row['features'] for row in dataset['history']}
    features.update({row['id']: row['features'] for row in dataset['catalogue']})
    genres = {i: {f['id'] for f in features[i].get('genres', [])} for i in canonical}
    crowd = {}
    for i in canonical:
        a = current.get(i)
        if a and isinstance(a.get('score'), (float, int)) and 0 < a['score'] <= 10 and type(a.get('votes')) is int and a['votes'] > 0:
            crowd[i] = a['score'], a['votes'], genres[i], {f['id'] for f in features[i].get('tags', [])}
    credit_graph = nudge.graph(canonical, titles, genres, medium)
    neighbours = crowd_local.make_neighbours(canonical, crowd)
    errors = {}
    for group in set(t['group'] for t in canonical.values()):
        inner = nested[medium, group]
        base_by_id = {}
        for j, s in ratings.items():
            other = canonical[j]
            if other['group'] == group:
                # This native fold omitted both the target and comparison franchises.
                assert j not in inner
                donor_forecast = other['scores']['calibrated']
            else:
                # The independent inner score omitted the entire target outer fold, plus the donor's inner franchise fold.
                donor_forecast = inner[j]
            assert donor_forecast is not None
            base_by_id[j] = utility(s) - donor_forecast
        errors[group] = base_by_id

    for work, t in canonical.items():
        key = medium, work
        if key not in native:
            continue
        score = native[key]
        known = {i: stars for i, stars in ratings.items() if canonical[i]['cluster'] != t['cluster']}
        assert work not in known
        error = {i: errors[t['group']][i] for i in known}
        credit = {'native': 0.}
        for arm in ('lead', 'exec', 'combined'):
            delta, evidence = nudge.proposal(work, known, credit_graph, arm, trace=True)
            credit[arm] = delta
            if arm != 'exec':
                credit['guarded' + arm.title()] = residual.supported_delta(delta, evidence['people'], error)
        donors = crowd_local.select_donors(neighbours[work], crowd, error, known)
        audience, votes = crowd[work][:2] if work in crowd else (None, 0)
        proposals = {cap: crowd_local.propose(audience, votes, donors, cap=cap) if audience is not None else (0., 0., 0.)
                     for cap in CAPS}
        shifts = {str(k): v[2] for k, v in proposals.items()}
        assert shifts['0'] == 0 and all(abs(shifts[str(w)]) <= w for w in CAPS)
        anchors = {name: None if score is None else display(score + d) for name, d in credit.items()}
        yield dict(id=work, medium=medium, cluster=t['cluster'], title=titles.get(work, {}).get('title'), stars=t['stars'],
                   direct=work in ratings, audience=audience, votes=votes, neighbours=len(donors),
                   deltas=credit, weights=shifts, cap4=dict(zip(('small', 'agreement', 'checked'), proposals[4])),
                   **anchors)


def analysis(rs, base, weight):
    if not rs:
        return None
    scores = [display(r[base] + r['weights'][str(weight)]) for r in rs]
    original = [r[base] for r in rs]
    stars = [r['stars'] for r in rs]
    actual = [utility(s) for s in stars]
    gain = [abs(o - a) - abs(s - a) for o, s, a in zip(original, scores, actual)]
    gaps = [s - o for s, o in zip(scores, original)]
    low = [i for i, s in enumerate(stars) if s <= 2.5]
    fives = [i for i, s in enumerate(stars) if s == 5]
    high = [i for i, s in enumerate(stars) if s >= 4]
    counts = defaultdict(Counter)
    for stars_, score in zip(stars, scores):
        counts[stars_][score] += 1
    lower, disliked = [0] * 101, [0] * 101
    ordered = polar_wins = all_pairs = polar_pairs = 0
    for s, hist in sorted(counts.items()):
        n = sum(hist.values())
        all_pairs += n * sum(lower)
        if s >= 4:
            polar_pairs += n * sum(disliked)
        cumulative = polar = 0
        for k in range(101):
            ordered += hist[k] * (cumulative + .5 * lower[k])
            if s >= 4:
                polar_wins += hist[k] * (polar + .5 * disliked[k])
            cumulative += lower[k]
            polar += disliked[k]
        for k, c in hist.items():
            lower[k] += c
            if s <= 2.5:
                disliked[k] += c
    return dict(n=len(rs), mae=mean(abs(a-b) for a,b in zip(scores, actual)),
                literalStarMae=mean(abs(s/20 - r) for s,r in zip(scores, stars)),
                closer=sum(x>0 for x in gain), further=sum(x<0 for x in gain),
                equal=gain.count(0), different=sum(d != 0 for d in gaps),
                low=len(low), lowDown=sum(gaps[i] < 0 for i in low), lowUp=sum(gaps[i] > 0 for i in low),
                lowRed=sum(scores[i] < 50 for i in low),
                highNewRed=sum(scores[i] < 50 <= original[i] for i in high),
                five=len(fives), fiveDown=sum(gaps[i] < 0 for i in fives),
                fiveUp=sum(gaps[i] > 0 for i in fives),
                fiveLostGreen=sum(scores[i] < 80 <= original[i] for i in fives),
                fiveGainedGreen=sum(original[i] < 80 <= scores[i] for i in fives),
                pairs=all_pairs, orderWins=ordered, polarPairs=polar_pairs, polarWins=polar_wins)


def summarise(rows):
    out = {}
    for cohort, test in [('direct', lambda r: r['direct']), ('allHistoricalRoots', lambda r: True)]:
        out[cohort] = {}
        for medium in ('movie', 'show', 'pooled'):
            selected = [r for r in rows if test(r) and (medium == 'pooled' or r['medium'] == medium)]
            scored = [r for r in selected if r['native'] is not None]
            entry = dict(titles=len(selected), scoreable=len(scored), withVotes=sum(bool(r['votes']) for r in scored),
                         arms={b: {str(w): analysis(scored, b, w) for w in CAPS} for b in BASES})
            # Only within-medium pair ordering is meaningful; pooled contains only error and movement measures.
            if medium == 'pooled':
                for views in entry['arms'].values():
                    for v in views.values():
                        if v is not None:
                            for name in ('pairs', 'orderWins', 'polarPairs', 'polarWins'):
                                del v[name]
            out[cohort][medium] = entry
    return out


def private_write(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
        json.dump(value, f, separators=(',', ':'), allow_nan=False)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('capture', 'metadata', 'graded', 'nested', 'verified', 'tmdb', 'private_ledger'):
        cli.add_argument(name)
    cli.add_argument('native', nargs='+', help='One or more complete per-title native JSONL streams.')
    cli.add_argument('--partial', action='store_true', help='Permit intermediate coverage for diagnostics.')
    args = cli.parse_args()
    graded = read(args.graded)
    for k in ('capture', 'metadata'):
        assert hashlib.sha256(Path(getattr(args, k)).read_bytes()).hexdigest() == graded['manifest'][k]
    titles = {r['id']: r for r in read(args.metadata)}
    verified = read(args.verified)
    labs = {r['id']: r for r in verified['ratings']}
    assert len(labs) == len(verified['ratings']) == 870
    current_doc = read(args.tmdb)
    current = {r['id']: r for r in current_doc['rows']}
    assert len(current) == len(current_doc['rows'])
    if 'accountKey' in current_doc:
        assert current_doc['accountKey'] == verified['accountKey']
    nested = {(r['medium'], r['group']): {p['id']: p['base'] for p in r['points']} for r in read(args.nested)
              if r['split'] == 'franchise' and r['budget'] == 'all'}
    native, expected = native_receipts(args.native, graded, hashlib.sha256(Path(args.graded).read_bytes()).hexdigest(),
                                      args.partial)
    if not args.partial:
        assert native.keys() == expected
    rows = [row for d in read(args.capture) for row in work_rows(d, graded, nested, titles, labs, current, native)]
    assert len(rows) == len(native) and (args.partial or sum(r['direct'] for r in rows) == len(labs))
    private_write(args.private_ledger, rows)
    print(json.dumps(summarise(rows), separators=(',', ':'), allow_nan=False))
