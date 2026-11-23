"""Conditional credit-team randomization for the fixed personal nudge, without database access."""
import argparse
import hashlib
import json
import random
from collections import Counter, defaultdict
from functools import lru_cache
from math import isclose
from pathlib import Path
from statistics import mean, median

import nudge

REPLICATES = 99
STRATA = ('Animation', 'Documentary', 'Reality', 'Comedy', 'Crime', 'Drama',
          'Action & Adventure', 'Science Fiction')


def stratum(genres):
    for preferred in STRATA:
        if preferred in genres:
            return preferred
    return min(genres, default='Unknown')


class Credits:
    def __init__(self, canonical, metadata, genres, kind):
        self.canonical = canonical
        self.genres = {i: frozenset(genres.get(i, ())) for i in canonical}
        self.leads, self.teams, self.strata = {}, {}, {}
        for work, row in canonical.items():
            roles = nudge.roles(metadata.get(work, {}), kind)
            self.leads[work] = frozenset(p for p, r in roles.items() if r == 'lead')
            self.teams[work] = frozenset(p for p, r in roles.items() if r == 'exec')
            self.strata[work] = stratum(row['genres'])

    @lru_cache(maxsize=120_000)
    def similarity(self, target, donor):
        return .25 + .75 * nudge.lineage.overlap(self.genres[target], self.genres[donor])

    def shuffle(self, ids, seed, verify=False):
        """Make constrained team swaps. Titles with no usable alternative stay fixed."""
        original = self.teams
        reassigned = {i:original[i] for i in sorted(ids)}
        bins = defaultdict(list)
        for i, team in reassigned.items():
            if team:
                bins[self.strata[i], len(team)].append(i)
        rng = random.Random(seed)
        for members in bins.values():
            if len(members) < 2:
                continue
            for _ in range(5 * len(members)):
                a, b = rng.sample(members, 2)
                if self.leads[a].isdisjoint(reassigned[b]) and self.leads[b].isdisjoint(reassigned[a]):
                    reassigned[a], reassigned[b] = reassigned[b], reassigned[a]
            if verify:
                assert Counter(reassigned[i] for i in members) == Counter(original[i] for i in members)
                assert all(len(reassigned[i]) == len(original[i]) and
                           self.leads[i].isdisjoint(reassigned[i]) for i in members)
        moved, total = sum(len(original[i] - t) for i, t in reassigned.items()), sum(map(len, reassigned.values()))
        return reassigned, (moved, total)

    def graph(self, targets, target_teams, donors, donor_teams):
        postings = defaultdict(list)
        for work in sorted(donors):
            for p in self.leads[work]:
                postings[p].append((work, 'lead'))
            for p in donor_teams[work]:
                postings[p].append((work, 'exec'))
        graph = {}
        for target in targets:
            edges = []
            roles = [(p, 'lead') for p in self.leads[target]] + [(p, 'exec') for p in target_teams[target]]
            for p, tr in sorted(roles):
                for donor, dr in postings[p]:
                    family = self.canonical[donor]['cluster']
                    if self.canonical[target]['cluster'] == family:
                        continue
                    weight = .25 if tr != dr else (1 if tr == 'lead' else .5)
                    edges.append((p, tr, dr, donor, family, weight * self.similarity(target, donor)))
            graph[target] = edges
        return graph


def folds(credits, panel, dates):
    groups = defaultdict(list)
    for t in panel['targets']:
        groups[t['group']].append(t)
    out = []
    for group, held in groups.items():
        known = nudge.native_masks.allowed_ratings(credits.canonical, dates, held, group, panel['split'], panel['budget'])
        known = {i:stars for i, stars in known.items() if i in dates and stars == dates[i]['stars']}
        assert not known.keys() & {t['id'] for t in held}
        if panel['split'] == 'rolling-day':
            assert all(dates[i]['at'][:10] < group for i in known)
        out.append((group, held, known))
    return out


def coverage(graph, original, targets, known):
    stats = Counter()
    for t in targets:
        i = t['id']
        edges = [e for e in graph[i] if e[3] in known]
        lead_families = {e[4] for e in edges if e[1:3] == ('lead','lead')}
        ep_families = {e[4] for e in edges if 'exec' in e[1:3]}
        stats.update({'targets':1, 'hasLeadCredit':bool(original.leads[i]), 'hasExclusiveEpCredit':bool(original.teams[i]),
                      'leadToLead':bool(lead_families), 'hasAnyEpEdge':bool(ep_families),
                      'sameRoleEpEdge':any(e[1:3] == ('exec','exec') for e in edges),
                      'targetLeadDonorEp':any(e[1:3] == ('lead','exec') for e in edges),
                      'targetEpDonorLead':any(e[1:3] == ('exec','lead') for e in edges),
                      'hasAdditionalDonorFamilyFromEp':bool(ep_families - lead_families),
                      'hasTwoAdditionalFamiliesFromEp':len(ep_families - lead_families)>=2,
                      'hasEpWithNoLeadHistory':bool(ep_families) and not lead_families})
    return stats


