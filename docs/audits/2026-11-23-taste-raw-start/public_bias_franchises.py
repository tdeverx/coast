"""Replay the fixed public-median guard with all members of each outer fold hidden."""
import argparse
from collections import defaultdict
import json
from pathlib import Path

from public_bias import evaluate, inputs
from team_audience import compare, read, write_new


def replay(graded, archived, raw, labels, catalogue):
    output = {}
    for split in ('franchise', 'reassigned-franchise'):
        scores = defaultdict(list)
        direct = {r['id']: r for r in labels}
        seen = set()
        for panel in graded['runs']:
            if panel['split'] != split or panel['budget'] != 'all':
                continue
            medium = panel['medium']
            families = defaultdict(set)
            assignments = {}
            for target in panel['targets']:
                families[target['cluster']].add(target['group'])
                assignments[target['id']] = target['group']
            assert all(len(parts) == 1 for parts in families.values())
            for group in sorted(set(assignments.values())):
                train = [r for r in labels if r['medium'] == medium and assignments[r['id']] != group]
                held = []
                for t in panel['targets']:
                    if t['group'] != group:
                        continue
                    i = t['id']
                    key = (medium, split, group, i)
                    a, b = archived[key], raw[key]
                    assert a['base'] == b['scores']['base'] == t['scores']['calibrated']
                    assert a['stars'] == b['stars'] == t['stars']
                    if i in direct:
                        assert direct[i]['stars'] == a['stars'] and i not in seen
                        seen.add(i)
                        held.append((a, b['scores'], a['checked8Delta']))
                assert {a['id'] for a,_,_ in held}.isdisjoint(r['id'] for r in train)
                guard = evaluate(held, catalogue, train, chronological=False)
                red_ids = {k:set(v['redIds']) for k,v in guard.items()}
                for a, s, _ in held:
                    for name in ('native','exact','original','medianNeutral'):
                        value = a['base'] if name == 'native' else a['exact']
                        if name in ('original','medianNeutral') and a['id'] in red_ids[name] and value >= 50:
                            value = s['bothRemovals']
                        assert (value < 50) == (a['id'] in red_ids[name])
                        scores[name].append((a, value, a['base']))
        assert seen == direct.keys() and len(seen) == 870
        out = {}
        for name, sample in scores.items():
            metrics = compare(sample)
            metrics['fourPlusLower'] = sum(s < base and r['stars'] >= 4 for r,s,base in sample)
            metrics['redByStars'] = {str(grade): sum(r['stars'] == grade and s < 50 for r,s,_ in sample)
                                     for grade in sorted({r['stars'] for r,_,_ in sample})}
            metrics['redCases'] = [dict(id=r['id'], stars=r['stars'], before=b, after=s)
                                   for r,s,b in sample if s < 50]
            out[name] = metrics
        output[split] = out
    return output


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for k in ('graded','capture','public','direct','archived','native','output'):
        cli.add_argument(k, type=Path)
    a = cli.parse_args()
    frozen = read(a.graded)
    base = {(r['medium'],r['split'],r['group'],r['id']):r for r in read(a.archived) if r['budget']=='all'}
    raw = [json.loads(line) for line in a.native.read_text().splitlines()]
    indexed = {(r['medium'],r['split'],r['group'],r['id']):r for r in raw}
    assert len(indexed) == len(raw) == 1746
    catalogue = inputs(read(a.capture), frozen, read(a.public))
    write_new(a.output, replay(frozen, base, indexed, read(a.direct)['ratings'], catalogue))
