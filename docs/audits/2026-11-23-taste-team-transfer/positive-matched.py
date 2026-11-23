"""Does positive transfer locate stronger opinions among already similarly scored titles?"""
import json
import sys
from collections import defaultdict
from statistics import mean

import positive


def compare(capture, metadata, archive, changes):
    lead_meta = {r['id']:r for r in metadata}
    changed = {(r['medium'],r['split'],r['budget'],r['id']) for r in changes if r['one'] > r['base']}
    features = {r['work']['id']:{v['id'] for v in r['features'].get('genres',[])}
                for d in capture for r in d['history']}
    result = []
    for panel in archive['runs']:
        medium, split, budget = (panel[k] for k in ('medium','split','budget'))
        prefix = (medium,split,budget)
        targets = {r['id']:r for r in panel['targets'] if r['scores']['calibrated'] is not None}
        teams = {i:tuple(sorted(positive.lineage.authors(lead_meta[i],medium)[0])) for i in targets}
        hits = {i for i in targets if (*prefix,i) in changed}
        neighbours, distinct, by_team = {}, set(), defaultdict(list)
        for i in sorted(hits):
            t = targets[i]
            ranked = []
            for j in targets.keys()-hits:
                peer = targets[j]
                if teams[j]==teams[i] or peer['cluster']==t['cluster'] or peer['group']!=t['group']:
                    continue
                distance = abs(t['scores']['calibrated']-peer['scores']['calibrated'])
                overlap = positive.lineage.overlap(features[i],features[j])
                if distance <= 3 and overlap >= .5:
                    ranked.append((distance,-overlap,j))
            families = {}
            for _,_,j in sorted(ranked):
                families.setdefault(targets[j]['cluster'],j)
                if len(families)==3:
                    break
            if families:
                neighbours[i] = list(families.values())
                distinct.update(families.values())
        for i, neighbors in neighbours.items():
            labels = [targets[j]['stars'] for j in neighbors]
            truth = targets[i]['stars']
            by_team[teams[i]].append((truth,mean(labels),float(truth>=4),mean(s>=4 for s in labels)))
        def average(rows):
            return [round(mean(r[c] for r in rows),4) for c in range(4)] if rows else None
        result.append(dict(medium=medium,split=split,budget=budget,changed=len(hits),matched=len(neighbours),
                           distinctControls=len(distinct),teams=len(by_team),
                           byWork=average([r for v in by_team.values() for r in v]),
                           byTeam=average([average(v) for v in by_team.values()])))
    return result


if __name__=='__main__':
    if len(sys.argv)!=5:
        raise SystemExit('Usage: positive-matched.py CAPTURE METADATA GRADED PRIVATE_POSITIVE_PREDICTIONS')
    print(json.dumps(compare(*(positive.lineage.read(p) for p in sys.argv[1:])),separators=(',',':')))
