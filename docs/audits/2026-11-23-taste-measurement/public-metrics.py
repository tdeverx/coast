"""Compare models on the same targets. Usage: python3 public-metrics.py predictions.json"""
import bisect
import collections
import json
import random
import statistics
import sys


def ordering(rows, field):
    weak = sorted(r[field] for r in rows if r["y"] <= 3)
    liked = [r[field] for r in rows if r["y"] >= 4]
    if not weak or not liked:
        return None
    return statistics.mean((bisect.bisect_left(weak, s) + bisect.bisect_right(weak, s))
                           / (2 * len(weak)) for s in liked)


def report(data):
    rows = data["predictions"]
    for r in rows:
        r["coast"] = r["scores"][0]
        if len(r["scores"]) > 1:
            r["moderate"] = r["scores"][1]
    common = [r for r in rows if all(s is not None for s in r["scores"])]
    users = collections.defaultdict(list)
    for r in common:
        users[r["u"]].append(r)
    print("held / scored / eligible users / with comparable ratings", len(rows), len(common),
          len({r["u"] for r in rows}), sum(ordering(rs, "coast") is not None for rs in users.values()))
    fields = ["coast", "prior", "community", "personalCommunity", "bias", "neighbors"]
    if rows and "moderate" in rows[0]:
        fields.append("moderate")
    for field in fields:
        macro = [a for rs in users.values() if (a := ordering(rs, field)) is not None]
        error = statistics.mean((r[field] / 100 - (r["y"] >= 4)) ** 2 for r in common)
        print(field, "mean personal ordering", round(100 * statistics.mean(macro), 2),
              "Brier", round(error, 4), "green at <=2 and =5",
              [(sum(r[field] >= 80 for r in common if predicate(r["y"])),
                sum(predicate(r["y"]) for r in common)) for predicate in (lambda y:y <= 2, lambda y:y == 5)])
    for a, b in [("neighbors", "bias"), ("neighbors", "coast"), ("bias", "community")]:
        differences = [ordering(rs, a) - ordering(rs, b) for rs in users.values()
                       if ordering(rs, a) is not None]
        rng = random.Random(32618)
        samples = sorted(statistics.mean(rng.choices(differences, k=len(differences))) for _ in range(2000))
        print(a, "minus", b, "mean percentage points and paired user-bootstrap 95% interval",
              [round(100*x, 2) for x in (statistics.mean(differences), samples[49], samples[1949])])
    print("supported by 5+ neighbors", sum(r["support"] >= 5 for r in common), "/", len(common))


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path) as source:
            report(json.load(source))
