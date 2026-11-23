"""Scale previously eligible negative forecasts by the disliked synopsis's lead over a liked one.

Protect the exact-team and personalised public baseline. Evaluate every prior holdout and
the same donor-family masks. Missing comparisons and ties preserve the starting score.
Use ratings only from eligible training titles to choose neighbours. A held target's rating
enters the metrics after the prediction.
"""
from argparse import ArgumentParser
from collections import Counter
from pathlib import Path

import numpy as np

from content_agreement import content_views
from credit_family_masks import family_draw
from retained_panels import retained_panels
from team_audience import display, read, write_new


def comparison(row, allow, ratings, view):
    ids, index, matrix = view
    sims = matrix[index[row.id]]
    def best(liked):
        known = [j for j in ids if j in allow and np.isfinite(sims[index[j]])
                 and (ratings[j]['stars'] > 3 if liked else ratings[j]['stars'] <= 2.5)]
        if not known:
            return None, None
        j = max(known, key=lambda j: (sims[index[j]], j))
        return j, float(sims[index[j]])

    bad_id, bad = best(False)
    good_id, good = best(True)
    weight = distance_weight = 0.
    if good is not None and bad is not None and bad > 0 and bad - good > 1e-12:
        lead = bad - max(0., good)
        # Relative lead in similarity; the alternate measures relative improvement in cosine distance.
        weight = min(1., lead / bad)
        distance_weight = min(1., (bad - good) / (1 - good)) if good < 1 else 0.
    return dict(disliked=bad_id, badCosine=bad, liked=good_id, goodCosine=good,
                weight=weight, distanceWeight=distance_weight)


def global_control(rows, candidates, ratings, views):
    """Also scale incumbent downward changes, starting from the unadjusted native score."""
    changed = []
    totals = Counter()
    for r in rows:
        source = candidates.get(r.id)
        hard = source[1] if source else r.before
        after = hard
        if hard < r.native:
            allowed = {j for j in ratings if r.eligible(j)}
            evidence = comparison(r, allowed, ratings, views[r.medium])
            after = display(r.native + evidence['weight'] * (hard - r.native))
            changed.append(dict(id=r.id, stars=r.stars, title=r.title, native=r.native, retained=r.before,
                                hard=hard, scaled=after, weight=evidence['weight']))
        totals['redDislikes'] += r.stars <= 2.5 and after < 50
        totals['previousRedDislikesStillRed'] += r.stars <= 2.5 and r.before < 50 and after < 50
        totals['likedLoweredAgainstNative'] += r.stars > 3 and after < r.native
    return dict(metrics=totals, candidates=changed)


def score_panel(rows, candidates, allow, ratings, views, studio_evidence):
    changes = []
    plot_scores, distance_scores, cue_scores = {}, {}, {}
    assert set(studio_evidence) == {i for i, (branch, _, _) in candidates.items() if branch == 'studio'}
    for r in rows:
        plot_scores[r.id] = distance_scores[r.id] = cue_scores[r.id] = r.before
        if r.id not in candidates:
            continue
        branch, unscaled, plot = candidates[r.id]
        assert r.before >= 50 > unscaled
        permitted = {j for j in allow if r.eligible(j)}
        assert r.id not in permitted
        evidence = comparison(r, permitted, ratings, views[r.medium])
        if plot is not None:
            assert plot == evidence['disliked']
            assert evidence['goodCosine'] is None or evidence['badCosine'] > evidence['goodCosine']
        raw = r.before - (r.before - unscaled) * evidence['weight']
        plot_scores[r.id] = display(raw)
        distance_scores[r.id] = display(r.before - (r.before - unscaled) * evidence['distanceWeight'])
        cue_scores[r.id] = plot_scores[r.id]
        if branch == 'studio':
            study = studio_evidence[r.id]
            assert study['before'] == r.before and study['hard'] == unscaled
            cue_scores[r.id] = study['after']
        changes.append(dict(id=r.id, title=r.title, stars=r.stars, before=r.before, unscaled=unscaled,
                            branch=branch, raw=raw, scaled=plot_scores[r.id], distanceScaled=distance_scores[r.id],
                            cueScaled=cue_scores[r.id], **evidence))
    assert len(plot_scores) == len(rows) and len(changes) == len(candidates)
    stats = {}
    for k, predictions in [('relativeSimilarity', plot_scores), ('relativeDistance', distance_scores),
                           ('creditOrPlotSimilarity', cue_scores)]:
        kept = {r.id for r in rows if r.before < 50 and r.stars <= 2.5}
        assert all(predictions[r.id] == r.before for r in rows if r.id in kept)
        stats[k] = dict(titles=len(rows), protectedDislikes=len(kept),
                        redDislikes=sum(r.stars <= 2.5 and predictions[r.id] < 50 for r in rows),
                        newFalseReds=sum(r.stars > 3 and predictions[r.id] < 50 <= r.before for r in rows),
                        loweredByStars=dict(sorted(Counter(r.stars for r in rows if predictions[r.id] < r.before).items())))
    return dict(metrics=stats, candidates=changes)


def run(args):
    ratings, panels = retained_panels(args)
    studio, triples = read(args.studio), read(args.triples)
    studio_masks, triple_masks = read(args.studio_masks), read(args.triple_masks)
    studio_margin = read(args.studio_margin)
    masked_studio_margin = {(m['fraction'], m['seed']): m['predictions'] for m in studio_margin['masks']}
    families = {r.id: r.family for r in panels['full']}
    with np.load(args.embeddings, allow_pickle=False) as vectors:
        views = {p['medium']: content_views(p, vectors, ratings)[:3] for p in read(args.capture)}
    output = {'cohorts': {}, 'masks': []}
    arm = 'independentSynopsisVerifiedTeams'
    for split, rows in panels.items():
        assert set(studio[split]['previous']) == {r.id for r in rows if r.stars <= 2.5 and r.before < 50}
        candidates = {r['id']: ('studio', r['after'], None) for r in studio[split]['changes']['sameKindCompany']}
        for r in triples[split]['changes']:
            if arm in r['triple'] and r['id'] not in candidates:
                candidates[r['id']] = ('storyCreditPlot', r['triple'][arm][0], r['plot'])
        output['cohorts'][split] = score_panel(rows, candidates, ratings.keys(), ratings, views,
                                              studio_margin['panels'][split])
        output['cohorts'][split]['globalControl'] = global_control(rows, candidates, ratings, views)
    for sample in studio_masks:
        fraction, seed = sample['fraction'], sample['seed']
        if not fraction:
            continue
        allowed = {i for i in ratings if family_draw(seed, families[i]) >= fraction}
        assert len(allowed) == sample['retainedDonors']
        story = triple_masks['masks'][str(fraction)]['seeds'][seed]
        assert story['seed'] == seed and story['omittedTitles'] == len(ratings) - len(allowed)
        candidates = {r['id']: ('studio', r['after'], None) for r in sample['changes']}
        for i, r in story['results'][arm]['forecasts'].items():
            candidates.setdefault(i, ('storyCreditPlot', r['score'], r['plot']))
        report = score_panel(panels['full'], candidates, allowed, ratings, views, masked_studio_margin[fraction, seed])
        output['masks'].append(dict(fraction=fraction, seed=seed, **report))
    assert len(output['masks']) == 32
    write_new(args.output, output)


if __name__ == '__main__':
    parser = ArgumentParser(description=__doc__)
    for name in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                 'studio', 'triples', 'studio_masks', 'triple_masks', 'embeddings', 'capture', 'studio_margin', 'output'):
        parser.add_argument(name, type=Path)
    run(parser.parse_args())
