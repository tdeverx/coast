"""Test whether comparable personal ratings justify crossing 50, including equal-similarity neighbours."""
import argparse
from collections import Counter, defaultdict
from itertools import groupby
import json
from pathlib import Path
import random
from statistics import mean

from raw_public import earlier_days, full_history
from team_audience import read, write_new, utility
from audience import crowd_local
from public_bias import public_fit, weighted_median


def take_peers(ordered, permitted):
    result, seen = [], set()
    for similarity, work, family in ordered:
        if work in permitted and family not in seen:
            seen.add(family)
            result.append((similarity, work))
            if len(result) == 12:
                break
    return result


def inclusive_donors(graph, allowed, public, ratings, errors):
    """Share the remaining slots across equally similar families, without arbitrary ID ordering."""
    families_seen = set()
    slots, bad = 12, 0.
    donors = []
    for similarity, tier in groupby(graph, key=lambda e:e[0]):
        families = defaultdict(list)
        for _, j, family in tier:
            if j in allowed and family not in families_seen:
                families[family].append(j)
        if not families:
            continue
        share = min(1, slots/len(families))
        for ids in families.values():
            # Same-family ties form a single independent comparison. Mixed ratings cannot
            # count as a confirmed dislike, even when the pooled mean would be low.
            precision = mean(public[j][1]/(public[j][1]+50) for j in ids)
            donors.append(crowd_local.Donor(similarity*share*precision, mean(public[j][0] for j in ids),
                                             mean(ratings[j] for j in ids), mean(errors[j] for j in ids)))
            if all(ratings[j] <= 2.5 for j in ids):
                bad += share
        slots -= min(slots, len(families))
        if not slots:
            break
        families_seen.update(families)
    return donors, bad


def choose(graph, permitted, metadata, ratings, errors, tie_order, inclusive):
    if inclusive:
        return inclusive_donors(graph, permitted, metadata, ratings, errors)
    ordered = sorted(graph, key=lambda e:(-e[0], tie_order[e[1]])) if tie_order else graph
    peers = take_peers(ordered, permitted)
    donors = [crowd_local.Donor(sim * metadata[j][1]/(metadata[j][1]+50), metadata[j][0],
                                ratings[j], errors[j]) for sim,j in peers]
    return donors, sum(d.stars <= 2.5 for d in donors)


def inputs(args):
    graded = read(args.graded)
    tiers = {(p['medium'], p['split'], p['budget']): {r['id']: r for r in p['targets']} for p in graded['runs']}
    nested = {(r['medium'], r['split'], r['budget'], r['group']): {p['id']: p['base'] for p in r['points']}
              for r in read(args.inner)}
    public = {r['id']: (r['score'], r['votes']) for r in read(args.public)['rows']}
    direct = {r['id']:r for r in read(args.direct)['ratings']}
    dated = {r['id']:r for r in read(args.dates)}
    assert len(direct) == 870
    catalogue = {}
    for data in read(args.capture):
        features = {r['work']['id']: r['features'] for r in data['history']}
        features.update({r['id']: r['features'] for r in data['catalogue']})
        catalogue[data['medium']] = {i:(score, votes, {g['id'] for g in features[i].get('genres', [])},
                                       {t['id'] for t in features[i].get('tags', [])})
                                    for i,(score,votes) in public.items() if i in features}
    full = list(full_history(read(args.team), [args.movies, args.shows]))
    earlier = list(earlier_days(read(args.archived), args.earlier))
    assert len(full) == 870 and len(earlier) == 382

    def prepare(records, cohort):
        result = []
        for row, scores, checked in records:
            i, medium = row['id'], row['medium']
            r = dict(id=i, name=row['title'], medium=medium, stars=row['stars'], base=scores['base'],
                     exact=row['exact'], both=scores['bothRemovals'], checked=checked, graph=[])
            result.append(r)
            if (r['exact'] != r['base'] or not r['both'] < 50 <= r['base'] or not row['votes']
                or utility(row['audience']/2) >= 50):
                continue
            public_data = catalogue[medium]
            assert public_data[i][:2] == (row['audience'], row['votes'])
            if cohort == 'earlier':
                canonical = tiers[medium, 'work', 'all']
                day = row['group']
                native = nested[medium, 'rolling-day', 'dated ratings only', day]
                allowed = {j:dated[j]['stars'] for j in native}
                assert all(dated[j]['at'][:10] < day for j in allowed)
                all_votes = {j: dated[j]['stars'] for j in canonical if j in dated and dated[j]['at'][:10] < day}
            elif cohort in ('franchise','reassigned-franchise'):
                canonical = tiers[medium,cohort,'all']
                group = row['group']
                native = nested[medium,cohort,'all',group]
                assert canonical[i]['group'] == group and all(canonical[j]['group'] != group for j in native)
                allowed = {j:canonical[j]['stars'] for j in native}
                all_votes = {j:direct[j]['stars'] for j in canonical if j in direct and canonical[j]['group'] != group}
            else:
                canonical = tiers[medium, 'franchise', 'all']
                group = canonical[i]['group']
                inner = nested[medium, 'franchise', 'all', group]
                allowed = {j:direct[j]['stars'] for j in canonical if j in direct}
                all_votes = allowed
                native = {j:canonical[j]['scores']['calibrated'] if canonical[j]['group'] == group else inner[j]
                          for j in allowed}
            allowed = {j:s for j,s in allowed.items() if canonical[j]['cluster'] != canonical[i]['cluster']}
            assert i not in allowed
            graph = crowd_local.work_neighbours(i, canonical, public_data, allowed)
            weak = {j:s for j,s in all_votes.items() if canonical[j]['cluster'] != canonical[i]['cluster']
                    and j in public_data and public_data[j][0] < 6}
            assert i not in weak
            weak_graph = crowd_local.work_neighbours(i, canonical, public_data, weak)
            r.update(graph=graph, allowed=allowed, metadata=public_data,
                     errors={j:utility(s)-native[j] for j,s in allowed.items()}, weak=weak, weak_graph=weak_graph,
                     public_errors={j:utility(s)-public_fit(*public_data[j][:2]) for j,s in weak.items()})
        return result
    sets = {'full':prepare(full,'full'), 'earlier':prepare(earlier,'earlier')}
    if args.franchises:
        archive = {(r['split'], r['id'],r['group']):r for r in read(args.archived) if r['budget']=='all'}
        grouped = defaultdict(list)
        for line in args.franchises.read_text().splitlines():
            held = json.loads(line)
            if held['id'] not in direct:
                continue
            row = archive[held['split'],held['id'],held['group']]
            assert direct[held['id']]['stars'] == held['stars'] == row['stars'] and row['base'] == held['scores']['base']
            grouped[held['split']].append((row, held['scores'], row['checked8Delta']))
        assert set(grouped) == {'franchise','reassigned-franchise'}
        for split, records in grouped.items():
            assert len(records) == len({r['id'] for r,_,_ in records}) == 870
            sets[split] = prepare(records,split)
    return sets


