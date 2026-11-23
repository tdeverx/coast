"""python3 personal-counts.py <capture.json> <private-folds.json> [--groups] [--select]

Single-viewer, ratings-only empirical-Bayes counting experiment. Requires NumPy.
The private folds come from ordinal-inputs.ts. Prints aggregate results.
"""
import json
import hashlib
import math
import runpy
import sys
from collections import Counter, defaultdict
from itertools import combinations, product
from pathlib import Path

import numpy as np

shared = runpy.run_path(str(Path(__file__).with_name("ordinal-replay.py")))
group_features, summarize = shared["groups"], shared["summarize"]
TOPIC = {"genres", "tags", "themes"}
PEOPLE_OR_COMPANY = {"cast", "directors", "writers", "studios", "networks", "franchises"}
PRIOR_STRENGTHS = (2, 6, 18, 54, 162)


def logit(p):
    p = min(max(p, 1e-8), 1 - 1e-8)
    return math.log(p / (1 - p))


def sigmoid(x):
    return 1 / (1 + math.exp(-min(max(x, -35), 35)))


def log_beta(a, b):
    return math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)


def strength(rows):
    """Composite beta-binomial marginal likelihood. The prior centre can differ per pair."""
    rows = Counter((n, wins, round(prior, 5)) for n, wins, prior in rows)
    def evidence(k):
        total = 0.
        for (n, wins, prior), count in rows.items():
            a, b = k * prior, k * (1 - prior)
            total += count * (log_beta(a + wins, b + n - wins) - log_beta(a, b))
        return total
    return max(PRIOR_STRENGTHS, key=evidence) if rows else PRIOR_STRENGTHS[-1]


def combine(terms):
    """Correlated credits share their family vote; each title counts once within a feature."""
    contributions = [sum(values) / len(values) for values in terms.values() if values]
    return sum(contributions) / math.sqrt(len(contributions)) if contributions else 0.


def pair_keys(keys):
    anchors = [k for k in keys if k[0] in TOPIC]
    for a, b in combinations(anchors, 2):
        if a[0] == b[0] == "tags":
            continue
        yield tuple(sorted((a, b)))
    for a, b in product(anchors, (k for k in keys if k[0] in PEOPLE_OR_COMPANY)):
        yield tuple(sorted((a, b)))


def fit(train, features, stars):
    y = {r["id"]: int(r["stars"] >= stars) for r in train}
    w = sum(y.values())
    prior = (w + .5) / (len(y) + 1)
    counts = defaultdict(list)
    for key in y:
        for term in features[key]:
            counts[term].append(key)
    totals = {term: (len(ids), sum(y[i] for i in ids)) for term, ids in counts.items() if len(ids) >= 2}
    by_family = defaultdict(list)
    for term, (n, wins) in totals.items():
        by_family[term[0]].append((n, wins, prior))
    kappa = {family: strength(rows) for family, rows in by_family.items()}

    def main_score(key, leave_out=False):
        p = (w - y[key] + .5) / len(y) if leave_out else prior
        base = logit(p)
        terms = defaultdict(list)
        for term in features[key]:
            if term not in totals:
                continue
            n, wins = totals[term]
            if leave_out:
                n -= 1
                wins -= y[key]
            k = kappa[term[0]]
            terms[term[0]].append(logit((wins + k*p) / (n+k)) - base)
        return base + combine(terms)

    # Get the expected personal positive rate among the pair's titles using their other
    # metadata and marginal effects. Leave the title's own rating out of those predictions.
    loo = {key: sigmoid(main_score(key, True)) for key in y}
    pair_ids = defaultdict(list)
    for key in y:
        known = [term for term in features[key] if term in totals and totals[term][0] >= 5]
        for pair in pair_keys(known):
            pair_ids[pair].append(key)
    candidates = {}
    for pair, ids in pair_ids.items():
        n = len(ids)
        # If one identifier always travels with the other, a pair cannot explain an exception.
        if n >= 3 and all(totals[parent][0] - n >= 2 for parent in pair):
            candidates[pair] = (n, sum(y[i] for i in ids), sum(loo[i] for i in ids) / n)
    strengths = {}
    pairs = {}
    for label in ("flat", "residual"):
        strata = defaultdict(list)
        for (a, b), (n, wins, expected) in candidates.items():
            strata[a[0], b[0]].append((n, wins, prior if label == "flat" else expected))
        strengths[label] = {family: strength(rows) for family, rows in strata.items()}
        for pair, (n, wins, expected) in candidates.items():
            a, b = pair
            centre = prior if label == "flat" else expected
            k = strengths[label][a[0], b[0]]
            pairs[label, pair] = logit((wins + k*centre) / (n+k)) - logit(centre)

    def predict(key):
        main = main_score(key)
        terms = {name: defaultdict(list) for name in strengths}
        for pair in pair_keys([term for term in features[key] if term in totals and totals[term][0] >= 5]):
            if pair not in candidates:
                continue
            a, b = pair
            for name in terms:
                terms[name][a[0], b[0]].append(pairs[name, pair])
        return {"main": main, **{name: main + combine(groups) for name, groups in terms.items()}}, bool(terms["residual"])
    return prior, predict, len(totals), len(candidates)


