"""python3 ordinal-replay.py <frozen-captures.json> <private-folds.json>

Research-only. Requires NumPy. Prints aggregate results. Does not access a database.
"""
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np


FAMILIES = {
    "genres": 1, "tags": 1, "themes": .8, "franchises": .9, "cast": .6, "directors": .75,
    "writers": .65, "studios": .45, "networks": .45, "decades": .2, "ageRatings": .18,
    "countries": .12, "languages": .09, "composers": .1, "cinematographers": .1,
}
LEVELS = np.array([2.5, 3, 3.5, 4, 4.5, 5])


def sigmoid(value):
    return 1 / (1 + np.exp(-np.clip(value, -40, 40)))


def log_odds(probability):
    p = np.clip(probability, 1e-5, 1 - 1e-5)
    return np.log(p / (1 - p))


def groups(features):
    result = {}
    seen = set()
    for family in FAMILIES:
        keys = set()
        for term in features.get(family, []):
            if family in ("genres", "tags", "themes"):
                label = term["name"].casefold()
                if label in seen:
                    continue
                seen.add(label)
            keys.add((family, term["id"]))
        if keys:
            result[family] = keys
    return result


def minimise(function, point):
    """Limited-memory BFGS with backtracking to keep the five cut points ordered."""
    value, gradient = function(point)
    history = []
    for _ in range(110):
        if np.max(np.abs(gradient)) < 1e-4:
            break
        step = gradient.copy()
        factors = []
        for delta, change, inverse in reversed(history):
            factor = inverse * (delta @ step)
            factors.append(factor)
            step -= factor * change
        if history:
            delta, change, _ = history[-1]
            step *= (delta @ change) / (change @ change)
        else:
            step *= .15
        for (delta, change, inverse), factor in zip(history, reversed(factors)):
            step += delta * (factor - inverse * (change @ step))
        direction = -step
        slope = gradient @ direction
        amount = 1.
        for _ in range(30):
            proposed = point + amount * direction
            new_value, new_gradient = function(proposed)
            if new_value <= value + .0001 * amount * slope:
                break
            amount *= .5
        else:
            break
        delta, change = proposed - point, new_gradient - gradient
        curvature = delta @ change
        if curvature > 1e-11:
            history.append((delta, change, 1 / curvature))
            history = history[-12:]
        point, value, gradient = proposed, new_value, new_gradient
    return point


def ordinal_model(matrix, stars):
    classes = np.searchsorted(LEVELS, stars).clip(0, 5)
    indices = np.arange(len(classes))
    initial = [log_odds(((classes <= i).sum() + .5) / (len(classes) + 1)) for i in range(5)]
    for i in range(1, 5):
        initial[i] = max(initial[i], initial[i - 1] + .04)
    penalty = np.full(matrix.shape[1], 2.)
    penalty[0] = 0  # Coast supplies a single pre-existing, cross-fitted predictor.

    def loss(params):
        cut, weights = params[:5], params[5:]
        if np.min(np.diff(cut)) < 1e-7:
            return np.inf, np.zeros(len(params))
        cumulative = np.column_stack((np.zeros(len(classes)), sigmoid(cut - (matrix @ weights)[:, None]), np.ones(len(classes))))
        probability = np.maximum(cumulative[indices, classes + 1] - cumulative[indices, classes], 1e-12)
        curvature = cumulative * (1 - cumulative)
        lower, upper = curvature[indices, classes], curvature[indices, classes + 1]
        cut_gradient = (np.bincount(classes, weights=-upper / probability, minlength=6)[:5]
                        + np.bincount(classes, weights=lower / probability, minlength=6)[1:])
        weight_gradient = matrix.T @ ((upper - lower) / probability) + penalty * weights
        return -np.log(probability).sum() + .5 * (penalty * weights) @ weights, np.r_[cut_gradient, weight_gradient]

    params = minimise(loss, np.r_[initial, np.zeros(matrix.shape[1])])
    return params[:5], params[5:]


def predict(fold, features):
    train = sorted((r for r in fold["train"] if r["score"] is not None), key=lambda row: row["id"])
    test = sorted((r for r in fold["test"] if r["score"] is not None), key=lambda row: row["id"])
    counts = Counter(k for row in train for keys in features[row["id"]].values() for k in keys)
    vocabulary = {k: i for i, k in enumerate(sorted(k for k, n in counts.items() if n >= 2))}
    examples, n = train + test, len(train)
    matrix = np.zeros((len(examples), len(vocabulary)))
    for i, row in enumerate(examples):
        for family, keys in features[row["id"]].items():
            columns = [vocabulary[k] for k in keys if k in vocabulary]
            if columns:
                matrix[i, columns] = FAMILIES[family] / math.sqrt(len(columns))
    baseline = np.array([r["score"] for r in examples])
    prior = log_odds(baseline / 100)
    prior = (prior - prior[:n].mean()) / max(.35, prior[:n].std())
    design = np.column_stack((prior, matrix))
    cuts, weights = ordinal_model(design[:n], np.array([r["stars"] for r in train]))
    tails = sigmoid((design[n:] @ weights)[:, None] - cuts)
    contribution = matrix[n:] @ weights[1:] - (matrix[:n] @ weights[1:]).mean()
    corrected = 100 * sigmoid(log_odds(baseline[n:] / 100) + np.clip(contribution, -.55, .55))
    return [{**r, "probability_4": tails[j, 2] * 100, "corrected": corrected[j]} for j, r in enumerate(test)]


def summarize(folds, key):
    # Combine comparisons only within a common held-out fit. A cross-fold pair saw different training data.
    wins, totals = np.zeros(3), np.zeros(3)
    truth, scores = [], []
    for fold in folds:
        stars = np.array([r["stars"] for r in fold])
        ratings = np.floor(np.array([r[key] for r in fold]) + .5)
        differences = ratings[:, None] - ratings[None, :]
        credit = (differences > 0) + .5 * (differences == 0)
        masks = [(stars >= 4)[:, None] & (stars <= 3)[None, :], stars[:, None] > stars[None, :],
                 (stars == 5)[:, None] & (stars == 3.5)[None, :]]
        for i, mask in enumerate(masks):
            wins[i] += credit[mask].sum()
            totals[i] += mask.sum()
        truth.extend(stars)
        scores.extend(ratings)
    truth, scores = np.array(truth), np.array(scores)
    return {"scored": len(scores), "ordering_4_vs_3_all_and_5_vs_3.5":
            [round(100 * w / n, 2) if n else None for w, n in zip(wins, totals)],
            "brier_4": round(float(np.mean((scores / 100 - (truth >= 4)) ** 2)), 4),
            "low_rated_80_plus": int(sum(scores[truth <= 2.5] >= 80)),
            "five_star_80_plus": int(sum(scores[truth == 5] >= 80))}


if __name__ == "__main__":
    captures, folds = (json.loads(Path(path).read_text()) for path in sys.argv[1:])
    inputs = {}
    for medium in captures:
        features = {r["work"]["id"]: groups(r["features"]) for r in medium["history"]}
        features.update({r["id"]: groups(r["features"]) for r in medium["catalogue"]})
        inputs[medium["medium"]] = features
    reports = defaultdict(list)
    for fold in folds:
        name = fold["split"] + (" " + fold["fold"] if fold["split"] == "rating date" else "")
        reports[fold["medium"], name].append(predict(fold, inputs[fold["medium"]]))
    for (medium, split), values in reports.items():
        print(medium, split, json.dumps({key: summarize(values, key) for key in ("score", "probability_4", "corrected")}))