def evaluate(rows, tie_order, excluded, details=False, inclusive=False):
    metrics = {n:Counter() for n in (0,1,2,'medianNeutral')}
    evidence = []
    for r in rows:
        graph = r['graph']
        hit = False
        bad = 0
        calibrated = None
        if graph:
            allowed = r['allowed'].keys() - excluded
            pool = r['metadata']
            donors, bad = choose(graph, allowed, pool, r['allowed'], r['errors'], tie_order, inclusive)
            shift = crowd_local.propose(*pool[r['id']][:2], donors, cap=8)[2]
            if not excluded and not tie_order and not inclusive:
                assert abs(r['checked']-shift) < 1e-9
            hit = shift < 0
            if hit:
                low_public,_ = choose(r['weak_graph'], r['weak'].keys()-excluded, pool, r['weak'],
                                      r['public_errors'], tie_order, inclusive)
                if len(low_public) >= 2:
                    calibrated = public_fit(*pool[r['id']][:2]) + weighted_median([(d.error,d.weight) for d in low_public])
            if details:
                evidence.append(dict(id=r['id'], name=r['name'], shift=shift, peerDislikes=bad,
                                     calibrated=calibrated, stars=r['stars']))
        for n, counts in metrics.items():
            qualify = calibrated is not None and calibrated < 50 if n == 'medianNeutral' else bad + 1e-12 >= n
            score = r['both'] if hit and qualify else r['exact']
            if score < 50:
                counts['low' if r['stars'] <= 2.5 else str(r['stars'])] += 1
            counts['lowered4plus'] += r['stars'] >= 4 and score < r['base']
            counts['lowered5'] += r['stars'] == 5 and score < r['base']
    return metrics,evidence


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for n in ('capture','graded','inner','public','direct','dates','team','movies','shows','archived','earlier','output'):
        parser.add_argument(n,type=Path)
    parser.add_argument('--franchises',type=Path,help='Optional whole-franchise structural forecasts.')
    args = parser.parse_args()
    sets = inputs(args)
    full = sets['full']
    current_hits = {r['id'] for r in full if r['stars'] <= 2.5 and (
        r['exact'] < 50 or r['graph'] and r['checked'] < 0)}
    assert len(current_hits) == 8
    report = {}
    for label,records in sets.items():
        ids = sorted({j for r in records for name in ('graph','weak_graph') for _,j,_ in r.get(name,[])})
        default, evidence = evaluate(records,{},set(),True)
        without,_ = evaluate(records,{},current_hits)
        inclusive, tied_evidence = evaluate(records, {}, set(), True, inclusive=True)
        independent,_ = evaluate(records, {}, current_hits, inclusive=True)
        samples = []
        for seed in range(256 if label in ('full','earlier') else 0):
            keys = ids.copy()
            random.Random(seed).shuffle(keys)
            counts,_ = evaluate(records, {i:k for k,i in enumerate(keys)}, set())
            samples.append(counts)
        report[label] = dict(default=default, withoutOtherHitsAsPublicWitness=without,
                             tieInclusive=inclusive, tieInclusiveWithoutOtherHits=independent, tieEvidence=tied_evidence,
                             seededTieOrders=samples, evidence=evidence)
    write_new(args.output,report)
