"""A personal, nested contrast experiment. Needs NumPy, already used in the offline taste studies."""
import hashlib
import importlib.util
import json
import math
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

previous = Path(__file__).resolve().parents[1] / '2026-11-23-taste-v2-counterevidence' / 'replay.py'
spec = importlib.util.spec_from_file_location('comparison', previous)
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)
weights = dict(genres=1, themes=1, tags=1, cast=.65, directors=.8, writers=.8,
               creators=.8, networks=.5, studios=.5)
arms = ['neighbours', 'linear']


def encoded(rows, metadata, catalogue):
    vectors = []
    slots = {}
    for row in rows:
        features = dict(row['features'])
        features['creators'] = [{'id': 'tmdb:' + str(c['id'])} for c in metadata.get(row['work']['id']) or []
                                if c['role'] == 'Creator' and str(c['id']).isdigit()]
        vector = {}
        for dim, weight in weights.items():
            values = {t['id'] for t in features.get(dim, [])}
            if not values:
                continue
            n = catalogue['known'].get(dim, 0)
            idf = {}
            for value in sorted(values):
                key = json.dumps([dim, value], separators=(',', ':'), ensure_ascii=False)
                df = catalogue['counts'].get(key, 0)
                idf[value] = 1 + math.log((1+n)/(1+min(n, df)))
            length = math.sqrt(sum(v*v for v in idf.values()))
            for value, v in idf.items():
                column = slots.setdefault((dim, value), len(slots))
                vector[column] = math.sqrt(weight) * v / length
        length = math.sqrt(sum(v*v for v in vector.values()))
        vectors.append({k: v/length for k, v in vector.items()})
    postings = defaultdict(list)
    for i, vector in enumerate(vectors):
        for column, value in vector.items():
            postings[column].append((i, value))
    matrix = np.zeros((len(rows), len(rows)), dtype=np.float64)
    for values in postings.values():
        indices, values_for_column = zip(*values)
        matrix[np.ix_(indices, indices)] += np.outer(values_for_column, values_for_column)
    assert np.isfinite(matrix).all() and matrix.min() >= 0 and matrix.max() <= 1.0000001
    return matrix


def hash_key(text):
    return hashlib.sha256(text.encode()).hexdigest()


def utility(stars):
    return max(0, 20*(stars-.5)) if stars<=3 else 50 + 30*min(1, stars-3) + 20*max(0,stars-4)


def risks(kernel, labels, family, training, targets):
    """Return on the held families only. Kernel uses descriptive features exclusively."""
    out = np.full((len(targets), 2), np.nan)
    if not len(training) or not len(targets):
        return out
    y = labels[training] <= 2.5
    negative, other = set(family[training][y]), set(family[training][~y])
    if len(negative)<2 or len(other)<2:
        return out
    exclusive_negative = sorted(negative - other)
    exclusive_other = sorted(other - negative)
    # Collapsing each class to distinct families prevents a saga from crowding out counterexamples.
    if len(exclusive_negative)>=2 and len(exclusive_other)>=2:
        k = kernel[np.ix_(targets, training)]
        def closest(groups):
            vals = np.column_stack([k[:, family[training] == f].max(axis=1) for f in groups])
            return np.partition(vals, -2, axis=1)[:, -2:].mean(axis=1)
        out[:, 0] = closest(exclusive_negative) - closest(exclusive_other)
    # Dual gradient descent on the balanced kernel logistic loss + .03/2 * ||w||².
    mass = np.zeros(len(training))
    for is_negative in (False, True):
        indices = np.flatnonzero(y == is_negative)
        counts = Counter(family[training][indices])
        mass[indices] = [.5/len(counts)/counts[f] for f in family[training][indices]]
    k = kernel[np.ix_(training, training)]
    alpha = np.zeros(len(training))
    intercept = 0.0
    for _ in range(100):
        p = 1/(1+np.exp(-np.clip(intercept+k @ alpha, -30, 30)))
        loss = mass * (p-y)
        delta = -1.8 * (.03*alpha+loss)
        intercept -= 1.8 * loss.sum()
        alpha += delta
        if np.abs(delta).max()<1e-7:
            break
    out[:, 1] = intercept + kernel[np.ix_(targets, training)] @ alpha
    out[np.isin(family[targets], family[training]), :] = np.nan
    return out


def pick(scores, training, labels, family):
    valid = np.isfinite(scores)
    judged = sorted(zip(-scores[valid], training[valid]))
    best = None
    touched = defaultdict(list)
    for index, (neg_strength, work) in enumerate(judged):
        touched[family[work]].append(labels[work])
        if index+1<len(judged) and judged[index+1][0] == neg_strength:
            continue
        tops = [max(vals) for vals in touched.values()]
        low = sum(s<=2.5 for s in tops)
        high = sum(s>=4 for s in tops)
        mid = len(tops)-low-high
        net = low-4*high-mid
        if low<2 or max(tops)==5 or high*4>low or net<=0:
            continue
        estimate = (utility(3.5)+sum(sum(map(utility,vals))/len(vals) for vals in touched.values()))/(1+len(tops))
        if estimate<50 and (best is None or net>best[0]):
            best = net, -neg_strength, math.floor(estimate+.5)
    return best