def predictions(fold, features):
    training = fold["train"]
    models = [fit(training, features, stars) for stars in (3.5, 4, 4.5, 5)]
    test = []
    pair_hits = 0
    for row in fold["test"]:
        if row["score"] is None:
            continue
        model_scores = [predict(row["id"]) for _, predict, _, _ in models]
        pair_hits += int(model_scores[1][1])
        result = dict(row)
        for name in ("main", "flat", "residual"):
            result[name] = 100 * sigmoid(model_scores[1][0][name])
            # The correction is centred on the viewer's training-only label prevalence and
            # uses all four ordered thresholds. No fitted weights use the test scores.
            effect = sum(model[0][name] - logit(prior) for model, (prior, *_) in zip(model_scores, models)) / len(models)
            result["plus_"+name] = 100 * sigmoid(logit(row["score"]/100) + max(-.55, min(.55, effect)))
        test.append(result)
    return test, {"training": len(training), "scored": len(test), "pairCoverage": pair_hits,
                  "terms": models[1][2], "pairs": models[1][3]}


def day_interval(rows, left, right):
    """Paired, same-day-block 95% interval for the change in ≥4-versus-≤3 ordering."""
    days = sorted({r["at"][:10] for r in rows})
    by_day = np.eye(len(days))[[days.index(r["at"][:10]) for r in rows]]
    stars = np.array([r["stars"] for r in rows])
    mask = (stars >= 4)[:, None] & (stars <= 3)[None, :]
    def wins(key):
        scores = np.floor([r[key]+.5 for r in rows])
        diff = scores[:, None] - scores[None, :]
        return (diff > 0) + .5*(diff == 0)
    delta = by_day.T @ ((wins(right)-wins(left))*mask) @ by_day
    total = by_day.T @ mask.astype(float) @ by_day
    rng = np.random.default_rng(2917)
    weights = rng.multinomial(len(days), np.ones(len(days))/len(days), 3000)
    d = np.einsum("bi,ij,bj->b", weights, total, weights)
    n = np.einsum("bi,ij,bj->b", weights, delta, weights)
    return [float(round(x,2)) for x in 100*np.quantile(n[d>0]/d[d>0],[.025,.975])]


def earlier_only_weights(fold, features):
    """Choose a blend by held-out Brier loss within the outer training set; match Coast's day folds."""
    def partition(row):
        day = "past-day-ordinal:" + row["at"][:10]
        return hashlib.sha256(day.encode()).digest()[0] % 5
    prior = fold["train"]
    held = []
    for index in range(5):
        train = [r for r in prior if partition(r) != index]
        test = [r for r in prior if partition(r) == index]
        if train and test:
            held.extend(predictions({"train": train, "test": test}, features)[0])
    error = []
    for main in range(11):
        for interaction in range(11-main):
            brier = sum(((r["score"]*(10-main-interaction)+r["plus_main"]*main
                          +r["plus_residual"]*interaction)/1000 - (r["stars"] >= 4))**2 for r in held)
            error.append((brier, main+interaction, interaction, main))
    _, _, interaction, main = min(error)
    return main/10, interaction/10


if __name__ == "__main__":
    capture, folds = [json.loads(Path(arg).read_text()) for arg in sys.argv[1:3]]
    by_medium = {}
    names_by_medium = {}
    for data in capture:
        raw = {r["work"]["id"]: r["features"] for r in data["history"]}
        raw.update({r["id"]: r["features"] for r in data["catalogue"]})
        by_medium[data["medium"]] = {key: sorted(term for terms in group_features(f).values() for term in terms)
                                     for key,f in raw.items()}
        names_by_medium[data["medium"]] = {key: {term["name"].casefold() for terms in f.values() for term in terms}
                                           for key,f in raw.items()}
    groups = defaultdict(list)
    for fold in folds:
        if fold["split"] != "rating date" and "--groups" not in sys.argv:
            continue
        rows, counts = predictions(fold, by_medium[fold["medium"]])
        if fold["split"] == "rating date" and fold["fold"] == "2024":
            names = names_by_medium[fold["medium"]]
            scifi = "science fiction" if fold["medium"] == "movie" else "sci-fi & fantasy"
            examples = [("animation",), (scifi,), ("animation",scifi), ("anime","studio ghibli")]
            for facets in examples:
                ratings = [r["stars"] for r in fold["train"] if set(facets) <= names[r["id"]]]
                counts[" and ".join(facets)] = {"rated":len(ratings), "four_or_more":sum(s>=4 for s in ratings)}
        if fold["split"] == "rating date" and "--select" in sys.argv:
            main, pair = earlier_only_weights(fold, by_medium[fold["medium"]])
            counts["mix_coast_main_interaction"] = [round(1-main-pair,1), main, pair]
            for r in rows:
                r["selected"] = r["score"]*(1-main-pair) + main*r["plus_main"] + pair*r["plus_residual"]
        name = (fold["medium"], fold["split"], fold["fold"] if fold["split"] == "rating date" else "")
        groups[name].append(rows)
        print("support", *name, json.dumps(counts), flush=True)
    for name, batches in groups.items():
        out = {k:summarize(batches,k) for k in ("score","main","flat","residual","plus_main","plus_flat","plus_residual")}
        if "selected" in batches[0][0]:
            out["selected"] = summarize(batches,"selected")
        if name[1] == "rating date":
            out["interaction_minus_coast_interval"] = day_interval(batches[0],"score","plus_residual")
            out["interaction_minus_main_interval"] = day_interval(batches[0],"plus_main","plus_residual")
        print("result", *name, json.dumps(out), flush=True)
