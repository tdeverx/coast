"""Read the frozen exact-team and deterministic personalised TMDB experiment baseline.

All split-specific scores and memberships come from the original private ledgers.
Candidate experiments can use Holdout.eligible(id) to filter their other direct
ratings. The eligibility check is label-blind; it uses medium, family, held fold
and the training cutoff day only.
"""
from dataclasses import dataclass, field
import json

from raw_public import earlier_days, full_history
from team_audience import read


GROUPED = ('franchise', 'reassigned-franchise')


@dataclass(frozen=True)
class Holdout:
    id: str
    medium: str
    title: str
    stars: float
    family: str
    split: str
    group: str | int | None
    before: float
    native: float
    exact: float
    both: float
    _canonical: dict = field(repr=False, compare=False)
    _direct: dict = field(repr=False, compare=False)

    def eligible(self, donor_id):
        donor = self._direct.get(donor_id)
        if donor is None or donor['medium'] != self.medium:
            return False
        canonical = self._canonical[donor_id]
        if canonical['cluster'] == self.family:
            return False
        if self.split == 'earlier':
            return donor['at'][:10] < self.group
        if self.split in GROUPED:
            return canonical['group'] != self.group
        return True


def source_rows(args, direct):
    archived = read(args.archived)
    cohorts = {
        'full': list(full_history(read(args.team), [args.movie, args.show])),
        'earlier': list(earlier_days(archived, args.earlier)),
    }
    lookup = {(r['medium'], r['split'], r['group'], r['id']): r
              for r in archived if r['budget'] == 'all'}
    with args.grouped.open() as file:
        for line in file:
            item = json.loads(line)
            if item['id'] in direct:
                key = tuple(item[k] for k in ('medium', 'split', 'group', 'id'))
                r = lookup[key]
                assert r['stars'] == item['stars'] and r['base'] == item['scores']['base']
                cohorts.setdefault(r['split'], []).append((r, item['scores'], r['checked8Delta']))
    return cohorts


def retained_panels(args):
    direct = {r['id']: r for r in read(args.direct)['ratings']}
    panels = {(r['medium'], r['split']): {t['id']: t for t in r['targets']}
              for r in read(args.graded)['runs'] if r['budget'] == 'all'}
    witness = read(args.witness)
    result = {}
    for split, inputs in source_rows(args, direct).items():
        evidence = {r['id']: r for r in witness[split]['tieEvidence']}
        rows = []
        for row, scores, _ in inputs:
            i, medium = row['id'], row['medium']
            assert direct[i]['stars'] == row['stars'] and direct[i]['medium'] == medium
            before = row['exact']
            support = evidence.get(i)
            if support and support['shift'] < 0 and support['calibrated'] is not None and support['calibrated'] < 50:
                assert before == scores['base'] and scores['bothRemovals'] < 50 <= before
                before = scores['bothRemovals']
            canonical = panels[medium, split if split in GROUPED else 'franchise']
            target = canonical[i]
            group = row.get('group')
            if split == 'earlier':
                assert direct[i]['at'][:10] == group
            if split in GROUPED:
                assert target['group'] == group
            held = Holdout(id=i, medium=medium, title=row['title'], stars=row['stars'],
                           family=target['cluster'], split=split, group=group, before=before,
                           native=scores['base'], exact=row['exact'], both=scores['bothRemovals'],
                           _canonical=canonical, _direct=direct)
            assert not held.eligible(i)
            rows.append(held)

        assert len(rows) == len({r.id for r in rows}) == (382 if split == 'earlier' else 870)
        if split != 'earlier':
            assert {r.id for r in rows} == direct.keys()
        original = witness[split]['tieInclusive']['medianNeutral']
        assert sum(r.before < 50 and r.stars <= 2.5 for r in rows) == original.get('low', 0)
        for grade in {r.stars for r in rows if r.stars > 2.5}:
            assert sum(r.before < 50 and r.stars == grade for r in rows) == original.get(str(grade), 0)
        result[split] = rows
    assert result.keys() == {'full', 'earlier', *GROUPED}
    return direct, result
