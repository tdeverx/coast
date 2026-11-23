"""Build a private ranked report and verify the selected capped rules against every held favourite."""
from argparse import ArgumentParser
import os
from pathlib import Path
from statistics import mean, median

from retained_panels import retained_panels
from team_audience import read


def same_medium_order(rows, scores):
    liked = [r for r in rows if r.stars >= 4]
    low = [r for r in rows if r.stars <= 2.5]
    return 100 * mean((scores[h.id] > scores[l.id]) + .5 * (scores[h.id] == scores[l.id])
                      for h in liked for l in low if h.medium == l.medium)


def report(args):
    _, panels = retained_panels(args)
    margin = read(args.margin)['cohorts']
    scores, metrics = {}, []
    for split, rows in panels.items():
        selected = {r.id: r.before for r in rows}
        for change in margin[split]['candidates']:
            assert selected[change['id']] == change['before']
            selected[change['id']] = change['cueScaled']
        assert all(selected[r.id] == r.native for r in rows if r.stars >= 4)
        scores[split] = selected
        native = {r.id: r.native for r in rows}
        metrics.append((split, sum(r.stars <= 2.5 for r in rows),
                        sum(r.stars <= 2.5 and native[r.id] < 50 for r in rows),
                        sum(r.stars <= 2.5 and selected[r.id] < 50 for r in rows),
                        same_medium_order(rows, native), same_medium_order(rows, selected)))
    full = panels['full']
    ranks = scores['full']
    lines = ['# Lowest matches among your highly rated titles', '',
             'Each row uses your prediction with that title’s own activity and rating withheld. '
             'The next two columns withhold whole franchises. The last column admits only ratings from earlier days. '
             'A dash means the title was outside the dated cohort. Scores use the exact-team and personalised TMDB checks '
             'and cap the newer penalties by the similarity margin. All 610 titles rated four stars or higher received '
             'the same scores as the underlying personal model on the full replay.', '',
             '| Holdout | Dislikes | Below 50 before | Below 50 after | Liked over disliked before | Liked over disliked after |',
             '| --- | ---: | ---: | ---: | ---: | ---: |']
    for split, count, before, after, old_rank, new_rank in metrics:
        lines.append(f'| {split} | {count} | {before} | {after} | {old_rank:.2f}% | {new_rank:.2f}% |')
    lines.extend(['', 'Ordering compares each four-star-or-better title with each dislike in the same medium, giving '
                  'half credit for ties. The grouped and dated rows pool forecasts within each medium. These panels '
                  'reuse many of the same titles.'])
    for stars in (4, 4.5, 5):
        ordered = sorted((r for r in full if r.stars == stars), key=lambda r: (ranks[r.id], r.title, r.id))
        cut = ranks[ordered[min(9, len(ordered) - 1)].id]
        lines.extend(['', f'## {stars:g} stars', '',
                      f'{len(ordered)} titles. Median match {median(ranks[r.id] for r in ordered):g}%. '
                      'The table includes all ties at the tenth-lowest score.', '',
                      '| Title | Medium | Whole title | Franchise | Regrouped | Earlier days |',
                      '| --- | --- | ---: | ---: | ---: | ---: |'])
        for r in ordered:
            if ranks[r.id] > cut:
                break
            title = r.title.replace('|', r'\|').replace('\n', ' ')
            values = [str(scores[k][r.id]) + '%' if r.id in scores[k] else '—'
                      for k in ('full', 'franchise', 'reassigned-franchise', 'earlier')]
            lines.append('| ' + ' | '.join([title, r.medium, *values]) + ' |')
    with os.fdopen(os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    cli = ArgumentParser(description=__doc__)
    for name in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness', 'margin', 'output'):
        cli.add_argument(name, type=Path)
    report(cli.parse_args())
