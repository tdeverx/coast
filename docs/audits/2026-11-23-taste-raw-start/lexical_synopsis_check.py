"""Replace the frozen semantic plot neighbour with a catalogue TF-IDF neighbour, keeping the two other clues fixed."""
from argparse import ArgumentParser
from collections import Counter
from math import log, sqrt
from pathlib import Path
import re

from retained_panels import retained_panels
from story_credit_corroboration import descriptors, postings, verdict
from team_audience import read, write_new


def plot_vectors(metadata, ids):
    documents = {m['id']: Counter(re.findall(r'[^\W\d_]{2,}', (m.get('overview') or '').casefold()))
                 for m in metadata if m.get('overview')}
    frequency = Counter(word for counts in documents.values() for word in counts)
    vectors = {}
    for i in ids:
        weighted = {word: (1 + log(n)) * (1 + log((1 + len(documents)) / (1 + frequency[word])))
                    for word, n in documents.get(i, {}).items() if frequency[word] * 2 <= len(documents)}
        norm = sqrt(sum(w * w for w in weighted.values()))
        vectors[i] = {word: w / norm for word, w in weighted.items()} if norm else {}
    return vectors


def nearest(vector, others, allowed):
    scores = sorted(((sum(w * others[j].get(k, 0) for k, w in vector.items()), j)
                     for j in allowed if others[j]), reverse=True)
    if not scores or scores[0][0] <= 0 or len(scores) > 1 and scores[0][0] - scores[1][0] <= 1e-12:
        return None, 0
    return scores[0][1], scores[0][0]


def run(args):
    ratings, panels = retained_panels(args)
    families = {r.id: r.family for r in panels['full']}
    metadata = read(args.metadata)
    vectors = plot_vectors(metadata, ratings.keys())
    works, genres, tags, credits = descriptors(read(args.capture), metadata, ratings.keys())
    fields = tags, credits
    indices = tuple(postings(f) for f in fields)
    previous, story = read(args.studio), read(args.story)
    report = {}
    for split, rows in panels.items():
        candidates = {r['id']: r for r in story[split]['changes']}
        studio = {r['id']: r for r in previous[split]['changes']['sameKindCompany']}
        checks = []
        for r in rows:
            if r.id not in candidates:
                continue
            c = candidates[r.id]
            initial = studio[r.id]['after'] if r.id in studio else r.before
            assert c['enhanced'] == initial and c['stars'] == r.stars
            if initial < 50:
                continue
            permitted = {j for j in ratings if r.eligible(j)}
            j, similarity = nearest(vectors[r.id], vectors, permitted)
            result = verdict(r.id, permitted, ratings, families, works, genres, fields, indices, plot=j)
            assert result['corroborated'][0] == c['score']
            alternative = result.get('independentSynopsisVerifiedTeams')
            checks.append(dict(id=r.id, title=r.title, stars=r.stars, before=initial, plot=j,
                               plotStars=ratings[j]['stars'] if j else None, similarity=similarity,
                               after=alternative[0] if alternative else initial))
        report[split] = checks
    write_new(args.output, report)


if __name__ == '__main__':
    cli = ArgumentParser(description=__doc__)
    for key in ('graded', 'direct', 'team', 'movie', 'show', 'archived', 'earlier', 'grouped', 'witness',
                'capture', 'metadata', 'studio', 'story', 'output'):
        cli.add_argument(key, type=Path)
    run(cli.parse_args())
