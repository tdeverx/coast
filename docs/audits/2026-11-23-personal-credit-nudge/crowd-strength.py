"""Match the checked nudge's signed movement before evaluating the held personal labels."""
import json
import math
import sys
from collections import Counter, defaultdict
from statistics import mean

import nudge


def match_budget(rows):
    sides = defaultdict(list)
    counts = Counter()
    for r in rows:
        proposal, checked = r['smallDelta'], r['checkedDelta']
        assert abs(checked) <= abs(proposal) + 1e-12 and checked * proposal >= 0
        r['matchedDelta'] = 0.
        if proposal:
            sides[(r['group'], proposal > 0)].append(r)
    for group in sides.values():
        raw = math.fsum(abs(r['smallDelta']) for r in group)
        retained = math.fsum(abs(r['checkedDelta']) for r in group)
        factor = retained / raw
        for r in group:
            r['matchedDelta'] = r['smallDelta'] * factor
        assert math.isclose(math.fsum(abs(r['matchedDelta']) for r in group), retained, abs_tol=1e-12)
        counts['nonemptyDirections'] += 1
        counts['singletonDirections'] += len(group) == 1
        counts['zeroRetainedDirections'] += retained == 0
        if len(group) > 1 and retained > 0:
            counts['multiTargetNonzeroDirections'] += 1
            counts['targetsInMultiTargetNonzeroDirections'] += len(group)
    for r in rows:
        r['matched'] = nudge.lineage.display(r['base'] + r['matchedDelta'])
        counts['scoresDistinguishableAfterRounding'] += r['checked'] != r['matched']
    return counts


def measurements(rows, arm):
    strength = 'checkedDelta' if arm == 'checked' else 'matchedDelta'
    lows = [r for r in rows if r['stars'] <= 2.5]
    fives = [r for r in rows if r['stars'] == 5]
    exceptional = [r for r in fives if r['audience'] is not None and r['stars'] - r['audience'] / 2 >= 1]
    ranking = nudge.order(rows, arm)
    return dict(dislikes=len(lows), dislikesLower=sum(r[arm] < r['base'] for r in lows),
                dislikesHigher=sum(r[arm] > r['base'] for r in lows),
                disagreeingFives=len(exceptional), disagreeingFivesLower=sum(r[arm] < r['base'] for r in exceptional),
                fives=len(fives), fivesLostGreen=sum(r[arm] < 80 <= r['base'] for r in fives),
                allPairOrder=ranking['withinFold'], polarOrder=ranking['likeOverDislike'],
                continuousMAE=mean(abs(r['base'] + r[strength] - nudge.lineage.utility(r['stars'])) for r in rows))


def run(rows):
    panels = defaultdict(list)
    for r in rows:
        panels[r['medium'], r['split'], r['budget']].append(r)
    assert len(rows) == 13477 and len(panels) == 32
    result = []
    for (medium, split, budget), data in panels.items():
        counts = match_budget(data)
        result.append(dict(medium=medium, split=split, budget=budget, scored=len(data), design=dict(counts),
                           arms={arm: measurements(data, arm) for arm in ('checked', 'matched')}))
    return result


if __name__ == '__main__':
    print(json.dumps(run(nudge.lineage.read(sys.argv[1])), separators=(',', ':'), allow_nan=False))
