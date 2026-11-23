"""Read-only audit of three already sealed forecasts and whole-title holdouts."""
import hashlib
import json
import sys
from collections import Counter, defaultdict


def load(path):
    with open(path, encoding='utf-8') as file:
        return json.load(file)


def ledger(path):
    frozen = load(path)
    entries = {row['key']: row for row in frozen['entries']}

    def lookup(medium, work):
        key = hashlib.sha256('/'.join([frozen['salt'], medium, work]).encode()).hexdigest()
        return entries[key]

    return lookup


def describe(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return None
    return {
        'count': len(values),
        'min_q1_median_q3_max': [values[round((len(values) - 1) * p)] for p in (0, .25, .5, .75, 1)],
        'red': sum(v < 50 for v in values),
        'green': sum(v >= 80 for v in values),
    }


def families(history):
    parents = {}

    def root(key):
        while key in parents:
            key = parents[key]
        return key

    for row in history:
        work = row['work']['id']
        shared = [('collection', v) for v in row.get('collections', [])]
        shared += [('franchise', v['id']) for v in row['features'].get('franchises', [])]
        for key in shared:
            a, b = root(work), root(key)
            if a != b:
                parents[a] = b
    return {r['work']['id']: root(r['work']['id']) for r in history}


def traits(work, metadata):
    features = work['features']
    keys = {(dim, v['id']) for dim in ('genres', 'tags', 'themes', 'cast', 'directors', 'writers', 'studios', 'networks', 'franchises', 'composers', 'cinematographers')
            for v in features.get(dim, [])}
    work_id = work.get('id') or work['work']['id']
    for credit in metadata.get(work_id) or []:
        if credit['role'] == 'Creator' and str(credit['id']).isdigit():
            keys.add(('creators', str(credit['id'])))
    return keys


def negative_traits(history, direct, metadata):
    group = families(history)
    labels = defaultdict(lambda: defaultdict(list))
    for row in history:
        work = row['work']
        rating = direct.get((work['medium'], work['id']))
        if rating is not None:
            for key in traits(row, metadata):
                labels[key][group[work['id']]].append(rating)
    repeated, negative = set(), set()
    for trait, works in labels.items():
        # One vote per family. An isolated dislike or a mixed family cannot prove
        # a recurring negative preference. Three-star families count as neutral.
        means = [sum(stars) / len(stars) for stars in works.values()]
        low = sum(r <= 2.5 for r in means)
        if low >= 2:
            repeated.add(trait)
            if low > len(means) / 2:
                negative.add(trait)
    return repeated, negative


def main():
    if len(sys.argv) != 8:
        raise SystemExit("Usage: negative-tail.py CAPTURE VERIFIED_DATES VERIFIED_CREDITS WHOLE_TITLE_REPLAY " +
                         "INCUMBENT_LEDGER RAW_PAIRED_LEDGER GRADED_PAIRED_LEDGER")
    capture, dates, metadata, holdout, old, raw, final = sys.argv[1:]
    captured = load(capture)
    direct = {(r['medium'], r['id']): r['stars'] for r in load(dates)}
    credits = {r['id']: r['credits'] for r in load(metadata)}
    runs = load(holdout)['runs']
    prior, balanced, graded = map(ledger, (old, raw, final))

    for dataset in captured:
        medium, history = dataset['medium'], dataset['history']
        known = {row['work']['id'] for row in history}
        candidates = [r for r in dataset['catalogue'] if r['id'] not in known and not r['observed']]
        repeated, negative = negative_traits(history, direct, credits)
        joined = []
        for row in candidates:
            args = medium, row['id']
            incumbent = prior(*args)
            raw_pair = balanced(*args)
            final_pair = graded(*args)
            if raw_pair['v1'] != final_pair['v1'] or incumbent['personal'] != final_pair['v1']:
                raise ValueError('Incumbent changed between ledgers')
            keys = traits(row, credits)
            joined.append((incumbent['personal'], incumbent['withoutSelection'], raw_pair['v2'],
                           final_pair['v2'], bool(negative & keys), bool(repeated & keys)))
        red = [r for r in joined if r[0] is not None and r[0] < 50]
        kept = [r for r in red if r[1] is not None and r[1] < 50]
        scored = [r for r in red if r[1] is not None]
        labels = [w['work']['rating'] for w in history if w['work']['rating'] is not None]
        run = next(r for r in runs if r['medium'] == medium and r['split'] == 'work' and r['budget'] == 'all')
        # Same five held title folds. Every diagnostic trait uses the training folds only.
        weak = [t for t in run['targets'] if t['stars'] <= 2.5]
        held_evidence = []
        for fold in {t['group'] for t in run['targets']}:
            held_ids = {t['id'] for t in run['targets'] if t['group'] == fold}
            training = [r for r in history if r['work']['id'] not in held_ids]
            _, negative_in_fold = negative_traits(training, direct, credits)
            for r in history:
                if r['work']['id'] in held_ids and r['work']['rating'] is not None and r['work']['rating'] <= 2.5:
                    held_evidence.append(bool(negative_in_fold.intersection(traits(r, credits))))
        assert len(held_evidence) == len(weak)
        print(json.dumps({
            'medium': medium, 'history': len(history), 'ratings': sorted(Counter(labels).items()),
            'verified_ratings': sorted(Counter(stars for (m, _), stars in direct.items() if m == medium).items()),
            'drops': sum(bool(r['work']['dropped']) for r in history),
            'unfamiliar': len(joined), 'distributions': [describe(r[i] for r in joined) for i in range(4)],
            'v1_red': len(red), 'v1_red_without_selection': len(kept), 'v1_red_without_selection_scorable': len(scored),
            'v1_red_with_shared_dislikes': sum(r[5] for r in red),
            'v1_red_with_explicit_negative_trait': sum(r[4] for r in red),
            'still_red_with_explicit_negative_trait': sum(r[4] for r in kept),
            'known_weak_with_train_negative_trait': sum(held_evidence),
            'v1_red_graded': describe(r[3] for r in red), 'negative_traits': len(negative),
            'unfamiliar_with_explicit_negative_trait': sum(r[4] for r in joined),
            'explicit_negative_trait_graded': describe(r[3] for r in joined if r[4]),
            'hidden': {str(threshold): {m: describe(t['scores'][m] for t in run['targets'] if t['stars'] <= threshold)
                       for m in ('v1', 'balanced', 'calibrated')} for threshold in (2.5, 3)},
        }, sort_keys=True))


if __name__ == '__main__':
    main()
