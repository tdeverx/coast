"""Offline experiment: require synopsis and editorial keywords to select the same unrelated dislike.

Use frozen, unlabelled synopsis embeddings and provider keywords only. Compare all
other eligible direct votes, including middling votes. Score conservatively at 49
when the unique, closest title in both views received <=2.5 stars and shares at
least two keywords occurring on <=5% of catalogue titles in the same medium.
A tied closest match abstains. Never lower a title already below 50.
"""
import argparse
from collections import Counter
import math
from pathlib import Path

import numpy as np

from retained_panels import retained_panels
from team_audience import read, write_new


def content_views(capture, embeddings, direct):
    ids = [r['id'] for r in direct.values() if r['medium'] == capture['medium']]
    labels = {r['work']['id']: r['features'] for r in capture['history']}
    labels.update({r['id']: r['features'] for r in capture['catalogue']})
    keywords = {i: {tag['id'] for tag in v.get('tags', []) if tag['id'].startswith('tmdb:')}
                for i, v in labels.items()}
    counts = Counter(tag for words in keywords.values() for tag in words)
    size = len(keywords)
    weights = {tag: 1 + math.log((size+1)/(df+1)) for tag, df in counts.items()}
    rare = {tag for tag, df in counts.items() if df / size <= 0.05}
    dimensions = {str(i): e for i, e in zip(embeddings['ids'], embeddings['emb'], strict=True)}
    vector_size = embeddings['emb'].shape[1]
    matrix = np.asarray([dimensions.get(i, np.zeros(vector_size)) for i in ids], dtype=float)
    norms = np.linalg.norm(matrix, axis=1)
    matrix /= np.maximum(1e-12, norms)[:,None]
    cos = matrix @ matrix.T
    cos[norms == 0, :] = np.nan
    cos[:, norms == 0] = np.nan
    tags = np.full_like(cos, np.nan)
    common = np.zeros(cos.shape, dtype=int)
    totals = {i: sum(weights[t] for t in sorted(keywords[i])) for i in ids}
    for a, i in enumerate(ids):
        for b in range(a):
            j = ids[b]
            shared = keywords[i] & keywords[j]
            if shared:
                weight = sum(weights[t] for t in sorted(shared))
                tags[a,b] = tags[b,a] = weight / (totals[i] + totals[j] - weight)
                common[a,b] = common[b,a] = len(shared & rare)
    return ids, {i:k for k,i in enumerate(ids)}, cos, tags, common


def nearest(row, permitted):
    valid = np.where(permitted & np.isfinite(row))[0]
    if not valid.size:
        return None
    best = float(row[valid].max())
    ties = valid[np.isclose(row[valid], best, atol=1e-12, rtol=0)]
    return int(ties[0]) if len(ties) == 1 else None


def evaluate(args):
    direct, cohorts = retained_panels(args)
    with np.load(args.embeddings, allow_pickle=False) as emb:
        views = {s['medium']: content_views(s, emb, direct) for s in read(args.capture)}
    output = {}
    for split, rows in cohorts.items():
        cases = []
        for row in rows:
            i, m, before = row.id, row.medium, row.before
            ids, index, synopsis, tags, shared = views[m]
            allowed = np.asarray([row.eligible(j) for j in ids])
            a = index[i]
            assert not allowed[a]
            x, y = nearest(synopsis[a], allowed), nearest(tags[a], allowed)
            xn, yn = (ids[k] if k is not None else None for k in (x, y))
            px = x is not None and direct[xn]['stars'] <= 2.5
            py = y is not None and direct[yn]['stars'] <= 2.5 and shared[a,y] >= 2
            agree = x is not None and y is not None and x == y and shared[a,y] >= 2
            def score(admit):
                return 49 if admit and before >= 50 else before
            cases.append(dict(id=i, title=row.title, stars=row.stars, medium=m, before=before,
                              synopsis=score(px), tags=score(py), agreement=score(agree and px and py),
                              plotDonor=xn, tagDonor=yn, agree=bool(agree), plotSimilarity=None if x is None else float(synopsis[a,x]),
                              tagSimilarity=None if y is None else float(tags[a,y]), shared=0 if y is None else int(shared[a,y])))
        assert len(cases) == len({r['id'] for r in cases})
        result = {}
        for arm in ('before','synopsis','tags','agreement'):
            moved = [r for r in cases if r[arm] < r['before']]
            result[arm] = dict(total=len(cases), redDislikes=sum(r['stars'] <= 2.5 and r[arm] < 50 for r in cases),
                               redGained=sum(r['stars'] <= 2.5 for r in moved),
                               red3=sum(r['stars'] == 3 and r[arm] < 50 for r in cases),
                               lowered3=sum(r['stars'] == 3 for r in moved),
                               lowered35=sum(r['stars'] == 3.5 for r in moved),
                               lowered4=sum(r['stars'] >= 4 for r in moved),
                               loweredLiked=sum(r['stars'] > 3 for r in moved),
                               loweredFives=sum(r['stars'] == 5 for r in moved),
                               greenFivesLost=sum(r['stars'] == 5 and r['before'] >= 80 for r in moved),
                               redKept=sum(r['stars'] <= 2.5 and r['before'] < 50 and r[arm] == r['before'] for r in cases))
        output[split] = dict(metrics=result, cases=cases)
    return output


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('capture','graded','direct','team','movie','show','archived','earlier','grouped','witness','embeddings','output'):
        cli.add_argument(name, type=Path)
    args = cli.parse_args()
    write_new(args.output, evaluate(args))
