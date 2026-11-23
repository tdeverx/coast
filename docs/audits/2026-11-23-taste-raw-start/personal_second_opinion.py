"""Require both personal content counterevidence and the prior structural alternative to cross 50.

The surrounding replay experiments produce one label-blind candidate and a native alternative
per hidden title. Keep the higher of the two below-neutral predictions. Where either stays at
or above 50, preserve the retained score, including the person/studio comparison.
"""
from argparse import ArgumentParser
from pathlib import Path

from retained_panels import retained_panels
from team_audience import read, write_new


def run(args):
    _, panels = retained_panels(args)
    studio, story, content = (read(getattr(args, name)) for name in ('studio', 'story', 'content'))
    results = {}
    for split, rows in panels.items():
        alt = {r['id']: r for r in studio[split]['changes']['sameKindCompany']}
        joint = {r['id']: r for r in story[split]['changes']}
        nearest = {r['id']: r for r in content[split]['cases']}
        assert set(nearest) == {r.id for r in rows}
        assert sorted(r.id for r in rows if r.before < 50 and r.stars <= 2.5) == studio[split]['previous']
        out = {'storyAndCredit': [], 'synopsisOnly': [], 'keywordOnly': []}
        for r in rows:
            initial = alt[r.id]['after'] if r.id in alt else r.before
            n = nearest[r.id]
            assert n['before'] == r.before and n['stars'] == r.stars
            if r.id in joint:
                assert joint[r.id]['enhanced'] == initial and joint[r.id]['stars'] == r.stars
            if initial < 50 or r.both >= 50:
                continue
            evidence = {'synopsisOnly': n['synopsis'], 'keywordOnly': n['tags']}
            if r.id in joint:
                evidence['storyAndCredit'] = joint[r.id]['score']
            for arm, candidate in evidence.items():
                if candidate < 50:
                    out[arm].append(dict(id=r.id, title=r.title, stars=r.stars, before=initial,
                                         after=max(r.both, candidate), evidence=candidate, structural=r.both))
        results[split] = out
        for arm, moved in out.items():
            print(split, arm, 'new dislikes / neutral / liked',
                  sum(r['stars'] <= 2.5 for r in moved), sum(r['stars'] == 3 for r in moved),
                  sum(r['stars'] > 3 for r in moved))
    write_new(args.output, results)


if __name__ == '__main__':
    cli = ArgumentParser(description=__doc__)
    for key in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                'studio', 'story', 'content', 'output'):
        cli.add_argument(key, type=Path)
    run(cli.parse_args())
