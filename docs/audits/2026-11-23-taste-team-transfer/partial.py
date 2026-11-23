"""Offline transfer of prior personal dislikes across changing creative teams."""
import hashlib
import importlib.util
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean

previous = Path(__file__).resolve().parents[1] / '2026-11-23-personal-dislike-signals'
sys.path.insert(0, str(previous))
import lineage

spec = importlib.util.spec_from_file_location('exact', previous / 'lineage-exact.py')
exact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exact)
roles = {'Writer', 'Screenplay', 'Teleplay', 'Head Writer'}
arms = ('returningLead', 'returningWriter', 'similarWriters')


def overlap_half(a, b):
    union = a | b
    return bool(union) and 2 * len(a & b) >= len(union)


def index_works(metadata, capture, canonical, kind):
    facts = {}
    for i, t in canonical.items():
        m = metadata.get(i, {})
        lead = frozenset(lineage.authors(m, kind)[0])
        writers = frozenset(str(c['id']) for c in m.get('credits') or []
                            if str(c['id']).isdigit() and c['role'] in roles)
        facts[i] = (lead, writers, t['cluster'], capture.get(i, set()))
    return facts


def adjust(work, known, predicted, facts, leads, writers, team):
    l, w, fam, genres = facts[work]
    opportunities = {a: set() for a in arms}
    donors = {a: set() for a in arms}
    for persons, posting, is_lead in ((l, leads, True), (w, writers, False)):
        for person in persons:
            eligible = {j for j in posting[person] if facts[j][2] != fam}
            support = all(known[j] <= 2.5 for j in eligible)
            for j in eligible:
                other_l, other_w, _, other_genres = facts[j]
                if not l or not other_l or not overlap_half(genres, other_genres):
                    continue
                if is_lead:
                    applicable = ('returningLead',) if l != other_l else ()
                elif l.isdisjoint(other_l):
                    applicable = ('returningWriter', 'similarWriters') if overlap_half(w, other_w) else ('returningWriter',)
                else:
                    applicable = ()
                for arm in applicable:
                    opportunities[arm].add(j)
                    if support and j in predicted:
                        donors[arm].add(j)
    others = [j for j in team.get(l, ()) if facts[j][2] != fam] if l else []
    donors['exact'] = {j for j in others if overlap_half(genres, facts[j][3]) and j in predicted
                       } if all(known[j] <= 2.5 for j in others) else set()
    return opportunities, donors


