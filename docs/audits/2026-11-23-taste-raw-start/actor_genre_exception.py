"""Replay an actor-by-genre personal dislike using only independently rated works."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
from statistics import mean

from retained_panels import retained_panels
from team_audience import display, read, utility


def sets(targets, ratings):
    by_actor, by_genre = defaultdict(set), defaultdict(set)
    for i in ratings:
        actors, genres = targets[i]
        if actors and genres:
            for a in actors:
                by_actor[a].add(i)
            for g in genres:
                by_genre[g].add(i)
    return by_actor, by_genre


def judge(actors, genres, allowed, family, labels, by_actor, by_genre):
    def grouped(ids):
        groups = defaultdict(list)
        for j in ids:
            groups[family[j]].append(labels[j]['stars'])
        return groups

    stages, qualifying = set(), []
    for a in actors:
        cast = allowed & by_actor[a]
        if len(cast) < 2:
            continue
        for g in genres:
            local = by_genre[g]
            joint = grouped(cast & local)
            if len(joint) < 2:
                continue
            stages.add('repeated')
            if sum(max(v) <= 2.5 for v in joint.values()) < 2:
                continue
            stages.add('twoDisliked')
            if any(max(v) > 2.5 for v in joint.values()):
                continue
            stages.add('allDisliked')
            actor_others = grouped(cast - local)
            positives = {f for f, v in actor_others.items() if min(v) >= 4 and f not in joint}
            if len(positives) < 2:
                continue
            stages.add('actorLikedElsewhere')
            genre_others = grouped((allowed & local) - cast)
            genre_likes = {f for f, v in genre_others.items() if min(v) >= 4 and f not in joint}
            if len(genre_likes) < 2:
                continue
            stages.add('qualified')
            # Independently rated franchises get equal votes. Eligibility has already rejected mixed donors.
            estimate = display(mean([50] + [mean(utility(v) for v in votes) for votes in joint.values()]))
            qualifying.append((a, g, estimate, sorted(cast & local)))
    return stages, qualifying


def replay(args):
    cohorts = read(args.graded)
    assert hashlib.sha256(args.capture.read_bytes()).hexdigest() == cohorts['manifest']['capture']
    direct, holdouts = retained_panels(args)
    family = {r.id: r.family for r in holdouts['full']}
    catalog = {}
    for panel in read(args.capture):
        features = {r['work']['id']: r['features'] for r in panel['history']}
        features.update({r['id']: r['features'] for r in panel['catalogue']})
        for i, f in features.items():
            actors = {a['id'] for a in f.get('cast', [])[:5] if a['id'].startswith('tmdb:')}
            catalog[i] = (actors, {g['id'] for g in f.get('genres', [])})
    by_actor, by_genre = sets(catalog, direct)
    results = {}
    for split, rows in holdouts.items():
        stats, witness_counts, changed = Counter(), defaultdict(Counter), []
        diagnostic = []
        independent_red = set()
        for r in rows:
            i, base = r.id, r.before
            if base < 50:
                if r.stars <= 2.5:
                    independent_red.add(i)
                continue
            eligible = {j for j in direct if r.eligible(j)}
            stages, qualifying = judge(*catalog[i], eligible, family, direct, by_actor, by_genre)
            if qualifying:
                prediction = min(base, max(item[2] for item in qualifying))
                if prediction != base:
                    changed.append(dict(id=i, title=r.title, stars=r.stars, before=base, after=prediction, witnesses=qualifying))
                    stats['dislikeNewRed'] += r.stars <= 2.5 and prediction < 50
                    stats['threeHalfLower'] += r.stars == 3.5
                    stats['fourPlusLower'] += r.stars >= 4
                    stats['fiveLower'] += r.stars == 5
            if split == 'full' and (('repeated' in stages and r.stars <= 2.5) or 'twoDisliked' in stages):
                examples = []
                for a in sorted(catalog[i][0]):
                    for g in sorted(catalog[i][1]):
                        matched = eligible & by_actor[a] & by_genre[g]
                        if len({family[j] for j in matched}) >= 2:
                            examples.append(dict(actor=a, genre=g, ratings=sorted(direct[j]['stars'] for j in matched)))
                diagnostic.append(dict(title=r.title, stars=r.stars, pairs=examples))
            for name in stages:
                category = 'miss' if r.stars <= 2.5 else 'liked' if r.stars >= 4 else 'middle'
                witness_counts[category][name] += 1
        stats.update(dict(previousDislikesKept=len(independent_red),scored=len(rows)))
        results[split] = dict(summary=stats, coverage=witness_counts, changes=changed, diagnosis=diagnostic)
    return results


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ('capture', 'direct', 'graded', 'team', 'archived', 'movie', 'show', 'earlier', 'grouped', 'witness'):
        p.add_argument(arg, type=Path)
    print(json.dumps(replay(p.parse_args()), indent=2))
