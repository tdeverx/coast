"""Compare a yes/no public override with the score both estimates actually support."""
import argparse
from collections import defaultdict
from pathlib import Path

from raw_public import earlier_days, full_history
from team_audience import compare, display, read, write_new


def measure(holdouts, evidence):
    checks = {r['id']: r for r in evidence}
    assert len(checks) == len(evidence)
    seen = set()
    arms = defaultdict(list)
    for row, scores, _ in holdouts:
        i, base, raw = row['id'], scores['base'], scores['bothRemovals']
        exact = row['exact']
        binary = bounded = exact
        if i in checks:
            seen.add(i)
            e = checks[i]
            assert exact == base and raw < 50 <= base and row['stars'] == e['stars']
            estimated = e['calibrated']
            if e['shift'] < 0 and estimated is not None and estimated < 50:
                binary = raw
                if display(estimated) < 50:
                    bounded = max(raw, display(estimated))
        for name, value in (('native', base), ('exact', exact), ('binary', binary), ('bounded', bounded)):
            arms[name].append((row, value, base))
    assert seen == checks.keys()
    out = {}
    for name, sample in arms.items():
        metrics = compare(sample)
        metrics['byStarsBelow50'] = {str(stars): sum(r['stars'] == stars and s < 50 for r,s,_ in sample)
                                     for stars in sorted({r['stars'] for r,_,_ in sample})}
        metrics['loweredAboveNeutral'] = sum(r['stars'] > 3 and s < b for r,s,b in sample)
        metrics['cases'] = [dict(id=r['id'], stars=r['stars'], before=b, after=s) for r,s,b in sample if s < 50]
        out[name] = metrics
    return out


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for key in ('teams', 'movie', 'show', 'archived', 'earlier', 'peers', 'output'):
        p.add_argument(key, type=Path)
    a = p.parse_args()
    peer = read(a.peers)
    write_new(a.output, {
        'full': measure(full_history(read(a.teams), [a.movie, a.show]), peer['full']['tieEvidence']),
        'earlier': measure(earlier_days(read(a.archived), a.earlier), peer['earlier']['tieEvidence'])
    })
