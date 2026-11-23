"""Summarize all frozen panels without publishing personal titles or individual ratings."""
import json
import sys
from collections import defaultdict
from statistics import mean

import nudge


def outcomes(rows, arm, baseline):
    groups = {
        'dislikes': [r for r in rows if r['stars'] <= 2.5],
        'five': [r for r in rows if r['stars'] == 5],
        'disagreementFive': [r for r in rows if r['stars'] == 5 and r['audience'] is not None
                             and r['stars'] - r['audience'] / 2 >= 1],
    }
    summary = {}
    for name, sample in groups.items():
        summary[name] = dict(n=len(sample), lower=sum(r[arm] < r[baseline] for r in sample),
                             higher=sum(r[arm] > r[baseline] for r in sample), red=sum(r[arm] < 50 for r in sample),
                             lostGreen=sum(r[arm] < 80 <= r[baseline] for r in sample),
                             gainedGreen=sum(r[baseline] < 80 <= r[arm] for r in sample))
    summary['likedNewRed'] = sum(r['stars'] >= 4 and r[arm] < 50 <= r[baseline] for r in rows)
    summary['changed'] = sum(r[arm] != r[baseline] for r in rows)
    summary['meanAbsoluteError'] = round(mean(abs(r[arm] - nudge.lineage.utility(r['stars'])) for r in rows), 6)
    summary.update(nudge.order(rows, arm))
    return summary


if __name__ == '__main__':
    panels = defaultdict(list)
    for row in nudge.lineage.read(sys.argv[1]):
        panels[row['medium'], row['split'], row['budget']].append(row)
    assert len(panels) == 32 and sum(map(len, panels.values())) == 13477
    summary = []
    for (medium, split, budget), rows in panels.items():
        arms = {name: outcomes(rows, name, 'lead' if name.startswith('lead') else 'base')
                for name in ('base', 'small', 'agreement', 'checked', 'lead', 'leadChecked')}
        summary.append(dict(medium=medium, split=split, budget=budget, n=len(rows), arms=arms))
    print(json.dumps(summary, separators=(',', ':'), allow_nan=False))
