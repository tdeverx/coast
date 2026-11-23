"""Replay a fine story keyword and an independently disliked credit in the target's genre context."""
import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from statistics import mean, median

from retained_panels import retained_panels
from separate_credits import catalogue, similar_genres
from team_audience import display, read, utility, write_new


ARMS = ('tagAlone', 'creditAlone', 'corroborated', 'repeated', 'positiveVetoSharedGenre', 'positiveVetoAllGenres')


def descriptors(capture, metadata, ids):
    works, companies, _, genres = catalogue(capture, metadata, ids)
    key_by_work, credits_by_work = {}, {}
    for panel in capture:
        features = {r['work']['id']: r['features'] for r in panel['history']}
        features.update({r['id']: r['features'] for r in panel['catalogue']})
        for i in ids & features.keys():
            facts = features[i]
            key_by_work[i] = {v['id'] for v in facts.get('tags', []) if v['id'].startswith('tmdb:')}
            people = {(role, v['id']) for role in ('cast', 'directors', 'writers')
                      for v in facts.get(role, []) if v['id'].startswith('tmdb:')}
            leads = {('creator' if panel['medium'] == 'show' else 'directors', 'tmdb:' + k) for k in works[i][2]}
            credits_by_work[i] = people | leads | companies[i]
    return works, genres, key_by_work, credits_by_work


def postings(by_work):
    result = defaultdict(set)
    for i, keys in by_work.items():
        for key in keys:
            result[key].add(i)
    return result


@dataclass
class Clue:
    key: object
    ids: set
    families: set
    leads: set
    teams_known: bool
    estimate: int


def negative_clues(keys, index, similar, ratings, families, works):
    clues = []
    for key in sorted(keys):
        ids = index[key] & similar
        if not ids or any(ratings[j]['stars'] > 2.5 for j in ids):
            continue
        grouped = defaultdict(list)
        for j in sorted(ids):
            grouped[families[j]].append(utility(ratings[j]['stars']))
        estimate = display(median(mean(group) for group in grouped.values()))
        teams = [works[j][2] for j in ids]
        clues.append(Clue(key, ids, set(grouped), set().union(*teams), all(teams), estimate))
    return clues


def verdict(i, allowed, ratings, families, works, genres, descriptors, indices, plot=None):
    similar = {j for j in allowed if similar_genres(genres[i], genres[j])}
    tags, credits = [negative_clues(by_work[i], idx, similar, ratings, families, works)
                     for by_work, idx in zip(descriptors, indices, strict=True)]
    records = {}

    def admit(arm, score, tag=None, credit=None):
        witness = (score, tag.key if tag else '', credit.key if credit else ('', ''),
                   sorted(tag.ids) if tag else [], sorted(credit.ids) if credit else [])
        if arm not in records or witness > records[arm]:
            records[arm] = witness

    for tag in tags:
        admit('tagAlone', tag.estimate, tag=tag)
    for credit in credits:
        admit('creditAlone', credit.estimate, credit=credit)
    for tag in tags:
        for credit in credits:
            if tag.families & credit.families or not tag.teams_known or not credit.teams_known or tag.leads & credit.leads:
                continue
            joint = indices[0][tag.key] & indices[1][credit.key] & allowed
            if any(ratings[j]['stars'] >= 4 for j in joint):
                continue
            estimate = max(tag.estimate, credit.estimate)
            admit('corroborated', estimate, tag, credit)
            if plot is not None and ratings[plot]['stars'] <= 2.5:
                if families[plot] not in tag.families | credit.families and not works[plot][2] & (tag.leads | credit.leads):
                    admit('independentSynopsis', estimate, tag, credit)
                    if works[plot][2]:
                        admit('independentSynopsisVerifiedTeams', estimate, tag, credit)
            if len(tag.families) >= 2 and len(credit.families) >= 2:
                admit('repeated', estimate, tag, credit)
            # Explore whether matching only close genre sets concealed positive observations of either clue.
            positive = {j for j in (indices[0][tag.key] | indices[1][credit.key]) & allowed if ratings[j]['stars'] >= 4}
            if not any(genres[i] & genres[j] for j in positive):
                admit('positiveVetoSharedGenre', estimate, tag, credit)
            if not positive:
                admit('positiveVetoAllGenres', estimate, tag, credit)
    return records


