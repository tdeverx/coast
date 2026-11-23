"""Retrospective controls using the archived TMDB average and vote count.

Usage: python3 control.py GRADED_REPLAY DATED_RATINGS TMDB_CAPTURE
Prints only aggregates. Uses the original work/franchise folds, date cutoffs
and sparse masks. Current crowd averages cannot verify prospective accuracy.
"""
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from itertools import combinations
from statistics import mean


def fit_score(stars):
    if stars <= 3:
        return max(0, 20 * (stars - .5))
    if stars <= 4:
        return 50 + 30 * (stars - 3)
    return 80 + 20 * (stars - 4)


def reception(record):
    data = record.get("audience") or {}
    if data.get("scale") != 10 or not 0 < data.get("score", 0) <= 10 or data.get("votes", 0) < 1:
        return None
    return data["score"] / 2, data["votes"]


def training(known, dates, held, group, budget, split):
    if split == "rolling-day":
        return {w: stars for w, (date, stars) in dates.items() if date < group}
    ids = set(known) - {r["id"] for r in held}
    if budget != "all":
        limit, _, seed = budget.partition("#")
        def order(work):
            return hashlib.sha256(f"solo:{seed or '1'}:{work}".encode()).hexdigest()
        ids = sorted(ids, key=order)[:int(limit)]
    return {w: known[w] for w in ids}


def line(points, extra_parameter=False):
    # Positive lower 95% slope bound protects against coincidental agreement.
    # Vote weights enter the fit and an effective sample size accounts for their spread.
    if len(points) < 4:
        return 0., 0., 0., 0.
    mass = sum(w for x, y, w in points)
    effective = mass ** 2 / sum(w ** 2 for x, y, w in points)
    center = sum(x * w for x, y, w in points) / mass
    average = sum(y * w for x, y, w in points) / mass
    variance = sum(w * (x-center)**2 for x, y, w in points)
    dof = effective - (3 if extra_parameter else 2)
    if variance < 1e-6 or dof <= 0:
        return center, average, 0., 0.
    slope = sum(w * (x-center)*(y-average) for x, y, w in points) / variance
    noise = sum(w * (y-average-slope*(x-center))**2 for x, y, w in points)
    error = math.sqrt(noise / (dof*variance))
    return center, average, slope, max(0., slope - 1.96*error)


def agreement(rows, audience, prior):
    points = [(a[0], math.log1p(a[1]), fit_score(stars), a[1] / (a[1] + prior))
              for work, stars in rows.items() if (a := audience.get(work))]
    center, _, _, slope = line([(x, y, w) for x, z, y, w in points])
    log_center, mean_y, raw_volume, volume = line([(z, y, w) for x, z, y, w in points])
    # Residualise audience average and personal utility on log volume before
    # testing if audience average contributes anything beyond vote count alone.
    _, mean_x, x_on_volume, _ = line([(z, x, w) for x, z, y, w in points])
    _, _, _, partial = line([(x-mean_x-x_on_volume*(z-log_center), y-mean_y-raw_volume*(z-log_center), w)
                             for x, z, y, w in points], extra_parameter=True)
    return center, slope, log_center, volume, x_on_volume, partial


def order_accuracy(groups):
    wins = count = 0
    for group in groups.values():
        for a, b in combinations(group, 2):
            if a[0] == b[0]:
                continue
            count += 1
            wins += int((a[0] < b[0]) == (a[1] < b[1])) if a[1] != b[1] else .5
    return round(100 * wins / count, 2) if count else None


