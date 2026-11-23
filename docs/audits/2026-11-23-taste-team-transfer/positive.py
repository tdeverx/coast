"""Positive transfer of personal fit across an identical creative team and similar genre."""
import hashlib
import importlib.util
import json
import os
import re
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from statistics import mean

prior = Path(__file__).resolve().parents[1] / '2026-11-23-personal-dislike-signals'
sys.path.insert(0, str(prior))
import lineage

spec = importlib.util.spec_from_file_location('exact_team', prior / 'lineage-exact.py')
exact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exact)


def proposal(work, team_history, rating, native, crews, family, genres, dates, cutoff=None, forward=None, allowed=None):
    team = crews[work]
    members = [j for j in team_history.get(team, ()) if family[work] != family[j]
               and (cutoff is None or dates[j][:10] < cutoff)]
    if not members:
        return 0., [], 0
    sign = 1 if all(rating[j] >= 4.5 for j in members) else -1 if all(rating[j] <= 2.5 for j in members) else 0
    if not sign:
        return 0., [], 0
    donors = defaultdict(list)
    for j in members:
        if j not in native or (forward is not None and j not in forward):
            continue
        if lineage.overlap(genres[work], genres[j]) >= .5 and (allowed is None or allowed(work,j)):
            donors[family[j]].append(j)
    if not donors:
        return 0., [], 0
    errors = [mean(lineage.utility(rating[j]) - native[j] for j in works) for works in donors.values()]
    delta = sign * max(0., sign * mean(errors))
    return delta, sorted(j for works in donors.values() for j in works), len(donors)


def other_team_stats(history, rating, native, crews, family, genres, dates, dated, allowed):
    by_team = defaultdict(lambda: defaultdict(list))
    for i, prediction in native.items():
        cutoff = dates[i][:10] if dated else None
        delta, _, _ = proposal(i, history, rating, native, crews, family, genres, dates, cutoff, allowed=allowed)
        if delta > 0:
            error = lineage.utility(rating[i]) - prediction
            by_team[crews[i]][family[i]].append((delta * error, delta * delta))
    return {team: [mean(mean(row[c] for row in obs) for obs in groups.values()) for c in (0, 1)]
            for team, groups in by_team.items()}


def multiplier(held_team, summaries):
    other = [v for team, v in summaries.items() if team != held_team]
    if len(other) < 8:
        return 0.
    xy, xx = map(sum, zip(*other))
    return min(1., xy / xx) if 2*xy > xx and xx > 0 else 0.


def metrics(records, arm):
    groups, counts = defaultdict(list), Counter()
    teams, pairs, donors, recipients = set(), set(), set(), set()
    gain_teams, weak_teams = Counter(), Counter()
    shifts = defaultdict(list)
    for r in records:
        base, score, s = r['base'], r[arm], r['stars']
        groups[r['group']].append((s, score, base))
        counts.update({'scored':1, 'changed':score != base, 'five':s == 5,
                       'fiveMissed':s == 5 and base < 80, 'fiveRecovered':s == 5 and base < 80 <= score,
                       'fiveLost':s == 5 and score < 80 <= base, 'dislikes':s <= 2.5,
                       'dislikesRaised':s <= 2.5 and score > base,
                       'dislikesNewGreen':s <= 2.5 and base < 80 <= score,
                       'weakNewGreen':s <= 3 and base < 80 <= score,
                       'middleNewGreen':s == 3.5 and base < 80 <= score,
                       'likedNewRed':s >= 4 and score < 50 <= base,
                       'dislikesNewRed':s <= 2.5 and score < 50 <= base,
                       'newGreen':base < 80 <= score})
        shifts['absoluteError'].append(abs(score - lineage.utility(s)) - abs(base - lineage.utility(s)))
        if score != base:
            teams.add(r['team']); recipients.add(r['id'])
            current_donors = r['forwardDonors'] if arm == 'forward' else r['donors']
            donors.update(current_donors)
            for j in current_donors:
                pairs.add(tuple(sorted((r['id'], j))))
            if s == 5 and base < 80 <= score:
                gain_teams[r['team']] += 1
            if s <= 3 and base < 80 <= score:
                weak_teams[r['team']] += 1
    pairs_evaluated = wins = 0
    for group in groups.values():
        for (a, x, _), (b, y, _) in combinations(group, 2):
            if a != b:
                pairs_evaluated += 1
                wins += .5 if x == y else int((a - b) * (x - y) > 0)
    return {'counts':dict(counts), 'order':round(wins/pairs_evaluated,5) if pairs_evaluated else None,
            'meanAbsoluteErrorChange':round(mean(shifts['absoluteError']),3) if records else None,
            'changedCoverage':dict(teams=len(teams),recipients=len(recipients),donors=len(donors),
                                   unorderedPairs=len(pairs),fiveGainTeams=len(gain_teams),weakGreenTeams=len(weak_teams),
                                   fiveGainsWithoutLargestTeam=sum(gain_teams.values())-max(gain_teams.values(),default=0))}