def run(args):
    ratings, panels = retained_panels(args)
    families = {r.id: r.family for r in panels['full']}
    works, genres, tags, credits = descriptors(read(args.capture), read(args.metadata), set(ratings))
    fields = (tags, credits)
    indices = tuple(postings(group) for group in fields)
    previous = read(args.previous)
    if args.embeddings:
        import numpy as np
        from content_agreement import content_views, nearest
        with np.load(args.embeddings, allow_pickle=False) as data:
            views = {m['medium']: content_views(m, data, ratings)[:3] for m in read(args.capture)}
        receipts = {s: {p['id']: p for p in audit['cases']} for s, audit in read(args.plot_receipt).items()}

        def closest(i, media, allowed):
            ids, idx, matrix = views[media]
            sim = matrix[idx[i]]
            mask = np.asarray([j in allowed for j in ids])
            pick = nearest(sim, mask)
            if pick is None:
                return None, None
            return ids[pick], float(sim[pick])

    report = {}
    for split, rows in panels.items():
        old = {r['id']: r for r in previous[split]['changes']['sameKindCompany']}
        assert {r.id for r in rows if r.before < 50 and r.stars <= 2.5} == set(previous[split]['previous'])
        arms = ARMS + (('independentSynopsis', 'independentSynopsisVerifiedTeams') if args.embeddings else ())
        metrics = {f'{base}:{arm}': Counter() for base in ('original', 'withStudioGenre') for arm in arms}
        changes, robustness, triple_robustness = [], [], []
        for r in rows:
            assert r.family == families[r.id]
            prev = old.get(r.id)
            if prev:
                assert prev['before'] == r.before and prev['stars'] == r.stars
            enhanced = prev['after'] if prev else r.before
            if r.before < 50:
                continue
            permitted = {j for j in ratings if r.eligible(j)}
            assert r.id not in permitted
            plot, similarity = closest(r.id, r.medium, permitted) if args.embeddings else (None, None)
            if args.embeddings:
                receipt = receipts[split][r.id]
                assert plot == receipt['plotDonor']
                assert similarity is None or abs(similarity - receipt['plotSimilarity']) < 1e-7
            results = verdict(r.id, permitted, ratings, families, works, genres, fields, indices, plot=plot)
            for arm, record in results.items():
                score, tag, credit, tag_donors, credit_donors = record
                assert score < 50 and set(tag_donors + credit_donors) <= permitted
                for label, base in [('original', r.before), ('withStudioGenre', enhanced)]:
                    if base >= 50:
                        cnt = metrics[label + ':' + arm]
                        key = ('dislike' if r.stars <= 2.5 else 'neutral' if r.stars == 3 else str(r.stars))
                        cnt[key] += 1
                        cnt['fiveLostGreen'] += r.stars == 5 and base >= 80
                if arm != 'corroborated':
                    continue
                positives = {}
                for role, feature, index in (('tag', tag, indices[0]), ('credit', credit, indices[1])):
                    matches = []
                    for j in index[feature] & permitted:
                        shared = genres[r.id] & genres[j]
                        if shared and ratings[j]['stars'] >= 4:
                            matches.append((len(shared) / len(genres[r.id] | genres[j]), ratings[j]['stars'], j))
                    positives[role] = sorted(matches, reverse=True)
                changes.append(dict(id=r.id, title=r.title, stars=r.stars, retained=r.before,
                                    enhanced=enhanced, score=score, tag=tag, credit=credit,
                                    tagDonors=tag_donors, creditDonors=credit_donors,
                                    positiveComparisons=positives,
                                    afterPositiveVeto={k: v[0] for k, v in results.items() if k.startswith('positiveVeto')}))
                if args.embeddings:
                    nearest_liked, like_similarity = closest(
                        r.id, r.medium, {j for j in permitted if ratings[j]['stars'] >= 4})
                    changes[-1].update(plot=plot, similarity=similarity, nearestLiked=nearest_liked,
                                       likedSimilarity=like_similarity, verifiedPlotLeads=bool(plot and works[plot][2]),
                                       triple={k: v for k, v in results.items() if k.startswith('independentSynopsis')})
                if split == 'full':
                    for family in sorted({families[j] for j in tag_donors + credit_donors}):
                        reduced = {j for j in permitted if families[j] != family}
                        other = verdict(r.id, reduced, ratings, families, works, genres, fields, indices)
                        robust_score = other['corroborated'][0] if 'corroborated' in other else r.before
                        robustness.append(dict(id=r.id, omitted=family, score=robust_score))
                    for arm in ('independentSynopsis', 'independentSynopsisVerifiedTeams'):
                        if arm not in results:
                            continue
                        selected = results[arm]
                        families_used = {families[j] for j in selected[3] + selected[4] + [plot]}
                        for family in sorted(families_used):
                            reduced = {j for j in permitted if families[j] != family}
                            next_plot, next_similarity = closest(r.id, r.medium, reduced)
                            other = verdict(r.id, reduced, ratings, families, works, genres, fields, indices, plot=next_plot)
                            triple_robustness.append(dict(id=r.id, omitted=family, arm=arm, plot=next_plot,
                                                         similarity=next_similarity, score=other[arm][0] if arm in other else enhanced))
        report[split] = dict(counts=metrics, changes=changes, omitOne=robustness, omitOneTriple=triple_robustness)
        print(split, dict(metrics))
    write_new(args.output, report)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                 'capture', 'metadata', 'previous', 'output'):
        p.add_argument(name, type=Path)
    p.add_argument('--embeddings', type=Path)
    p.add_argument('--plot-receipt', type=Path)
    args = p.parse_args()
    if bool(args.embeddings) != bool(args.plot_receipt):
        p.error('The optional synopsis follow-up requires both the frozen embeddings and original synopsis ledger.')
    run(args)
