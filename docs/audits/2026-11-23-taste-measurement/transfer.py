"""Test borrowing exact feature identities from a viewer's movies to shows and vice versa.

python3 transfer.py capture.json verified-dates.json ordinal-inputs.json
Prints aggregate results only. The two strict rating-time test windows use the same Coast base.
"""
from collections import Counter
import importlib.util
import json
import math
from pathlib import Path
import statistics
import sys

spec = importlib.util.spec_from_file_location("correction", Path(__file__).parent.parent /
                                             "2026-11-23-taste-scaling" / "replay.py")
model = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model)


def metrics(rows, index):
    liked = [r[index] for r in rows if r[0] >= 4]
    weak = [r[index] for r in rows if r[0] <= 3]
    return (round(100 * statistics.mean((a > b) + .5 * (a == b) for a in liked for b in weak), 2),
            round(statistics.mean((r[index]/100 - int(r[0]>=4))**2 for r in rows), 4))


def run(captures, dates, folds):
    features, related = {}, {}
    for data in captures:
        for row in data["history"]:
            key = row["work"]["id"]
            related[key] = set(row.get("collections", [])) | {
                "franchise:"+f["id"] for f in row["features"].get("franchises", [])}
            features[key] = row["features"]
        features.update((r["id"], r["features"]) for r in data["catalogue"])
    # Movie and television genre names differ. Only identical existing IDs transfer.
    allowed = {"genres", "tags", "themes", "directors", "writers", "cast", "studios", "composers"}
    terms = {k: model.terms({f: items for f,items in x.items() if f in allowed}) for k,x in features.items()}
    for fold in folds:
        if fold["split"] != "rating date":
            continue
        held = [r for r in fold["test"] if r["score"] is not None]
        family = set().union(*(related.get(r["id"], set()) for r in held))
        source = [r for r in dates if r["medium"] != fold["medium"] and r["at"][:4] < fold["fold"]
                  and r["id"] in terms and not related.get(r["id"], set()) & family]
        halves = [[(terms[r["id"]], r["stars"]) for r in source if model.half(r["id"]) == h] for h in (0,1)]
        estimates = [model.fit(part) for part in halves]
        predictions, directions = [], Counter()
        for row in held:
            s = row["score"]
            votes = [sum(coef[key]*v for key,v in model.vector(terms[row["id"]], coef)) for _,coef in estimates]
            # Borrow only the direction both independent halves support, and cap its size.
            delta = min(votes) if min(votes)>0 else max(votes) if max(votes)<0 else 0
            delta = max(-.35, min(.35, delta))
            directions["up" if delta>0 else "down" if delta<0 else "abstain"] += 1
            def shifted(d):
                if d == 0:
                    return s
                return math.floor(.5 + 100*model.sigmoid(model.log_odds(max(.001,min(.999,s/100))) + d))
            predictions.append((row["stars"], s, shifted(delta), shifted(delta if (s-50)*delta>0 else 0)))
        print(fold["medium"], fold["fold"], "earlier source", len(source), "shared direction", dict(directions),
              "baseline/transfer/same-direction (ordering %, Brier)", [metrics(predictions,i) for i in (1,2,3)])


if __name__ == "__main__":
    run(*(json.loads(Path(p).read_text()) for p in sys.argv[1:]))
