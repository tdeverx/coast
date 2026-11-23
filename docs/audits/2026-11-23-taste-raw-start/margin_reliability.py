"""Test the reliability of a plot similarity lead on independent works before using it to lower a score.

Treat an incorrect dislike warning as twice as costly as missing a dislike. A lead receives
weight only above the two-thirds break-even point, scaling linearly from zero to one there.
Compare historical precision with a more cautious one-sided 90% Wilson lower bound.
"""
import argparse
from collections import Counter, defaultdict
from math import sqrt
from pathlib import Path
from statistics import NormalDist

import numpy as np

from credit_family_masks import family_draw
from retained_panels import retained_panels
from team_audience import display, read, write_new


def cosine_matrix(embeddings, ids):
    vectors = dict(zip(map(str, embeddings['ids']), embeddings['emb'], strict=True))
    matrix = np.stack([vectors[i] for i in ids]).astype(float)
    lengths = np.linalg.norm(matrix, axis=1)
    matrix /= np.maximum(1e-12, lengths)[:, None]
    result = matrix @ matrix.T
    result[lengths == 0, :] = np.nan
    result[:, lengths == 0] = np.nan
    return result


def closest(similarity, mask):
    ix = np.flatnonzero(mask & np.isfinite(similarity))
    if not len(ix):
        return None
    best = similarity[ix].max()
    ties = ix[np.abs(similarity[ix] - best) <= 1e-12]
    return int(ties[0]) if len(ties) == 1 else None


def relative_margin(similarity, eligible, low, liked):
    negative = closest(similarity, eligible & low)
    positive = closest(similarity, eligible & liked)
    if negative is None or positive is None or similarity[negative] <= 0:
        return 0., negative, positive
    bad = similarity[negative]
    good = max(0., similarity[positive])
    return max(0., (bad - good) / bad), negative, positive


def estimates(warnings, families):
    # A family vote is a success only if every relevant work in it got <=2.5 stars.
    if not families:
        return 0., 0.
    rate = warnings / families
    z = NormalDist().inv_cdf(.90)
    lower = (rate + z*z/(2*families) - z*sqrt((rate*(1-rate) + z*z/(4*families))/families)) / (1 + z*z/families)
    return rate, lower


def assess(row, proposed, witnesses, keep, context):
    ids, index, similarity, families, days, low, liked = context
    eligible = np.array([row.eligible(i) and i in keep for i in ids])
    target = index[row.id]
    assert not eligible[target] and all(eligible[index[i]] for i in witnesses)
    gap, closest_bad, closest_good = relative_margin(similarity[target], eligible, low, liked)
    result = dict(raw=proposed, relativeGap=gap, successfulFamilies=0, referenceFamilies=0,
                  precision=None, lowerBound=None, pointEstimate=row.before, cautious=row.before)
    if gap <= 1e-12:
        return result

    omitted = {families[index[i]] for i in witnesses} | {families[closest_bad], families[closest_good]}
    inner = eligible & ~np.isin(families, sorted(omitted))
    evidence = defaultdict(list)
    comparison_families = Counter()
    for j in np.flatnonzero(inner):
        # Recreate the inference without the reference title or its relatives. This nested
        # pool contains no ratings from the outer held family, fold, or comparison witnesses.
        pool = inner & (families != families[j])
        if row.split == 'earlier':
            pool &= days < days[j]
        strength, bad, _ = relative_margin(similarity[j], pool, low, liked)
        if strength >= gap - 1e-12:
            evidence[families[j]].append('disliked' if low[j] else 'liked' if liked[j] else 'neutral')
            comparison_families[str(families[bad])] += 1
    outcomes = Counter(v[0] if len(set(v)) == 1 else 'mixed' for v in evidence.values())
    successes = outcomes['disliked']
    p, lower = estimates(successes, len(evidence))
    def adjusted(reliability):
        # Over-neutral caution can only dampen an otherwise supported reduction.
        return display(row.before - max(0., 3*reliability - 2) * (row.before - proposed))
    result.update(successfulFamilies=successes, referenceFamilies=len(evidence),
                  precision=p, lowerBound=lower, pointEstimate=adjusted(p), cautious=adjusted(lower),
                  familyOutcomes=outcomes, distinctNearestDislikedFamilies=len(comparison_families))
    return result


