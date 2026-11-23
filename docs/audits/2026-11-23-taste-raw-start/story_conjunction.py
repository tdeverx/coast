"""Frozen offline replay for disliking a particular combination of otherwise liked story traits.

Require a genre and TMDB keyword, or two TMDB keywords. Two independently disliked
families with disjoint verified lead teams must share the combination. A liked
joint example vetoes it. Each single trait must have independent positive support
outside the combination. This is a threshold experiment; the rejection score is 49.
The positive replay caps a nudge at four points in a combination repeatedly rated
at least 4½ stars. It tests whether weak personal ratings outside the combination
justify treating the strong joint evidence as an exception.
"""
import argparse
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from statistics import median

from retained_panels import retained_panels
from team_audience import display, read, utility, write_new


def metadata(args, ids):
    cards = {r['id']: r for r in read(args.metadata) if r['id'] in ids}
    traits, leads, postings, labels = {}, {}, defaultdict(set), {}
    for panel in read(args.capture):
        features = {r['work']['id']: r['features'] for r in panel['history']}
        features.update({r['id']: r['features'] for r in panel['catalogue']})
        lead_roles = {'Director'} if panel['medium'] == 'movie' else {'Creator', 'Showrunner'}
        for i in ids & features.keys():
            f = features[i]
            genres = {('genre', x['id']): x['name'] for x in f.get('genres', [])}
            tags = {('tag', x['id']): x['name'] for x in f.get('tags', []) if x['id'].startswith('tmdb:')}
            # Absence of one feature is interpretable only when the metadata has coverage.
            traits[i] = (set(genres) | set(tags)) if genres and tags else set()
            labels.update(genres)
            labels.update(tags)
            for t in traits[i]:
                postings[t].add(i)
            leads[i] = {str(c['id']) for c in cards.get(i, {}).get('credits') or []
                        if c['role'] in lead_roles and str(c['id']).isdigit()}
    assert set(traits) == ids
    return traits, leads, postings, labels


def group_by_family(ids, family):
    groups = defaultdict(set)
    for i in ids:
        groups[family[i]].add(i)
    return groups


def marginal_support(ids, family, ratings, excluded_families):
    groups = group_by_family((i for i in ids if family[i] not in excluded_families), family)
    positive = {f for f, members in groups.items() if all(ratings[j]['stars'] >= 4 for j in members)}
    return len(positive) >= 2 and 2 * len(positive) > len(groups)


def independent_examples(groups, leads, target):
    possible = [i for ids in groups.values() for i in ids if leads[i] and not leads[i] & leads[target]]
    family = {i: f for f, ids in groups.items() for i in ids}
    return any(family[i] != family[j] and not leads[i] & leads[j] for i, j in combinations(possible, 2))


def evaluate(row, allowed, traits, leads, postings, labels, family, ratings):
    arms = {'twoDislikesOnly': [], 'distinctLeads': [], 'likedSeparateTraits': [], 'confirmed': []}
    stages = set()
    best_veto = None
    for left, right in combinations(sorted(traits[row.id]), 2):
        if left[0] == right[0] == 'genre':
            continue
        joint = postings[left] & postings[right] & allowed
        if len(joint) < 2:
            continue
        grouped = group_by_family(joint, family)
        low = {f: members for f, members in grouped.items() if all(ratings[j]['stars'] <= 2.5 for j in members)}
        if len(low) < 2:
            continue
        stages.add('twoDislikedFamilies')
        detail = dict(traits=[labels[left], labels[right]], low=sorted(i for members in low.values() for i in members),
                      other=sorted(joint - set().union(*low.values())))
        independent = independent_examples(low, leads, row.id)
        if independent:
            stages.add('twoIndependentTeams')
        if any(ratings[j]['stars'] > 3 for j in joint):
            if independent and (best_veto is None or len(detail['other']) < len(best_veto['other'])):
                best_veto = detail
            continue
        if 2 * len(low) <= len(grouped):
            continue
        stages.add('strictMajorityNoLike')
        arms['twoDislikesOnly'].append(detail)
        if independent:
            arms['distinctLeads'].append(detail)
        marginals = [(postings[t] & allowed) - joint for t in (left, right)]
        shared_families = set(grouped) | ({family[i] for i in marginals[0]} & {family[i] for i in marginals[1]})
        if all(marginal_support(pool, family, ratings, shared_families) for pool in marginals):
            arms['likedSeparateTraits'].append(detail)
            if independent:
                arms['confirmed'].append(detail)
    return arms, stages, best_veto


