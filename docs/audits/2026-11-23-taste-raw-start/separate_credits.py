"""Test whether separate personal histories for a person and a production company predict a dislike."""
import argparse
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean, median

from retained_panels import retained_panels
from team_audience import display, read, utility, write_new


def catalogue(capture, metadata, ids):
    details = {r['id']: r for r in metadata if r['id'] in ids}
    works = {}
    provider_companies, first_companies, genres = {}, {}, {}
    for panel in capture:
        features = {r['work']['id']: r['features'] for r in panel['history']}
        features.update({r['id']: r['features'] for r in panel['catalogue']})
        lead_roles = {'Director'} if panel['medium'] == 'movie' else {'Creator', 'Showrunner'}
        for i in ids & features.keys():
            facts = features[i]
            meta = details.get(i, {})
            leads = {str(c['id']) for c in meta.get('credits') or [] if c['role'] in lead_roles and str(c['id']).isdigit()}
            people = {v['id'] for key in ('cast', 'writers', 'directors') for v in facts.get(key, [])
                      if v['id'].startswith('tmdb:')} | {'tmdb:' + p for p in leads}
            # The same company can appear as both studio and network.
            companies = {v['id'] for key in ('studios', 'networks') for v in facts.get(key, [])}
            works[i] = (people, companies, leads)
            genres[i] = {v['id'] for v in facts.get('genres', [])}
            provider_companies[i], first_companies[i] = set(), set()
            for role in ('studios', 'networks'):
                for place, credit in enumerate((meta.get('facts') or {}).get(role) or []):
                    if str(credit.get('id', '')).isdigit():
                        company = (role, str(credit['id']))
                        provider_companies[i].add(company)
                        if place == 0:
                            first_companies[i].add(company)
    assert works.keys() == ids
    return works, provider_companies, first_companies, genres


def trait_evidence(traits, index, eligible, ratings, families, works):
    for trait in sorted(traits):
        ids = index[trait] & eligible
        if len(ids) < 2:
            continue
        grouped = defaultdict(list)
        for i in sorted(ids):
            grouped[families[i]].append(i)
        # A family with conflicting personal ratings cannot be a negative witness.
        low = [members for members in grouped.values() if all(ratings[i]['stars'] <= 2.5 for i in members)]
        if len(low) < 2 or len(low) * 2 <= len(grouped):
            continue
        donors = set().union(*low)
        teams = {frozenset(works[i][2]) for i in donors}
        estimate = median(mean(utility(ratings[i]['stars']) for i in members) for members in grouped.values())
        yield trait, ids, donors, {families[i] for i in donors}, teams, estimate


def similar_genres(left, right):
    return bool(left and right) and 2 * len(left & right) >= len(left | right)


def predict(target, companies, eligible, indices, ratings, families, works, first=None, comparable=None, both_roles=False):
    people = works[target][0]
    if not people or not companies:
        return {}
    persons = list(trait_evidence(people, indices[0], eligible, ratings, families, works))
    if not persons:
        return {}
    options = defaultdict(list)
    for company in trait_evidence(companies, indices[1], eligible, ratings, families, works):
        if comparable is not None and len({families[j] for j in company[2] & comparable}) < 2:
            continue
        if first is not None:
            # All known counterexamples still vote. Only first-listed companies can supply affirmative support.
            if company[0] not in first[target] or len({families[j] for j in company[2] if company[0] in first[j]}) < 2:
                continue
        for person in persons:
            if both_roles and len({families[j] for j in person[2] & comparable}) < 2:
                continue
            if any(ratings[i]['stars'] >= 4 for i in person[1] & company[1]):
                continue
            # Two correlated features with the same underlying works count as a single clue.
            if person[3] & company[3]:
                continue
            estimate = display(max(person[5], company[5]))
            assert estimate < 50
            record = (estimate, person[0], company[0], sorted(person[2]), sorted(company[2]))
            options['separateFamilies'].append(record)
            if frozenset() in person[4] or frozenset() in company[4]:
                continue
            if set().union(*person[4]) & set().union(*company[4]):
                continue
            options['separatePeopleAndCompanies'].append(record)
            if len(person[4]) >= 2 and len(company[4]) >= 2:
                options['multipleTeamsPerClue'].append(record)
    # Prefer the less severe forecast when several comparisons qualify.
    return {arm: max(values) for arm, values in options.items()}