def evaluate(targets, known, graph, leads):
    rows = []
    for t in targets:
        i, base = t['id'], t['scores']['calibrated']
        d = nudge.proposal(i, known, graph, 'combined')[0]
        lead = leads[i]
        baseline, predicted = [max(0, min(100, base + x)) for x in (lead, d)]
        actual = nudge.lineage.utility(t['stars'])
        rows.append((abs(baseline - actual) - abs(predicted - actual), t['stars'],
                     nudge.lineage.display(baseline), nudge.lineage.display(predicted)))
    return rows


def reports(rows):
    out = {}
    for name, subset in (('all', rows), ('dislike',[r for r in rows if r[1]<=2.5]),
                         ('five',[r for r in rows if r[1]==5])):
        out[name] = dict(n=len(subset), maeImprovement=mean(r[0] for r in subset) if subset else None,
                         displayUp=sum(r[3]>r[2] for r in subset), displayDown=sum(r[3]<r[2] for r in subset),
                         newRed=sum(r[3]<50<=r[2] for r in subset), loseRed=sum(r[2]<50<=r[3] for r in subset),
                         newGreen=sum(r[2]<80<=r[3] for r in subset), loseGreen=sum(r[3]<80<=r[2] for r in subset))
    return out


def summarize_null(observed, draws, movements):
    values = sorted(mean(r[0] for r in rows) for rows in draws)
    obs = observed['all']['maeImprovement']
    return dict(observedMaeImprovement=obs, nullMedian=median(values), nullRange90=[values[4], values[94]],
                upperTail=(1+sum(x>=obs for x in values))/(1+len(values)),
                meanFractionEdgesMoved=mean(m/d for m,d in movements if d))


def run_medium(kind, panels, media, genres, dates):
    primary = next(p for p in panels if p['split']=='work' and p['budget']=='all')
    dated = next(p for p in panels if p['split']=='rolling-day')
    canonical = {t['id']:t for t in primary['targets']}
    credits = Credits(canonical, media, genres, kind)
    original = credits.graph(canonical, credits.teams, canonical, credits.teams)
    independent = nudge.graph(canonical, media, genres, kind)
    assert all(sorted(original[i]) == sorted(independent[i]) for i in canonical)
    books = {}
    for panel in (primary, dated):
        panel_folds = folds(credits, panel, dates)
        tally, observed, lead = Counter(), [], {}
        for _, held, known in panel_folds:
            for t in held:
                i = t['id']
                lead[i] = nudge.proposal(i, known, original, 'lead')[0]
            observed.extend(evaluate(held, known, original, lead))
            tally.update(coverage(original, credits, held, known))
        books[panel['split']] = dict(folds=panel_folds, lead=lead, observed=reports(observed),
                                      coverage=tally, full=[], training=[], fullMovement=[], trainingMovement=[])
    for iteration in range(REPLICATES):
        seed = f'coast-ep-team:1:{kind}:{iteration}'
        alt, movement = credits.shuffle(canonical, seed, verify=iteration == 0)
        full = credits.graph(canonical, alt, canonical, alt)
        for split, book in books.items():
            full_rows, training_rows = [], []
            kept_moved = kept_edges = 0
            for group, held, known in book['folds']:
                target_ids = [r['id'] for r in held]
                alt_train, (moved, n) = credits.shuffle(known, f'{seed}:{split}:{group}', verify=iteration==0)
                kept_moved += moved
                kept_edges += n
                conditional = credits.graph(target_ids, credits.teams, known, alt_train)
                if iteration == 0:
                    for i in target_ids:
                        for g in (full, conditional):
                            assert isclose(nudge.proposal(i, known, g, 'lead')[0], book['lead'][i], abs_tol=1.e-12)
                full_rows.extend(evaluate(held, known, full, book['lead']))
                training_rows.extend(evaluate(held, known, conditional, book['lead']))
            book['full'].append(full_rows)
            book['training'].append(training_rows)
            book['fullMovement'].append(movement)
            book['trainingMovement'].append((kept_moved, kept_edges))
    return {s:dict(coverage=b['coverage'], real=b['observed'],
                   allDescriptiveCredits=summarize_null(b['observed'],b['full'],b['fullMovement']),
                   knownDonorCreditsOnly=summarize_null(b['observed'],b['training'],b['trainingMovement']))
            for s,b in books.items()}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    for key in ('capture', 'metadata', 'dates', 'graded'):
        ap.add_argument(key)
    ap.add_argument('--medium', choices=('movie','show'), required=True)
    args = ap.parse_args()
    graded = json.loads(Path(args.graded).read_bytes())
    for k in ('capture', 'metadata', 'dates'):
        assert hashlib.sha256(Path(getattr(args,k)).read_bytes()).hexdigest()==graded['manifest'][k]
    media = {x['id']:x for x in nudge.lineage.read(args.metadata)}
    genres = {r['work']['id']:{g['id'] for g in r['features'].get('genres', [])}
              for d in nudge.lineage.read(args.capture) for r in d['history']}
    dates = {x['id']:x for x in nudge.lineage.read(args.dates)}
    panels = [p for p in graded['runs'] if p['medium']==args.medium]
    print(json.dumps(run_medium(args.medium, panels, media, genres, dates), indent=2, allow_nan=False))
