"""Scale the frozen person/company penalty by how much closer the negative genre matches are.

Within each shared credit compare the closest examples from low-rated witness families
with every eligible title rated at least 3½ stars carrying the same credit. The role
similarity is genre-set Jaccard. A missing comparison or a tie abstains. The weaker
of the two positive margins, each divided by its negative similarity, controls the
penalty. Keep the least severe score across separately qualifying pairs.
"""
from argparse import ArgumentParser
from collections import defaultdict
import hashlib
from pathlib import Path

from credit_family_masks import family_draw
from retained_panels import retained_panels
from separate_credits import catalogue, predict, similar_genres, trait_evidence
from team_audience import display, read, write_new


def closest(target, candidates, genres, ratings, names):
    comparisons = {}
    for i in candidates:
        if genres[target] and genres[i]:
            comparisons[i] = len(genres[target] & genres[i]) / len(genres[target] | genres[i])
    if not comparisons:
        return None, []
    best = max(comparisons.values())
    return best, [dict(id=j, title=names[j], stars=ratings[j]['stars'])
                  for j in sorted(comparisons) if comparisons[j] == best]


def signed_margin(target, low, high, genres, ratings, names):
    negative, lows = closest(target, low, genres, ratings, names)
    positive, highs = closest(target, high, genres, ratings, names)
    factor = max(0, (negative - positive) / negative) if negative and positive is not None else 0
    return dict(negative=negative, positive=positive, low=lows, high=highs, factor=factor)


def main(args):
    ratings, panels = retained_panels(args)
    rows = panels['full']
    families = {r.id: r.family for r in rows}
    names = {r.id: r.title for r in rows}
    works, companies, _, genres = catalogue(read(args.capture), read(args.metadata), set(ratings))
    people_index, company_index = defaultdict(set), defaultdict(set)
    for i in ratings:
        for person in works[i][0]:
            people_index[person].add(i)
        for company in companies[i]:
            company_index[company].add(i)
    indices = people_index, company_index
    original = read(args.studio)
    masked = {(r['fraction'], r['seed']): r for r in read(args.masks)}

    def replay(rows, permitted, expected):
        evidence = {}
        for row in rows:
            if row.before < 50:
                continue
            i = row.id
            pool = {j for j in permitted if row.eligible(j)}
            assert i not in pool
            kind = {j for j in pool if similar_genres(genres[i], genres[j])}
            hard = predict(i, companies[i], pool, indices, ratings, families, works, comparable=kind)
            if 'separatePeopleAndCompanies' not in hard:
                continue
            pair_scores = []
            people = list(trait_evidence(works[i][0], people_index, pool, ratings, families, works))
            for company, *_ in trait_evidence(companies[i], company_index, pool, ratings, families, works):
                for person, *_ in people:
                    index = defaultdict(set, {person: people_index[person]}), company_index
                    kept = predict(i, [company], pool, index, ratings, families, works, comparable=kind)
                    pair = kept.get('separatePeopleAndCompanies')
                    if not pair:
                        continue
                    estimate, _, _, low_person, low_company = pair
                    def margin(low, matches):
                        high = {j for j in matches & pool if ratings[j]['stars'] >= 3.5}
                        return signed_margin(i, low, high, genres, ratings, names)
                    cast = margin(low_person, people_index[person])
                    studio = margin(low_company, company_index[company])
                    strength = min(cast['factor'], studio['factor'])
                    raw = row.before + strength * (estimate - row.before)
                    pair_scores.append(dict(person=person, company=company, cast=cast, studio=studio,
                                            strength=strength, raw=raw, hard=estimate))
            assert pair_scores and max(p['hard'] for p in pair_scores) == hard['separatePeopleAndCompanies'][0]
            raw = max(p['raw'] for p in pair_scores)
            evidence[i] = dict(title=row.title, stars=row.stars, before=row.before, hard=hard['separatePeopleAndCompanies'][0],
                               raw=raw, after=display(raw), pairs=pair_scores)
        assert {(r['id'], r['after']) for r in expected} == {(i, r['hard']) for i, r in evidence.items()}
        return evidence

    sources = {k: hashlib.sha256(getattr(args, k).read_bytes()).hexdigest() for k in INPUTS}
    out = dict(sourceHashes=sources, panels={}, masks=[])
    for split, panel in panels.items():
        assert set(original[split]['previous']) == {r.id for r in panel if r.before < 50 and r.stars <= 2.5}
        out['panels'][split] = replay(panel, ratings.keys(), original[split]['changes']['sameKindCompany'])
    for (fraction, seed), old in masked.items():
        keep = {i for i in ratings if family_draw(seed, families[i]) >= fraction}
        assert len(keep) == old['retainedDonors']
        result = out['panels']['full'] if not fraction else replay(rows, keep, old['changes'])
        out['masks'].append(dict(fraction=fraction, seed=seed, predictions=result))
    write_new(args.output, out)


INPUTS = ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
          'capture', 'metadata', 'studio', 'masks')

if __name__ == '__main__':
    parser = ArgumentParser(description=__doc__)
    for key in (*INPUTS, 'output'):
        parser.add_argument(key, type=Path)
    main(parser.parse_args())
