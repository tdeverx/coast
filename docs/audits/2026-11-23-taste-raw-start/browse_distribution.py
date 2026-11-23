"""Compare selected card scores across the local feed and its unseen catalogue."""
from argparse import ArgumentParser
from collections import Counter
from pathlib import Path
from statistics import median, pstdev
import hashlib
import json


def distribution(values):
    values = sorted(values)
    if not values:
        return {}
    return dict(n=len(values), min=values[0], p10=values[round(.1*(len(values)-1))],
                median=median(values), p90=values[round(.9*(len(values)-1))], max=values[-1],
                sd=round(pstdev(values), 2), middle=sum(70 <= v < 90 for v in values),
                red=sum(v < 50 for v in values), green=sum(v >= 80 for v in values))


def analyse(source_path, publication_path, capture_path):
    source = source_path.read_bytes()
    publication = json.loads(publication_path.read_bytes())
    assert publication['sourceSha256'] == hashlib.sha256(source).hexdigest()
    rows = {r['id']: r for r in json.loads(source)['rows']}
    scores = publication['rows']
    capture = json.loads(capture_path.read_bytes())
    released = {r['id'] for r in capture['catalogue'] if r['release'] != 'future'}
    shelves = capture['shelves']
    cohorts = dict(catalogue=released, firstTen={i for r in shelves if r['seed'] for i in r['ids'][:10]},
                   fullPages={i for r in shelves if r['seed'] for i in r['ids']},
                   recent={i for r in shelves if r['surface'] == 'recent' for i in r['ids']})
    for seed in (v['seed'] for v in capture['visits']):
        cohorts[seed] = {i for r in shelves if r['seed'] == seed for i in r['ids'][:10]}
    result = {}
    for label, ids in cohorts.items():
        result[label] = {}
        for medium in ('movie', 'show'):
            targets = [i for i in ids if i in rows and rows[i]['medium'] == medium
                       and not rows[i]['known'] and rows[i].get('stars') is None]
            matched = [i for i in targets if i in scores]
            assert all(rows[i]['native'] == scores[i]['native'] and not scores[i]['withheld'] for i in matched)
            changed = [i for i in matched if scores[i]['score'] != scores[i]['native']]
            result[label][medium] = dict(
                eligible=len(targets), raw=distribution(rows[i]['raw'] for i in matched),
                native=distribution(scores[i]['native'] for i in matched),
                selected=distribution(scores[i]['score'] for i in matched),
                changedByRule=Counter(scores[i]['rule'] for i in changed),
                newReds=sum(scores[i]['score'] < 50 <= scores[i]['native'] for i in changed))
    return result


if __name__ == '__main__':
    args = ArgumentParser(description=__doc__)
    for field in ('source', 'publication', 'capture'):
        args.add_argument(field, type=Path)
    p = args.parse_args()
    print(json.dumps(analyse(p.source, p.publication, p.capture), indent=2))
