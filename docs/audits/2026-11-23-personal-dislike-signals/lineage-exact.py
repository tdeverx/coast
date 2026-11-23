"""Compare actual dislikes from identical creative leads with negative model residuals."""
import hashlib
import json
import os
import sys
from collections import defaultdict
from statistics import mean
import lineage


def allowed_ratings(rows, dates, targets, group, split, budget):
    if split == 'rolling-day':
        return {i:dates[i]['stars'] for i in rows if i in dates and dates[i]['at'][:10] < group}
    ids = rows.keys() - {t['id'] for t in targets}
    if budget != 'all':
        size, _, seed = budget.partition('#')
        ids = sorted(ids,key=lambda i:hashlib.sha256(f'solo:{seed or "1"}:{i}'.encode()).hexdigest())[:int(size)]
    return {i:rows[i]['stars'] for i in ids}


def run(metadata, dates, graded, inner, donor_compatible=None):
    media = {r['id']:r for r in metadata}
    opinions = {r['id']:r for r in dates}
    receipt = {(r['medium'],r['split'],r['budget'],r['group']):r['points'] for r in inner}
    output, private = [], []
    for kind in ('movie','show'):
        panels = [r for r in graded['runs'] if r['medium']==kind]
        whole = next(r for r in panels if r['split']=='work' and r['budget']=='all')
        canonical = {r['id']:r for r in whole['targets']}
        crews = {i:frozenset(lineage.authors(media.get(i,{}),kind)[0]) for i in canonical}
        for panel in panels:
            groups = defaultdict(list)
            for t in panel['targets']:
                groups[t['group']].append(t)
            all_rows = []
            for group, held in groups.items():
                known = allowed_ratings(canonical,opinions,held,group,panel['split'],panel['budget'])
                forecasts = {p['id']:p['base'] for p in receipt[kind,panel['split'],panel['budget'],group]}
                assert forecasts.keys()<=known.keys()
                assert not known.keys() & {t['id'] for t in held}
                history = defaultdict(list)
                for j in sorted(known):
                    if crews[j]:
                        history[crews[j]].append(j)
                for target in held:
                    work = target['id']
                    base = target['scores']['calibrated']
                    if base is None:
                        continue
                    exact = [j for j in history.get(crews[work],[]) if canonical[j]['cluster']!=target['cluster']]
                    row = dict(id=work,stars=target['stars'],group=group,base=base,one=base,two=base,
                               type=None,strongest=exact)
                    if exact and all(known[j]<=2.5 for j in exact):
                        donors = defaultdict(list)
                        for j in exact:
                            if j in forecasts and (donor_compatible is None or donor_compatible(work, j)):
                                donors[canonical[j]['cluster']].append(lineage.utility(known[j])-forecasts[j])
                        if donors:
                            delta = min(0., mean(mean(r) for r in donors.values()))
                            row['one'] = lineage.display(base+delta)
                            if len(donors)>=2:
                                row['two'] = row['one']
                            row['families'] = len(donors)
                    if exact:
                        private.append(dict(medium=kind,split=panel['split'],budget=panel['budget'],
                                            title=media.get(work,{}).get('title'),**row))
                    all_rows.append(row)
            output.append(dict(medium=kind,split=panel['split'],budget=panel['budget'],
                               arms={arm:lineage.metrics(all_rows,arm) for arm in ('base','one','two')}))
    return output, private


if __name__=='__main__':
    if len(sys.argv)!=5:
        raise SystemExit('Usage: lineage-exact.py METADATA VERIFIED_DATES GRADED INNER_PERSONAL_SCORES')
    result, details = run(*(lineage.read(p) for p in sys.argv[1:]))
    if path := os.environ.get('COAST_PERSONAL_LINEAGE_PRIVATE'):
        with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as file:
            json.dump(details,file,separators=(',',':'))
    print(json.dumps(result,separators=(',',':')))