def run(args):
    ratings, panels = retained_panels(args)
    works, by_role, first, genres = catalogue(read(args.capture), read(args.metadata), set(ratings))
    indices = (defaultdict(set), defaultdict(set))
    provider_index = defaultdict(set)
    for i, (people, companies, _) in works.items():
        for traits, index in zip((people, companies), indices, strict=True):
            for trait in traits:
                index[trait].add(i)
        for company in by_role[i]:
            provider_index[company].add(i)
    families = {r.id: r.family for r in panels['full']}
    previous_hits = {r.id for r in panels['full'] if r.stars <= 2.5 and r.before < 50}
    assert len(previous_hits) == 8
    output = {}
    for split, rows in panels.items():
        assert all(families[r.id] == r.family for r in rows)
        kept = [r.id for r in rows if r.stars <= 2.5 and r.before < 50]
        ablations = []
        trials = {arm: [] for arm in ('separateFamilies', 'separatePeopleAndCompanies', 'multipleTeamsPerClue',
                                      'withoutOriginalEightAsWitnesses', 'providerIdentity', 'firstListed',
                                      'firstListedOnTarget', 'likedComparableCreatorVeto', 'sameKindCompany', 'sameKindBothRoles')}
        for r in rows:
            if r.before < 50:
                continue
            allowed = {j for j in ratings if r.eligible(j)}
            assert r.id not in allowed and all(ratings[j]['medium'] == r.medium for j in allowed)
            results = predict(r.id, works[r.id][1], allowed, indices, ratings, families, works)
            for arm, first_filter in (('providerIdentity', None), ('firstListed', first)):
                by_credit = predict(r.id, by_role[r.id], allowed, (indices[0], provider_index),
                                    ratings, families, works, first_filter)
                if 'separatePeopleAndCompanies' in by_credit:
                    results[arm] = by_credit['separatePeopleAndCompanies']
            target_first = predict(r.id, first[r.id], allowed, (indices[0], provider_index), ratings, families, works)
            if 'separatePeopleAndCompanies' in target_first:
                results['firstListedOnTarget'] = target_first['separatePeopleAndCompanies']
            if 'providerIdentity' in results:
                # A liked work by a leading creator in a comparable genre is direct counterevidence.
                same_kind = {j for j in allowed if similar_genres(genres[r.id], genres[j])}
                has_liked_peer = any(
                    ratings[j]['stars'] >= 4 and works[j][2] & works[r.id][2] for j in same_kind
                )
                if not has_liked_peer:
                    results['likedComparableCreatorVeto'] = results['providerIdentity']
                # Reuse the existing exact-team genre comparison for the company's work.
                for arm, both_roles in (('sameKindCompany', False), ('sameKindBothRoles', True)):
                    comparable = predict(r.id, by_role[r.id], allowed, (indices[0], provider_index),
                                         ratings, families, works, comparable=same_kind, both_roles=both_roles)
                    if 'separatePeopleAndCompanies' in comparable:
                        results[arm] = comparable['separatePeopleAndCompanies']
                if split == 'full' and 'sameKindCompany' in results:
                    chosen = results['sameKindCompany']
                    for donor in sorted(set(chosen[3] + chosen[4])):
                        remaining = {j for j in allowed if families[j] != families[donor]}
                        repeat = predict(r.id, by_role[r.id], remaining, (indices[0], provider_index),
                                         ratings, families, works, comparable=same_kind)
                        estimate = repeat.get('separatePeopleAndCompanies')
                        ablations.append(dict(id=r.id, omittedFamily=families[donor],
                                              score=estimate[0] if estimate else r.before))
            if split == 'full':
                # Remove the donors before screening each trait; removing positive votes can change a majority.
                independent = predict(r.id, works[r.id][1], allowed - previous_hits, indices, ratings, families, works)
                if 'separatePeopleAndCompanies' in independent:
                    results['withoutOriginalEightAsWitnesses'] = independent['separatePeopleAndCompanies']
            for arm, (score, person, company, people_donors, company_donors) in results.items():
                trials[arm].append(dict(id=r.id, title=r.title, stars=r.stars, before=r.before, after=score,
                                        person=person, company=company, personDonors=people_donors, companyDonors=company_donors))
        if split != 'full':
            del trials['withoutOriginalEightAsWitnesses']
        output[split] = dict(previous=sorted(kept), changes=trials, omitOneWitnessFamily=ablations)
        for arm, changes in trials.items():
            print(split, arm, 'retained', len(kept), 'changes by rated stars', dict(sorted(Counter(r['stars'] for r in changes).items())))
    write_new(args.output, output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                  'capture', 'metadata', 'output'):
        parser.add_argument(field, type=Path)
    run(parser.parse_args())
