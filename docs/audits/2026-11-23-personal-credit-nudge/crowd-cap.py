"""Is a smaller audience effect sufficient to explain better holdout outcomes?"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

import nudge


def trial(strict_rows, lead_rows, panels):
    keys = ('medium', 'split', 'budget', 'group', 'id')
    def identity(row):
        return tuple(row[key] for key in keys)
    expected = {(p['medium'], p['split'], p['budget'], t['group'], t['id']):
                (t['stars'], t['scores']['calibrated']) for p in panels for t in p['targets']}
    leads = {identity(r): r for r in lead_rows}
    assert len(strict_rows) == len(leads) == len(expected) == 13477
    assert set(map(identity, strict_rows)) == expected.keys() == leads.keys()
    folds = defaultdict(list)
    for i in strict_rows:
        k = identity(i)
        assert (i['stars'], i['baseline']) == expected[k] == (leads[k]['stars'], leads[k]['base'])
        original, strict = i['baseline'], i['strict']
        # Integer rounding commutes with clipping to integer bounds. These saved
        # forecasts are all interior, so none lost their original delta to a 0/100 clamp.
        assert isinstance(original, int) and isinstance(strict, int) and 0 < strict < 100
        delta = min(4, max(-4, strict - original))
        lead = leads[k]['guardedLead']
        folds[k[:3]].append(dict(i, base=original, cap=original + delta,
                                 lead=lead, leadCap=nudge.lineage.display(lead + delta)))
    output = []
    for (medium, split, budget), rows in folds.items():
        cells = {}
        for arm, baseline in [('base', 'base'), ('strict', 'base'), ('cap', 'base'),
                              ('lead', 'lead'), ('leadCap', 'lead')]:
            d = nudge.summarize(rows, arm, baseline)
            against = [r for r in rows if r['stars'] == 5 and r['audience'] is not None and
                       r['stars'] - r['audience'] / 2 >= 1]
            fields = ('n','down','up','unchanged','meanShift','red','newRed','green','lostGreen','newGreen')
            cells[arm] = {s: {k:d[s][k] for k in fields} for s in ('dislike', 'five', 'liked')}
            cells[arm].update(againstCrowdFive=dict(n=len(against),
                              down=sum(r[arm] < r[baseline] for r in against),
                              up=sum(r[arm] > r[baseline] for r in against),
                              lostGreen=sum(r[arm] < 80 <= r[baseline] for r in against)),
                              withinFold=d['withinFold'], likeOverDislike=d['likeOverDislike'],
                              mae=d['all']['mae'])
        output.append(dict(medium=medium, split=split, budget=budget, arms=cells))
    assert len(output) == 32
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ('archived_strict', 'guarded_leads', 'graded'):
        parser.add_argument(arg, type=Path)
    args = parser.parse_args()
    strict, leads, graded = (json.loads(p.read_bytes()) for p in
                             (args.archived_strict, args.guarded_leads, args.graded))
    print(json.dumps(trial(strict, leads, graded['runs']), separators=(',', ':'), allow_nan=False))