def run(capture, meta, dates, graded, inner, private):
    metadata = {r['id']: r for r in meta}
    opinions = {r['id']: r for r in dates}
    receipt = {(r['medium'], r['split'], r['budget'], r['group']): r['points'] for r in inner}
    genres = {r['work']['id']: {g['id'] for g in r['features'].get('genres', [])}
              for medium in capture for r in medium['history']}
    results = []
    for kind in ('movie', 'show'):
        panels = [p for p in graded['runs'] if p['medium'] == kind]
        whole = next(p for p in panels if p['split']=='work' and p['budget']=='all')
        canonical = {r['id']: r for r in whole['targets']}
        facts = index_works(metadata, genres, canonical, kind)
        for panel in panels:
            split, budget = panel['split'], panel['budget']
            groups = defaultdict(list)
            for target in panel['targets']:
                groups[target['group']].append(target)
            counts = {a: Counter() for a in arms}
            joint = Counter()
            for group, held in groups.items():
                known = exact.allowed_ratings(canonical, opinions, held, group, split, budget)
                scores = {r['id']: r['base'] for r in receipt[kind,split,budget,group]}
                assert scores.keys() <= known.keys() and not (known.keys() & {t['id'] for t in held})
                if split == 'rolling-day':
                    assert all(opinions[i]['at'][:10] < group for i in known)
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
                    i, stars, before = target['id'], target['stars'], target['scores']['calibrated']
                    if before is None:
                        continue
                    opportunity, donors = adjust(i, known, scores, facts, leads, writers, teams)
                    after = {}
                    family_count = {}
                    for arm, titles in donors.items():
                        values = defaultdict(list)
                        for j in sorted(titles):
                            assert facts[i][2] != facts[j][2] and j != i and j in scores
                            values[facts[j][2]].append(lineage.utility(known[j]) - scores[j])
                        family_count[arm] = len(values)
                        delta = min(0., mean(mean(v) for v in values.values())) if values else 0.
                        after[arm] = lineage.display(before + delta)
                    for arm in arms:
                        c, score = counts[arm], after[arm]
                        c['scored'] += 1
                        c['eligibleCreditAndGenre'] += bool(opportunity[arm])
                        c['dislikesWithEligibleCreditAndGenre'] += bool(opportunity[arm]) and stars <= 2.5
                        c['newOpportunityAmongPreviouslyMissedDislikes'] += bool(opportunity[arm]) and stars <= 2.5 and after['exact'] >= 50
                        c['hasUnanimousScoredDonor'] += bool(family_count[arm])
                        c['twoDonors'] += family_count[arm] >= 2
                        c['changed'] += score != before
                        c['trueRed'] += stars <= 2.5 and score < 50 <= before
                        c['incrementalTrueRed'] += stars <= 2.5 and score < 50 <= after['exact']
                        c['middleNewRed'] += 2.5 < stars < 4 and score < 50 <= before
                        c['likedNewRed'] += stars >= 4 and score < 50 <= before
                        c['likedLower'] += stars >= 4 and score < before
                        c['fiveLower'] += stars == 5 and score < before
                        c['fiveLoseGreen'] += stars == 5 and score < 80 <= before
                        c['twoDonorChanges'] += family_count[arm]>=2 and score < before
                    # When several extensions qualify, choose the least negative alternative once.
                    candidates = [after[a] for a in arms if after[a] != before]
                    combined = after['exact'] if after['exact'] != before else max(candidates, default=before)
                    joint['scored'] += 1
                    joint['disliked'] += stars <= 2.5
                    joint['exactRed'] += stars <= 2.5 and after['exact'] < 50 <= before
                    joint['incrementalTrueRed'] += stars <= 2.5 and combined < 50 <= after['exact']
                    joint['incrementalNewRedMiddle'] += 2.5 < stars < 4 and combined < 50 <= after['exact']
                    joint['incrementalNewRedLiked'] += stars >=4 and combined < 50 <= after['exact']
                    joint['incrementalMiddleLowered'] += 2.5 < stars < 4 and combined < after['exact']
                    joint['incrementalLikedLowered'] += stars >= 4 and combined < after['exact']
                    joint['incrementalFiveLowered'] += stars == 5 and combined < after['exact']
                    joint['incrementalFiveLostGreen'] += stars == 5 and combined < 80 <= after['exact']
                    if candidates:
                        private.append(dict(medium=kind, split=split, budget=budget, group=group, id=i, stars=stars,
                                            before=before, after=after, combined=combined,
                                            donors={a: sorted(ids) for a, ids in donors.items()}))
            results.append(dict(medium=kind, split=split, budget=budget, arms=counts, combined=joint))
    return results


if __name__ == '__main__':
    if len(sys.argv) != 6:
        raise SystemExit('Usage: partial.py PRIVATE_CAPTURE METADATA VERIFIED_DATES GRADED INNER_SCORES')
    capture, metadata, dates, graded, inner = (lineage.read(p) for p in sys.argv[1:])
    for field, path in zip(('capture','metadata','dates'), sys.argv[1:4]):
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == graded['manifest'][field]
    private = []
    results = run(capture, metadata, dates, graded, inner, private)
    if path := os.environ.get('COAST_PARTIAL_TEAM_PRIVATE'):
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as f:
            json.dump(private, f)
    print(json.dumps(results, separators=(',',':')))
