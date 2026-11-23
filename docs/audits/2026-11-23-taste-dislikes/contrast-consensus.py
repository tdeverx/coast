"""Intersect the already fitted controls by exact target/fold. Reads a private change ledger."""
import json
import sys
from collections import Counter


def key(row):
    return row['medium'], row['split'], row['budget'], row['group'], row['id']


def main():
    if len(sys.argv)!=3:
        raise SystemExit('Usage: contrast-consensus.py GRADED_HOLDOUTS PRIVATE_PAIRED_CHANGES')
    with open(sys.argv[1],encoding='utf-8') as f:
        runs=json.load(f)['runs']
    with open(sys.argv[2],encoding='utf-8') as f:
        changes=json.load(f)
    lookup={}
    for r in changes:
        target=lookup.setdefault(key(r),{})
        if r['arm'] in target:
            raise ValueError('Duplicate private prediction')
        target[r['arm']]=r
    result=[]
    for run in runs:
        cells={arm:Counter() for arm in ('neighbours','linear','agreement')}
        for target in run['targets']:
            base=target['scores']['calibrated']
            if base is None: continue
            predictions=lookup.pop(key({**run,**target}),{})
            if any(r['before']!=base or r['stars']!=target['stars'] for r in predictions.values()):
                raise ValueError('Stale base or target label')
            fitted=[predictions[k]['after'] if k in predictions else base for k in ('neighbours','linear')]
            # Only unanimous downward differences count, and use the less negative score.
            both=max(fitted) if len(predictions)==2 and max(fitted)<min(50,base) else base
            stars=target['stars']
            for arm,value in zip(cells,(*fitted,both)):
                c=cells[arm]
                c['changed']+=int(value!=base)
                c['rescuedDisliked']+=int(stars<=2.5 and value<50<=base)
                c['newLikedReds']+=int(stars>=4 and value<50<=base)
                c['newFourAndHalfOrFiveReds']+=int(stars>=4.5 and value<50<=base)
                c['fourAndHalfOrFiveLowered']+=int(stars>=4.5 and value<base)
                c['fourAndHalfOrFiveLostGreen']+=int(stars>=4.5 and value<80<=base)
                c['fiveLowered']+=int(stars==5 and value<base)
                c['fiveLostGreen']+=int(stars==5 and value<80<=base)
                c['fiveRetainedGreen']+=int(stars==5 and min(base,value)>=80)
        result.append(dict(medium=run['medium'],split=run['split'],budget=run['budget'],control=cells))
    if lookup: raise ValueError('Unknown target in private ledger')
    print(json.dumps(result,separators=(',',':')))


if __name__=='__main__':
    main()
