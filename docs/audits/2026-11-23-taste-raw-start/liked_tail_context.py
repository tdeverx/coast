"""Compare held forecasts across one-genre comedies, mixed-genre comedies, and other shows."""
from argparse import ArgumentParser
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median

from team_audience import read, write_new


def run(args):
    direct = {r['id']: r for r in read(args.direct)['ratings']}
    original = read(args.cohort)['full']['cases']
    capped = {r['id']: r for r in read(args.margin)['cohorts']['full']['candidates']}
    assert len(original) == len(direct) == 870 and {r['id'] for r in original} == direct.keys()
    panel = next(p for p in read(args.capture) if p['medium'] == 'show')
    features = {r['work']['id']: r['features'] for r in panel['history']}
    features.update({r['id']: r['features'] for r in panel['catalogue']})
    groups = defaultdict(list)
    for r in original:
        i = r['id']
        assert r['medium'] == direct[i]['medium'] and r['stars'] == direct[i]['stars']
        if r['medium'] != 'show':
            continue
        genres = {g['id'] for g in features[i].get('genres', [])}
        category = 'comedyOnly' if genres == {'comedy'} else 'mixedComedy' if 'comedy' in genres else 'other'
        score = r['before']
        if i in capped:
            assert score == capped[i]['before']
            score = capped[i]['cueScaled']
        groups[category].append((r, score))
    report = {}
    for category, rows in groups.items():
        rating_counts = Counter(r['stars'] for r, _ in rows)
        scores = defaultdict(list)
        for r, score in rows:
            scores[str(r['stars'])].append(score)
            if r['stars'] <= 2.5:
                scores['disliked'].append(score)
        summaries = {k: dict(count=len(v), median=median(v), lowest=min(v), highest=max(v))
                     for k, v in scores.items()}
        report[category] = dict(works=len(rows), ratingCounts=dict(sorted(rating_counts.items())), scores=summaries)
    assert sum(g['works'] for g in report.values()) == 426
    write_new(args.output, report)


if __name__ == '__main__':
    parser = ArgumentParser(description=__doc__)
    for arg in ('capture', 'direct', 'cohort', 'margin', 'output'):
        parser.add_argument(arg, type=Path)
    run(parser.parse_args())