def describe(scored):
    counts = Counter()
    high_deltas = []
    for stars, base, score, crowd in scored:
        five, liked, low = stars == 5, stars >= 4, stars <= 2.5
        disagree = bool(crowd and stars - crowd[0] >= 1)
        counts.update({
            "scored": 1, "audienceKnown": crowd is not None, "changed": base != score,
            "disliked": low, "dislikedRed": low and score < 50,
            "liked": liked, "likedRed": liked and score < 50,
            "likedTurnedRed": liked and score < 50 <= base,
            "threeAndHalfTurnedRed": stars == 3.5 and score < 50 <= base,
            "fives": five, "fiveGreen": five and score >= 80,
            "fiveGreenLost": five and score < 80 <= base,
            "fiveGreenGained": five and base < 80 <= score,
            "fiveLower": five and score < base, "fiveTurnedRed": five and score < 50 <= base,
            "likedAboveAudience": liked and disagree,
            "likedAboveAudienceTurnedRed": liked and disagree and score < 50 <= base,
            "fiveAboveAudience": five and disagree,
            "fiveAboveAudienceLower": five and disagree and score < base,
            "fiveAboveAudienceGreenLost": five and disagree and score < 80 <= base,
        })
        if five and disagree:
            high_deltas.append(score-base)
    counts["fiveAboveAudienceMeanChange"] = round(mean(high_deltas), 2) if high_deltas else None
    return dict(counts)


def replay(runs, dates, audience, prior):
    labels = {r["medium"]: {h["id"]: h["stars"] for h in r["targets"]}
              for r in runs if r["split"] == "work" and r["budget"] == "all"}
    for run in runs:
        medium, split, budget = (run[k] for k in ("medium", "split", "budget"))
        held = defaultdict(list)
        for r in run["targets"]:
            held[r["group"]].append(r)
        results = {arm: [] for arm in ("personal", "crowd", "global", "volume", "afterVolume")}
        rankings = {arm: defaultdict(list) for arm in results}
        slopes = []
        for group, targets in held.items():
            train = training(labels[medium], dates[medium], targets, group, budget, split)
            assert not (set(train) & {t["id"] for t in targets})
            center, slope, log_center, volume, x_on_volume, partial = agreement(train, audience, prior)
            slopes.append(slope)
            for t in targets:
                base = t["scores"]["calibrated"]
                if base is None:
                    continue
                crowd = audience.get(t["id"])
                estimates = {arm: base for arm in results}
                estimates["crowd"] = 50.
                if crowd:
                    stars, votes = crowd
                    trust = votes / (votes + prior)
                    # Reception-only reverts to neutral as votes approach zero.
                    estimates["crowd"] = fit_score(3 + trust * (stars-3))
                    # The personal control retains the original calibration intercept.
                    estimates["global"] = base + trust * slope * (stars-center)
                    log_difference = math.log1p(votes) - log_center
                    estimates["volume"] = base + trust * volume * log_difference
                    estimates["afterVolume"] = estimates["volume"] + trust * partial * (stars-center-x_on_volume*log_difference)
                for arm, estimate in estimates.items():
                    score = max(0, min(100, math.floor(estimate + .5)))
                    results[arm].append((t["stars"], base, score, crowd))
                    rankings[arm][group].append((t["stars"], score))
        yield {
            "medium": medium, "split": split, "budget": budget, "activeFolds": sum(s > 0 for s in slopes),
            "folds": len(slopes), "meanAcceptedSlope": round(mean(s for s in slopes if s > 0), 2) if any(slopes) else None,
            "arms": {arm: {**describe(rows), "pairAccuracy": order_accuracy(rankings[arm])}
                     for arm, rows in results.items()},
        }


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    def load(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    replay_file, date_rows, metadata = map(load, sys.argv[1:])
    audience = {r["id"]: a for r in metadata if (a := reception(r))}
    dates = defaultdict(dict)
    for r in date_rows:
        dates[r["medium"]][r["id"]] = (r["at"][:10], r["stars"])
    # Fixed reference of 50 votes, with 10 and 200 only checking its sensitivity.
    runs = replay_file["runs"]
    dense = [run for run in runs if run["budget"] in ("all", "dated ratings only")]
    report = {prior: list(replay(runs if prior == 50 else dense, dates, audience, prior))
              for prior in (50, 10, 200)}
    print(json.dumps(report, separators=(",", ":"), allow_nan=False))
