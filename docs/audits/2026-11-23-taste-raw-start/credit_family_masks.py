"""Rerun the studio/performer rule after masking other franchise ratings, including newly eligible works."""
from argparse import ArgumentParser
from collections import defaultdict
import hashlib
from pathlib import Path

from retained_panels import retained_panels
from separate_credits import catalogue, predict, similar_genres
from team_audience import read, write_new


def family_draw(seed, family):
    digest = hashlib.sha256(f'{seed}|{family}'.encode()).digest()
    return int.from_bytes(digest[:8], 'big') / 2**64


def run(args):
    ratings, panels = retained_panels(args)
    rows = panels['full']
    families = {r.id: r.family for r in rows}
    works, by_role, _, genres = catalogue(read(args.capture), read(args.metadata), set(ratings))
    indices = defaultdict(set), defaultdict(set)
    for i in ratings:
        for trait in works[i][0]:
            indices[0][trait].add(i)
        for trait in by_role[i]:
            indices[1][trait].add(i)
    eligible = {r.id: {j for j in ratings if r.eligible(j)} for r in rows if r.before >= 50}
    comparable = {i: {j for j in donors if similar_genres(genres[i], genres[j])} for i, donors in eligible.items()}
    reference = read(args.studio)['full']
    assert sorted(r.id for r in rows if r.before < 50 and r.stars <= 2.5) == reference['previous']
    samples = []
    for fraction, seeds in ((0, range(1)), (.1, range(16)), (.25, range(16))):
        for seed in seeds:
            keep = {i for i in ratings if family_draw(seed, families[i]) >= fraction}
            changes = []
            for r in rows:
                if r.before < 50:
                    continue
                result = predict(r.id, by_role[r.id], eligible[r.id] & keep, indices, ratings, families, works,
                                 comparable=comparable[r.id])
                estimate = result.get('separatePeopleAndCompanies')
                if estimate:
                    changes.append(dict(id=r.id, title=r.title, stars=r.stars, before=r.before, after=estimate[0]))
            if fraction == 0:
                assert {(r['id'], r['after']) for r in changes} == {
                    (r['id'], r['after']) for r in reference['changes']['sameKindCompany']}
            samples.append(dict(fraction=fraction, seed=seed, retainedDonors=len(keep), changes=changes))
    write_new(args.output, samples)


if __name__ == '__main__':
    cli = ArgumentParser(description=__doc__)
    for key in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                'capture', 'metadata', 'studio', 'output'):
        cli.add_argument(key, type=Path)
    run(cli.parse_args())
