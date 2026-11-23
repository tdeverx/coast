"""Reproduce the conservative title-feature correction on local, frozen taste replay inputs.

python3 replay.py history.json work-predictions.json franchise-controls.json
Inputs come from captureTaste and the accompanying rating-certainty experiment. No database access.
Only aggregate findings are printed.
"""
import hashlib
import json
import math
import statistics
import sys
from collections import Counter
from pathlib import Path

FAMILIES = {
    "genres": 1, "tags": 1, "themes": .8, "franchises": .85, "directors": .72,
    "writers": .60, "cast": .55, "studios": .4, "networks": .4, "decades": .16,
    "countries": .1, "languages": .08, "ageRatings": .14, "composers": .1,
}


def terms(features):
    groups = []
    concepts = set()
    for family, strength in FAMILIES.items():
        keys = set()
        for feature in features.get(family, []):
            if family in ("genres", "tags", "themes"):
                name = feature["name"].strip().lower()
                if name in concepts:
                    continue
                concepts.add(name)
            keys.add((family, feature["id"]))
        if keys:
            groups.append((strength, sorted(keys)))
    return groups


def vector(groups, known):
    result = []
    for strength, keys in groups:
        matched = [key for key in keys if key in known]
        if matched:
            result.extend((key, strength / math.sqrt(len(matched))) for key in matched)
    return result


def log_odds(p):
    return math.log(p / (1 - p))


def sigmoid(x):
    return 1 / (1 + math.exp(-max(-20, min(20, x))))


def fit(rows):
    counts = Counter(key for groups, _ in rows for _, keys in groups for key in keys)
    coefficients = {key: 0.0 for key, count in counts.items() if count >= 3}
    samples = [(vector(groups, coefficients), int(stars >= 4)) for groups, stars in rows]
    prior = log_odds((1 + sum(y for _, y in samples)) / (2 + len(samples)))
    intercept = prior
    for _ in range(100):
        gradient = Counter()
        total_error = 0
        for x, y in samples:
            error = y - sigmoid(intercept + sum(coefficients[k] * v for k, v in x))
            total_error += error
            for k, v in x:
                gradient[k] += error * v
        intercept += 2 * total_error / len(samples)
        for k, g in gradient.items():
            coefficients[k] += 8 * (g - 1.5 * coefficients[k]) / len(samples)
    return intercept - prior, coefficients


def correction(models, features):
    estimates = []
    for intercept, coef in models:
        estimates.append(intercept + sum(coef[k] * v for k, v in vector(features, coef)))
    return max(-.35, min(0, max(estimates)))


def half(work_id):
    return hashlib.sha256(("scale-half:" + work_id).encode()).digest()[0] % 2


def compare(data, current, moderate):
    training = {r["work"]["id"]: (terms(r["features"]), r["work"]["rating"])
                for r in data["history"] if r["work"]["rating"] is not None}
    catalogue = {r["id"]: terms(r["features"]) for r in data["catalogue"] if r["observed"]}
    predictions = []
    for fold in range(5):
        train_ids = {r["id"] for r in current if r["fold"] != fold}
        partitions = [[obs for key, obs in training.items() if key in train_ids and half(key) == h]
                      for h in (0, 1)]
        models = [fit(part) for part in partitions] if all(partitions) else []
        for r in current:
            if r["fold"] != fold or r["score"] is None or r["id"] not in training:
                continue
            key = r["id"]
            candidate = moderate[key]
            if candidate is None:
                continue
            groups, stars = training[key]
            delta = correction(models, catalogue.get(key, groups)) if models else 0
            p = max(.001, min(.999, candidate / 100))
            score = math.floor(100 * sigmoid(log_odds(p) + delta) + .5)
            predictions.append((fold, stars, r["score"], score))
    for idx, name in ((2, "current"), (3, "candidate")):
        pairs = []
        for fold in range(5):
            pos = [r[idx] for r in predictions if r[0] == fold and r[1] >= 4]
            neg = [r[idx] for r in predictions if r[0] == fold and r[1] <= 3]
            pairs.extend((a > b) + .5 * (a == b) for a in pos for b in neg)
        lows = [r[idx] for r in predictions if r[1] <= 2.5]
        favourites = [r[idx] for r in predictions if r[1] == 5]
        print(name, json.dumps({"scored": len(predictions), "ordering": statistics.mean(pairs),
              "brier": statistics.mean((r[idx] / 100 - int(r[1] >= 4)) ** 2 for r in predictions),
              "low_median": statistics.median(lows), "five_star_median": statistics.median(favourites)}))


if __name__ == "__main__":
    datasets, work, controls = (json.loads(Path(f).read_text()) for f in sys.argv[1:])
    for data in datasets:
        for split in ("work", "franchise"):
            rows = ([r for r in work if len(r["trainExcludes"]) == 1] if split == "work"
                    else [r for r in controls if r["split"] == split])
            rows = [r for r in rows if r["rated"] and r["medium"] == data["medium"]]
            print(data["medium"], split)
            compare(data, [r for r in rows if r["model"] == "baseline"],
                    {r["id"]: r["score"] for r in rows if r["model"] == "symmetric_sqrt"})