def source_candidates(credit, story):
    result = {}
    for r in credit:
        result[r['id']] = (r['after'], set(r['personDonors'] + r['companyDonors']))
    for r in story:
        arm = r['triple'].get('independentSynopsisVerifiedTeams')
        if arm and r['id'] not in result:
            result[r['id']] = arm[0], {*arm[3], *arm[4], r['plot']}
    return result


def run(args):
    direct, panels = retained_panels(args)
    family = {r.id: r.family for r in panels['full']}
    contexts = {}
    with np.load(args.embeddings, allow_pickle=False) as emb:
        for medium in ('movie', 'show'):
            ids = sorted(i for i, r in direct.items() if r['medium'] == medium)
            contexts[medium] = (ids, {i:j for j,i in enumerate(ids)}, cosine_matrix(emb, ids),
                                np.array([family[i] for i in ids]), np.array([direct[i]['at'][:10] for i in ids]),
                                np.array([direct[i]['stars'] <= 2.5 for i in ids]),
                                np.array([direct[i]['stars'] > 3 for i in ids]))
    studio = read(args.studio)
    story = read(args.story)
    out = {}
    for split, rows in panels.items():
        proposals = source_candidates(studio[split]['changes']['sameKindCompany'], story[split]['changes'])
        out[split] = {}
        for row in rows:
            if row.id in proposals:
                assert row.before >= 50
                result = assess(row, *proposals[row.id], direct.keys(), contexts[row.medium])
                out[split][row.id] = dict(title=row.title, stars=row.stars, before=row.before, **result)

    # The full-history mask ledgers contain witnesses for story/credit, while the studio
    # mask ledger only stores forecasts. Re-evaluate only masks where all studio witnesses
    # are still present and the forecast is an exact reproduction of the unmasked proposal.
    if args.credit_masks and args.story_masks:
        masked_studio = read(args.credit_masks)
        masked_story = read(args.story_masks)['masks']
        full_credit = {r['id']:r for r in studio['full']['changes']['sameKindCompany']}
        masks = []
        for trial in masked_studio:
            fraction, seed = trial['fraction'], trial['seed']
            if not fraction:
                continue
            known = {i for i in family if family_draw(seed, family[i]) >= fraction}
            proposals = {}
            for r in trial['changes']:
                c = full_credit[r['id']]
                witnesses = set(c['personDonors'] + c['companyDonors'])
                assert c['after'] == r['after'] and witnesses <= known
                proposals[r['id']] = r['after'], witnesses
            plot_ledger = masked_story[str(fraction)]['seeds'][seed]
            assert plot_ledger['seed'] == seed
            for i, r in plot_ledger['results']['independentSynopsisVerifiedTeams']['forecasts'].items():
                proposals.setdefault(i,(r['score'], {*r['tagDonors'], *r['creditDonors'], r['plot']}))
            values = {}
            for row in panels['full']:
                if row.id in proposals:
                    assert row.before >= 50
                    v = assess(row, *proposals[row.id], known, contexts[row.medium])
                    values[row.id] = dict(title=row.title, before=row.before, stars=row.stars, **v)
            masks.append(dict(fraction=fraction, seed=seed, cases=values))
        out['masks'] = masks
    write_new(args.output, out)


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for key in ('graded','direct','team','movie','show','archived','earlier','grouped','witness',
                'studio','story','embeddings','output'):
        cli.add_argument(key, type=Path)
    cli.add_argument('--credit-masks', type=Path)
    cli.add_argument('--story-masks', type=Path)
    run(cli.parse_args())