def replay(capture, metadata, date_rows, graded, inner, cautious=False):
    meta = {r['id']:r for r in metadata}
    dates = {r['id']:r for r in date_rows}
    rating_date = {i:v['at'] for i,v in dates.items()}
    diagnostics, changes = [], []
    receipts = {(r['medium'],r['split'],r['budget'],r['group']):r['points'] for r in inner}
    for dataset in capture:
        medium = dataset['medium']
        panels = [r for r in graded['runs'] if r['medium'] == medium]
        work = next(r for r in panels if r['split'] == 'work' and r['budget'] == 'all')
        canonical = {t['id']:t for t in work['targets']}
        family = {i:t['cluster'] for i,t in canonical.items()}
        crews = {i:tuple(sorted(lineage.authors(meta.get(i, {}), medium)[0])) for i in canonical}
        genres = {r['work']['id']:{g['id'] for g in r['features'].get('genres', [])} for r in dataset['history']}
        cast = {r['work']['id']:{g['id'] for g in r['features'].get('cast', [])} for r in dataset['history']}
        tags = {r['work']['id']:{g['name'].lower().replace('-', ' ') for g in r['features'].get('tags', [])}
                for r in dataset['history']}
        words = {i: next((s for s in re.findall(r'\w+',meta[i]['title'].lower()) if s not in ('the','a','an')), '')
                 for i in canonical}
        def independent(i, j):
            return (cast[i] and cast[j] and not (cast[i] & cast[j]) and words[i] != words[j]
                    and 'spin off' not in tags[i] | tags[j]
                    and not any('universe' in s for s in tags[i] & tags[j]))
        allowed = independent if cautious else None
        for panel in panels:
            split, budget = panel['split'], panel['budget']
            dated = split == 'rolling-day'
            groups = defaultdict(list)
            for t in panel['targets']:
                groups[t['group']].append(t)
            previous_forecasts, records = {}, []
            for group, targets in sorted(groups.items()):
                rating = exact.allowed_ratings(canonical, dates, targets, group, split, budget)
                native = {p['id']:p['base'] for p in receipts[medium,split,budget,group]}
                assert set(native) <= set(rating)
                assert not rating.keys() & {t['id'] for t in targets}
                if dated:
                    assert all(rating_date[i][:10] < group for i in rating)
                    assert all(native[i] == value for i,value in previous_forecasts.items())
                history = defaultdict(list)
                for i in sorted(rating):
                    if crews[i]:
                        history[crews[i]].append(i)
                calibration = other_team_stats(history,rating,native,crews,family,genres,rating_date,dated,allowed)
                for t in targets:
                    i, base = t['id'], t['scores']['calibrated']
                    if base is None:
                        continue
                    delta, donors, n = proposal(i,history,rating,native,crews,family,genres,rating_date,allowed=allowed)
                    assert all(family[j] != family[i] for j in donors)
                    up = max(0., delta)
                    mult = multiplier(crews[i], calibration)
                    row = dict(id=i, title=meta[i]['title'], stars=t['stars'], team=crews[i], group=group, base=base,
                               one=lineage.display(base+up), two=lineage.display(base+(up if n>=2 else 0.)),
                               symmetric=lineage.display(base+delta), calibrated=lineage.display(base+mult*up),
                               donors=donors, forwardDonors=[], donorFamilies=n)
                    if dated:
                        then, prior_donors, _ = proposal(i,history,rating,native,crews,family,genres,rating_date,
                                                        forward=previous_forecasts,allowed=allowed)
                        row.update(forward=lineage.display(base+max(0.,then)),forwardDonors=prior_donors)
                    records.append(row)
                    if delta or (dated and row['forward'] != base):
                        changes.append({**row,'medium':medium,'split':split,'budget':budget})
                if dated:
                    previous_forecasts.update((t['id'],t['scores']['calibrated']) for t in targets
                                              if t['scores']['calibrated'] is not None)
            arms = ['base','one','two','calibrated','symmetric'] + (['forward'] if dated else [])
            diagnostics.append(dict(medium=medium,split=split,budget=budget,
                                    arms={arm:metrics(records,arm) for arm in arms}))
    return diagnostics, changes


if __name__ == '__main__':
    cautious = '--independence' in sys.argv
    if cautious:
        sys.argv.remove('--independence')
    if len(sys.argv) != 6:
        raise SystemExit('Usage: positive.py [--independence] SOLO_CAPTURE METADATA DATES GRADED LINEAGE_INNER')
    capture, metadata, dates, graded, inner = (lineage.read(path) for path in sys.argv[1:])
    for field, path in zip(('capture','metadata','dates'),sys.argv[1:4]):
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == graded['manifest'][field]
    diagnostics, changes = replay(capture, metadata, dates, graded, inner, cautious)
    if path := os.environ.get('COAST_POSITIVE_PRIVATE'):
        with os.fdopen(os.open(path,os.O_WRONLY | os.O_CREAT | os.O_EXCL,0o600),'w') as f:
            json.dump(changes,f,separators=(',',':'))
    print(json.dumps(diagnostics,separators=(',',':')))
