"""Replay whether a viewer's cross-fitted errors in the same score band justify restoring part of the display score."""
from argparse import ArgumentParser
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean

from retained_panels import GROUPED, retained_panels
from soft_calibration import family_days, inputs, lift
from team_audience import read, utility, write_new


def comparisons(row, direct, dated, family_first, tiers, inner):
    # The donor forecast must exclude both the candidate and donor labels, including their families.
    if row.split == 'earlier':
        for donor in dated:
            if not row.eligible(donor.id):
                continue
            if donor.group > min(family_first[row.medium, row.family], family_first[row.medium, donor.family]):
                continue
            yield donor.family, donor.native, donor.stars
        return
    split = row.split if row.split in GROUPED else 'franchise'
    tier = tiers[row.medium, split]
    group = tier[row.id]['group']
    errors = inner[row.medium, split, group]
    for key, candidate in tier.items():
        if not row.eligible(key):
            continue
        score = candidate['scores']['calibrated'] if candidate['group'] == group else errors[key]
        yield candidate['cluster'], score, direct[key]['stars']


def band_guard(row, step, donors):
    families = defaultdict(list)
    has_low = False
    for family, prediction, stars in donors:
        if prediction // 5 != row.native // 5:
            continue
        outcome = utility(stars)
        families[family].append(abs(prediction - outcome) - abs(prediction + step - outcome))
        has_low |= stars <= 2.5
    wins = sum(mean(errors) > 0 for errors in families.values())
    supported = len(families) >= 8 and 4 * wins >= 3 * len(families)
    return supported, supported and not has_low, len(families)


def evaluate(args):
    direct, panels = retained_panels(args)
    tiers, inner, whole = inputs(args, direct)
    first_days = family_days(read(args.dates), tiers)
    margins = read(args.margin)['cohorts']
    content = read(args.content)
    output = {}
    for split, rows in panels.items():
        if split == 'full' and not whole:
            continue
        adjusted = {c['id']: c['cueScaled'] for c in margins[split]['candidates']}
        agreements = {c['id']: c for c in content[split]['cases']}
        cases = []
        for r in rows:
            if split == 'full':
                raw, native = whole[r.id]['raw'], whole[r.id]['native']
            else:
                target = tiers[r.medium, split if split in GROUPED else 'rolling-day'][r.id]
                assert target['group'] == r.group and target['stars'] == r.stars
                raw, native = (target['scores'][s] for s in ('balanced', 'calibrated'))
            assert native == r.native
            selected = adjusted.get(r.id, r.before)
            half = lift(selected, raw, native, .5)
            plain, guarded, agreement, n = False, False, False, 0
            if half > selected:
                plain, guarded, n = band_guard(r, half-selected,
                        comparisons(r, direct, panels['earlier'], first_days, tiers, inner))
                match = agreements[r.id]
                if match['agree']:
                    donor = match['plotDonor']
                    assert match['tagDonor'] == donor and match['shared'] >= 2 and r.eligible(donor)
                    agreement = direct[donor]['stars'] >= 4
            cases.append(dict(id=r.id, medium=r.medium, stars=r.stars, families=n, selected=selected,
                              half=half, band=half if plain else selected, guarded=half if guarded else selected,
                              plotTags=half if agreement else selected))
        metrics = {}
        for arm in ('selected','half','band','guarded','plotTags'):
            moved = [r for r in cases if r[arm] > r['selected']]
            assert all(r[arm] == r['selected'] for r in cases if r['selected'] <= 50 or r['selected'] >= 80)
            metrics[arm] = dict(moved=dict(sorted(Counter(r['stars'] for r in moved).items())),
                                points=dict(sorted((s, sum(r[arm] - r['selected'] for r in moved if r['stars'] == s))
                                                   for s in {r['stars'] for r in moved})),
                                green=dict(sorted(Counter(r['stars'] for r in moved if r[arm] >= 80).items())),
                                red=sum(r['stars'] <= 2.5 and r[arm] < 50 for r in cases),
                                low=sum(r['stars'] <= 2.5 for r in moved),
                                high=sum(r['stars'] >= 4 for r in moved),
                                mae=mean(abs(r[arm]-utility(r['stars'])) for r in cases))
        output[split] = dict(metrics=metrics, cases=cases)
    write_new(args.output, output)


if __name__ == '__main__':
    cli = ArgumentParser(description=__doc__)
    for name in ('graded','direct','team','movie','show','archived','earlier','grouped','witness',
                 'inner','dates','margin','content','output'):
        cli.add_argument(name, type=Path)
    cli.add_argument('--raw', nargs=2, type=Path)
    evaluate(cli.parse_args())
