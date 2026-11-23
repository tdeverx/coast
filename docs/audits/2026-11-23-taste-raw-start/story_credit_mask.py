"""Mask donor families, retain all 870 targets, and reselect all three independent clues."""
import argparse
import hashlib
from collections import Counter
from pathlib import Path
from statistics import median

import numpy as np

from content_agreement import content_views, nearest
from retained_panels import retained_panels
from story_credit_corroboration import descriptors, postings, verdict
from team_audience import read, write_new


ARMS = ('independentSynopsis', 'independentSynopsisVerifiedTeams')


def mask_value(seed, family):
    digest = hashlib.sha256(f'{seed}|{family}'.encode()).digest()
    return int.from_bytes(digest[:8], 'big') / 2**64


def counts(rows, scores, changed):
    return dict(
        total=len(rows),
        redDislikes=sum(r.stars <= 2.5 and scores[r.id] < 50 for r in rows),
        gained=sum(r.stars <= 2.5 for r in changed),
        neutralLowered=sum(r.stars == 3 for r in changed),
        likedLowered=sum(r.stars > 3 for r in changed),
        fourPlusLowered=sum(r.stars >= 4 for r in changed),
        fiveLowered=sum(r.stars == 5 for r in changed),
        changedByStars=dict(sorted(Counter(r.stars for r in changed).items())),
    )


def run(args):
    ratings, panels = retained_panels(args)
    rows = panels['full']
    families = {r.id: r.family for r in rows}
    assert len(rows) == 870 and set(families) == set(ratings)
    capture = read(args.capture)
    works, genres, tags, credits = descriptors(capture, read(args.metadata), set(ratings))
    fields = tags, credits
    indices = postings(tags), postings(credits)
    with np.load(args.embeddings, allow_pickle=False) as data:
        views = {s['medium']: content_views(s, data, ratings)[:3] for s in capture}
    allowed = {r.id: {j for j in ratings if r.eligible(j)} for r in rows}
    masks = {r.id: np.array([j in allowed[r.id] for j in views[r.medium][0]]) for r in rows}
    old = read(args.previous)['full']
    assert {r.id for r in rows if r.before < 50 and r.stars <= 2.5} == set(old['previous'])
    original = {r.id: r.before for r in rows}
    studio = original | {r['id']: r['after'] for r in old['changes']['sameKindCompany']}
    original_cases = read(args.triple_receipt)['full']['changes']
    known = {r['id']: r['score'] for r in original_cases if 'independentSynopsisVerifiedTeams' in r['triple']}

    def evaluate(omitted):
        masked_ids = {j for j in families if families[j] in omitted}
        medium_masks = {m: np.array([j not in masked_ids for j in view[0]]) for m,view in views.items()}
        hits = {arm: {} for arm in ARMS}
        for r in rows:
            if r.before < 50:
                continue
            ids, index, cosine = views[r.medium]
            picked = nearest(cosine[index[r.id]], masks[r.id] & medium_masks[r.medium])
            if picked is None or ratings[ids[picked]]['stars'] > 2.5:
                # The synopsis independently selected an eligible title and now vetoes all possible pairs.
                continue
            plot = ids[picked]
            permitted = allowed[r.id] - masked_ids
            assert plot in permitted and r.id not in permitted
            options = verdict(r.id, permitted, ratings, families, works, genres, fields, indices, plot=plot)
            for arm in ARMS:
                if arm in options:
                    score, tag, credit, tag_people, credit_people = options[arm]
                    assert set(tag_people + credit_people) <= permitted
                    hits[arm][r.id] = dict(score=score, plot=plot, plotSimilarity=float(cosine[index[r.id],picked]),
                                           tag=tag, credit=credit, tagDonors=tag_people, creditDonors=credit_people)
        result = {}
        for arm, forecasts in hits.items():
            by_reference = {}
            for name, baseline in (('original', original), ('withStudioGenre', studio)):
                changed = [r for r in rows if r.id in forecasts and baseline[r.id] >= 50]
                scores = baseline | {r.id: forecasts[r.id]['score'] for r in changed}
                by_reference[name] = counts(rows, scores, changed)
            result[arm] = dict(forecasts=forecasts, byReference=by_reference)
        return result

    control = evaluate(set())
    assert {i: r['score'] for i,r in control[ARMS[1]]['forecasts'].items()} == known
    assert control[ARMS[1]]['byReference']['withStudioGenre']['redDislikes'] == 10
    output = dict(unmasked=control, masks={})
    family_ids = set(families.values())
    for fraction in (.10, .25):
        seeds = []
        for seed in range(16):
            omitted = {f for f in family_ids if mask_value(seed,f) < fraction}
            seeds.append(dict(seed=seed, omittedFamilies=len(omitted), omittedTitles=sum(f in omitted for f in families.values()),
                              results=evaluate(omitted)))
        summaries = {}
        for arm in ARMS:
            freq = Counter(i for s in seeds for i in s['results'][arm]['forecasts'])
            range_by_measure = {}
            for name in ('gained','redDislikes','neutralLowered','likedLowered','fourPlusLowered','fiveLowered'):
                values = [s['results'][arm]['byReference']['withStudioGenre'][name] for s in seeds]
                range_by_measure[name] = [min(values), median(values), max(values)]
            summaries[arm] = dict(minMedianMax=range_by_measure, distinctTargets=dict(freq),
                                  originalUnmaskedHitsFrequency={i: freq[i] for i in known})
            print(fraction, arm, range_by_measure, 'covered', len(freq), 'original hit frequency', [freq[i] for i in known])
        output['masks'][str(fraction)] = dict(seeds=seeds, summary=summaries)
    write_new(args.output,output)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('graded','direct','team','movie','show','archived','earlier','grouped','witness','capture','metadata',
                 'previous','embeddings','triple_receipt','output'):
        p.add_argument(name,type=Path)
    run(p.parse_args())
