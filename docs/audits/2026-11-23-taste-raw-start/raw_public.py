"""Measure the two original component removals and the public corroboration control."""
import argparse
from collections import defaultdict
import json
from pathlib import Path

from team_audience import compare, read, utility, write_new


def full_history(personal, ledgers):
    rows = {r['id']: r for r in personal}
    assert len(rows) == len(personal) == 870 and len(ledgers) == 2
    seen = set()
    for path in ledgers:
        saved = [json.loads(line) for line in path.read_text().splitlines()]
        assert saved[0]['type'] == 'receipt' and saved[-1]['type'] == 'complete'
        for holdout in saved[1:-1]:
            i = holdout['id']
            assert i not in seen
            seen.add(i)
            row, scores = rows[i], holdout['scores']
            base = scores['base']
            assert row['native'] == base and row['stars'] == holdout['stars'] and row['medium'] == saved[0]['medium']
            yield row, scores, row['weights']['8']
    assert seen == rows.keys()


def earlier_days(archived, ledger):
    rows = {(r['medium'], r['id'], r['group']): r for r in archived
            if (r['split'], r['budget']) == ('rolling-day', 'dated ratings only')}
    assert len(rows) == 382
    seen = set()
    for line in ledger.read_text().splitlines():
        held = json.loads(line)
        if 'id' not in held:
            continue
        key = (held['medium'], held['id'], held['day'])
        assert key not in seen
        seen.add(key)
        row = rows[key]
        assert row['stars'] == held['stars'] and row['base'] == held['scores']['base']
        yield row, held['scores'], row['checked8Delta']
    assert seen == rows.keys()


def run(inputs):
    forecasts = defaultdict(list)
    for row, scores, shift in inputs:
        base, both = scores['base'], scores['bothRemovals']
        public = 50
        if row['votes'] and row['audience'] is not None:
            public += (utility(row['audience'] / 2) - 50) * row['votes'] / (row['votes'] + 50)
        supported = both < 50 <= base and public < 50 and shift < 0
        variants = dict(scores, exactOnly=row['exact'], corroborated=both if supported else base,
                        exactThenCorroborated=row['exact'] if row['exact'] != base or not supported else both)
        for name, value in variants.items():
            forecasts[name].append((row, value, base))
    result = {}
    for name, sample in forecasts.items():
        stats = compare(sample)
        stats.update(
            fourPlusRed=sum(r['stars'] >= 4 and s < 50 for r,s,_ in sample),
            middleRed=sum(2.5 < r['stars'] < 4 and s < 50 for r,s,_ in sample),
            newlyRed=[r['id'] for r,s,b in sample if s < 50 <= b],
            named={r['title']:s for r,s,_ in sample if r['title'] in ('Farzar', 'Rick and Morty')},
        )
        result[name] = stats
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('team_private', type=Path, help='Full-history team results, or archived team data for --earlier.')
    parser.add_argument('output', type=Path)
    parser.add_argument('ledgers', nargs='+', type=Path)
    parser.add_argument('--earlier', action='store_true', help='Use one combined earlier-rating-day ledger.')
    args = parser.parse_args()
    personal = read(args.team_private)
    if args.earlier and len(args.ledgers) != 1:
        parser.error('--earlier expects one combined ledger.')
    inputs = earlier_days(personal, args.ledgers[0]) if args.earlier else full_history(personal, args.ledgers)
    write_new(args.output, run(inputs))