def one_medium(dataset, dates, credits, catalogue, replay, private_changes):
    medium = dataset['medium']
    history = dataset['history']
    families = comparison.family_keys(history)
    rows = sorted((r for r in history if r['work']['rating'] is not None), key=lambda r:r['work']['id'])
    ids = [r['work']['id'] for r in rows]
    pos = {w:i for i,w in enumerate(ids)}
    family_codes = {f:i for i,f in enumerate(sorted(set(map(str,families.values()))))}
    family = np.array([family_codes[str(families[w])] for w in ids])
    # The inner partitions bind whole franchises, irrespective of the outer fold.
    inner = np.array([int(hash_key('personal-contrast-family:'+str(families[w]))[:8],16)%4 for w in ids])
    stars = np.array([dates[w]['stars'] if w in dates else np.nan for w in ids])
    kernel = encoded(rows, credits, catalogue)
    for run in replay['runs']:
        if run['medium'] != medium:
            continue
        budget, split = run['budget'], run['split']
        folds = defaultdict(list)
        for target in run['targets']:
            folds[target['group']].append(target)
        results = {arm:defaultdict(list) for arm in arms}
        risk_diagnostic = {arm:defaultdict(list) for arm in arms}
        admission = Counter()
        changes = {arm:Counter() for arm in arms}
        for group, held in folds.items():
            if split == 'rolling-day':
                train_ids = [w for w in ids if w in dates and dates[w]['at'][:10] < group]
            else:
                train_ids = set(ids) - {r['id'] for r in held}
                if budget!='all':
                    limit, _, seed = budget.partition('#')
                    train_ids = sorted(train_ids, key=lambda w: hash_key('solo:'+(seed or '1')+':'+w))[:int(limit)]
            train = np.array(sorted(pos[w] for w in train_ids if w in dates), dtype=int)
            hold = np.array([pos[h['id']] for h in held], dtype=int)
            oof = np.full((len(train),2),np.nan)
            for fold in range(4):
                test = inner[train] == fold
                oof[test] = risks(kernel, stars, family, train[~test], train[test])
            pred = risks(kernel, stars, family, train, hold)
            for col, arm in enumerate(arms):
                policy = pick(oof[:, col], train, stars, family)
                admission[arm] += int(policy is not None)
                for j,h in enumerate(held):
                    raw, opinion = h['scores']['calibrated'], h['stars']
                    if raw is None:
                        continue
                    risk = pred[j,col]
                    if np.isfinite(risk):
                        risk_diagnostic[arm][group].append((opinion, -risk, -risk))
                    updated = min(raw,policy[2]) if policy and risk>=policy[1] else raw
                    results[arm][group].append((opinion,raw,updated))
                    if raw!=updated:
                        changes[arm][str(opinion)] += 1
                        private_changes.append(dict(arm=arm, medium=medium, split=split, budget=budget,
                            group=group, id=h['id'], stars=opinion, before=raw, after=updated))
        for arm in arms:
            before, old_order = comparison.metrics(results[arm],0)
            after, new_order = comparison.metrics(results[arm],1)
            flat = [r for g in results[arm].values() for r in g]
            lows = [r for r in flat if r[0]<=2.5]
            paired = {'retained':0,'lost':0,'gained':0,'stillBelow':0}
            for opinion, raw, updated in flat:
                if opinion == 5:
                    paired[['stillBelow','gained','lost','retained'][2*(raw>=80)+(updated>=80)]] += 1
            def dislike_concordance(groups):
                wins = pairs = 0
                for group in groups.values():
                    for s, d, _ in group:
                        if s>2.5: continue
                        for p, other, _ in group:
                            if p<4: continue
                            pairs+=1
                            wins+=int(d<other)+.5*(d==other)
                return {'accuracy': round(wins/pairs,4) if pairs else None, 'pairs':pairs}
            yield {'medium':medium,'split':split,'budget':budget,'arm':arm,'acceptedFolds':admission[arm],
                   'totalFolds':len(folds),'baseline':before,'challenger':after,'changeByStars':dict(changes[arm]),
                   'pairedGreenFive':paired,'orderBefore':old_order,'orderAfter':new_order,
                   'strictRiskRankOnCovered':dislike_concordance(risk_diagnostic[arm]),
                   'meanDislikeBeforeAfter':[round(sum(r[k] for r in lows)/len(lows),2) for k in (1,2)] if lows else []}


def main():
    if len(sys.argv)!=6:
        raise SystemExit('Usage: contrast.py CAPTURE DATES CREDITS CATALOGUE NATIVE_GRADED_REPLAY')
    capture, date_rows, meta, catalogue, replay = map(comparison.read,sys.argv[1:])
    titles = {r['id']:r['credits'] for r in meta}
    out, private_changes = [], []
    for dataset in capture:
        medium = dataset['medium']
        dates = {r['id']:r for r in date_rows if r['medium']==medium}
        out.extend(one_medium(dataset,dates,titles,catalogue[medium],replay,private_changes))
    if path := os.environ.get('COAST_CONTRAST_PRIVATE_CHANGES'):
        with os.fdopen(os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600), 'w') as file:
            json.dump(private_changes,file)
    print(json.dumps(out,separators=(',',':')))


if __name__=='__main__':
    main()