def positive_exceptions(row, base, allowed, traits, leads, postings, labels, family, ratings):
    """Look for enthusiastic agreement inside a combination with a poorly received single trait."""
    strongest = {}
    for left, right in combinations(sorted(traits[row.id]), 2):
        if left[0] == right[0] == 'genre':
            continue
        joint = postings[left] & postings[right] & allowed
        if len(joint) < 2 or any(ratings[i]['stars'] <= 2.5 for i in joint):
            continue
        groups = group_by_family(joint, family)
        strong = {f: ids for f, ids in groups.items() if all(ratings[i]['stars'] >= 4.5 for i in ids)}
        if len(strong) < 2 or 2 * len(strong) <= len(groups) or not independent_examples(strong, leads, row.id):
            continue
        family_values = [median(utility(ratings[i]['stars']) for i in ids) for ids in groups.values()]
        after = max(base, min(base + 4, display(median(family_values))))
        if after <= base:
            continue
        evidence = dict(traits=[labels[left], labels[right]], joint=sorted(joint), after=after)
        arms = {'positiveCombinationOnly'}
        for trait in (left, right):
            separate = {i for i in postings[trait] & allowed if family[i] not in groups}
            parents = group_by_family(separate, family)
            low = sum(all(ratings[i]['stars'] <= 2.5 for i in ids) for ids in parents.values())
            if low >= 2:
                arms.add('twoLowComparisons')
                if 2 * low > len(parents):
                    arms.add('positiveException')
        for arm in arms:
            if arm not in strongest or strongest[arm]['after'] < after:
                strongest[arm] = evidence
    return strongest


def replay(args):
    ratings, panels = retained_panels(args)
    traits, leads, postings, labels = metadata(args, set(ratings))
    family = {r.id: r.family for r in panels['full']}
    previous = read(args.previous)
    out = {}
    for split, rows in panels.items():
        kept = {r.id for r in rows if r.stars <= 2.5 and r.before < 50}
        assert set(previous[split]['previous']) == kept
        candidate = {r['id']: r for r in previous[split]['changes']['sameKindCompany']}
        changes, coverage, vetoes = defaultdict(list), defaultdict(Counter), []
        upward = {arm: [] for arm in ('positiveCombinationOnly', 'twoLowComparisons', 'positiveException')}
        absolute_error = 0
        for r in rows:
            studio_base = candidate[r.id]['after'] if r.id in candidate else r.before
            absolute_error += abs(studio_base - utility(r.stars))
            if r.before < 50:
                continue
            allowed = {j for j in ratings if r.eligible(j)}
            arms, stages, veto = evaluate(r, allowed, traits, leads, postings, labels, family, ratings)
            if studio_base >= 50:
                positive = positive_exceptions(r, studio_base, allowed, traits, leads, postings, labels, family, ratings)
                for arm, evidence in positive.items():
                    upward[arm].append(dict(id=r.id, title=r.title, stars=r.stars, before=studio_base, **evidence))
            category = 'remainingDislike' if r.stars <= 2.5 else 'neutral' if r.stars == 3 else 'liked'
            coverage[category].update(stages)
            if veto and category == 'remainingDislike':
                vetoes.append(dict(id=r.id, title=r.title, example=veto))
            for arm, evidence in arms.items():
                if evidence:
                    changes[arm].append(dict(id=r.id, title=r.title, stars=r.stars, before=r.before,
                                             after=49, alreadyLowered=r.id in candidate, evidence=evidence))
        summary = {}
        for arm in ('twoDislikesOnly', 'distinctLeads', 'likedSeparateTraits', 'confirmed'):
            moved = changes[arm]
            assert not any(r['id'] in kept for r in moved)
            added = [r for r in moved if not r['alreadyLowered']]
            summary[arm] = dict(
                baselineRedDislikes=len(kept),
                newDislikes=sum(r['stars'] <= 2.5 for r in moved),
                newBeyondCompany=sum(r['stars'] <= 2.5 for r in added),
                combinedRedDislikes=len(kept) + len(candidate) + sum(r['stars'] <= 2.5 for r in added),
                neutral=sum(r['stars'] == 3 for r in moved), liked=sum(r['stars'] > 3 for r in moved),
                fourPlus=sum(r['stars'] >= 4 for r in moved), fives=sum(r['stars'] == 5 for r in moved))
        positive_summary = {}
        for arm, moved in upward.items():
            grades = defaultdict(Counter)
            for r in moved:
                stats = grades[str(r['stars'])]
                stats['raised'] += 1
                stats['newGreen'] += r['before'] < 80 <= r['after']
                stats['errorChange'] += abs(r['after'] - utility(r['stars'])) - abs(r['before'] - utility(r['stars']))
            error_delta = sum(stats['errorChange'] for stats in grades.values())
            positive_summary[arm] = dict(changes=len(moved), abstained=len(rows)-len(moved), grades=grades,
                                         beforeMAE=absolute_error/len(rows), afterMAE=(absolute_error+error_delta)/len(rows))
        out[split] = dict(summary=summary, coverage=coverage, changes=changes, vetoes=vetoes,
                          positiveSummary=positive_summary, upward=upward)
    write_new(args.output, out)
    for split, result in out.items():
        print(split, result['summary'])
        for arm, stats in result['positiveSummary'].items():
            print(split, arm, stats['changes'], f"mean error {stats['beforeMAE']:.3f} -> {stats['afterMAE']:.3f}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                 'capture', 'metadata', 'previous', 'output'):
        parser.add_argument(name, type=Path)
    replay(parser.parse_args())
