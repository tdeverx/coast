"""Do other similarly categorised works with the same composer or cinematographer support a negative call?"""
from collections import Counter, defaultdict
from pathlib import Path
import argparse

from retained_panels import retained_panels
from separate_credits import similar_genres
from team_audience import read, write_new


def catalogue(capture, metadata, direct):
    roles = {'Original Music Composer': 'composers', 'Director of Photography': 'cinematographers'}
    provider = {r['id']: r.get('credits') or [] for r in metadata if r['id'] in direct}
    credited, genres, index = {}, {}, defaultdict(set)
    for panel in capture:
        source = {r['work']['id']: r['features'] for r in panel['history']}
        source.update({r['id']: r['features'] for r in panel['catalogue']})
        for i in direct.keys() & source.keys():
            features = source[i]
            genres[i] = {v['id'] for v in features.get('genres', [])}
            entries = set()
            for department in roles.values():
                people = {str(p['id']) for p in provider.get(i, []) if roles.get(p['role']) == department
                          and str(p['id']).isdigit()}
                if not people:
                    people = {p['id'][5:] for p in features.get(department, []) if p['id'].startswith('tmdb:')
                              and p['id'][5:].isdigit()}
                for person in people:
                    entries.add((department, person))
                    index[department, person].add(i)
            credited[i] = entries
    assert credited.keys() == direct.keys() == genres.keys()
    return credited, genres, index


def inspect(held, eligible, direct, family, credited, genres, index):
    findings = []
    for role, person in sorted(credited[held.id]):
        by_family = defaultdict(list)
        for j in eligible & index[role, person]:
            if similar_genres(genres[j], genres[held.id]):
                by_family[family[j]].append(j)
        if len(by_family) < 2:
            continue
        observations = [[direct[j]['stars'] for j in members] for members in by_family.values()]
        lows = sum(max(votes) <= 2.5 for votes in observations)
        highs = sum(min(votes) >= 4 for votes in observations)
        negative = lows >= 2 and 2*lows > len(observations) and all(max(votes) < 4 for votes in observations)
        positive = highs >= 2 and 2*highs > len(observations) and all(min(votes) > 2.5 for votes in observations)
        findings.append(dict(role=role, person=person, families=len(observations), lows=lows, highs=highs,
                             negative=negative, positive=positive, donors=sorted(i for ids in by_family.values() for i in ids)))
    return findings


def replay(args):
    direct, panels = retained_panels(args)
    earlier = read(args.previous)
    credited, genres, index = catalogue(read(args.capture), read(args.metadata), direct)
    family = {r.id: r.family for r in panels['full']}
    output = {}
    for split, rows in panels.items():
        tentative = {r['id']:r for r in earlier[split]['changes']['providerIdentity']}
        kept = {r['id']:r for r in earlier[split]['changes']['sameKindCompany']}
        metrics = {name: Counter() for name in ('prior', 'standaloneOnPrior', 'vetoOnRaw', 'corroborateRaw')}
        coverage, cases = defaultdict(Counter), []
        for r in rows:
            prior = kept[r.id]['after'] if r.id in kept else r.before
            raw = tentative.get(r.id)
            allowed = {j for j in direct if r.eligible(j)}
            assert r.id not in allowed
            evidence = inspect(r, allowed, direct, family, credited, genres, index)
            neg, pos = any(e['negative'] for e in evidence), any(e['positive'] for e in evidence)
            scores = dict(prior=prior, standaloneOnPrior=49 if prior >= 50 and neg and not pos else prior,
                          vetoOnRaw=r.before, corroborateRaw=r.before)
            corroboration = []
            if raw:
                excluded = {family[j] for j in raw['personDonors'] + raw['companyDonors']}
                independent = {j for j in allowed if family[j] not in excluded}
                corroboration = inspect(r, independent, direct, family, credited, genres, index)
                yes = any(e['positive'] for e in corroboration)
                no = any(e['negative'] for e in corroboration)
                if not yes:
                    scores['vetoOnRaw'] = raw['after']
                    if no:
                        scores['corroborateRaw'] = raw['after']
            for method, score in scores.items():
                tally = metrics[method]
                tally['total'] += 1
                tally['dislikeRed'] += score < 50 and r.stars <= 2.5
                tally['oldRedIntact'] += r.before < 50 and r.stars <= 2.5 and score == r.before
                tally['candidateIntact'] += r.id in kept and score == prior
                tally['extraDislikeRed'] += score < 50 <= prior and r.stars <= 2.5
                tally['likedLowered'] += score < prior and r.stars > 3
                tally['fiveLowered'] += score < prior and r.stars == 5
                tally['threeLowered'] += score < prior and r.stars == 3
            category = 'dislike' if r.stars <= 2.5 else 'liked' if r.stars > 3 else 'neutral'
            coverage[category]['credited'] += bool(credited[r.id])
            coverage[category]['repeated'] += bool(evidence)
            coverage[category]['twoLows'] += any(e['lows'] >= 2 for e in evidence)
            coverage[category]['negative'] += neg
            coverage[category]['positive'] += pos
            if raw or neg or any(e['lows'] >= 2 for e in evidence) or (prior >= 50 and r.stars <= 2.5):
                cases.append(dict(id=r.id, title=r.title, stars=r.stars, before=r.before, scores=scores,
                                  evidence=evidence, independent=corroboration))
        output[split] = dict(metrics=metrics, coverage=coverage, cases=cases)
        print(split, {name: (m['dislikeRed'], m['likedLowered'], m['threeLowered']) for name, m in metrics.items()})
    write_new(args.output, output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                  'capture', 'metadata', 'previous', 'output'):
        parser.add_argument(field, type=Path)
    replay(parser.parse_args())
