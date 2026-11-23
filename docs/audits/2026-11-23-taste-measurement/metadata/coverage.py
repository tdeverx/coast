"""Audit feature parity and compare pairs matched on catalogue completeness within original work folds."""

import json
import sys
from collections import defaultdict
from pathlib import Path

directory = Path(sys.argv[1])
read = lambda name: json.loads((directory / name).read_text())
meta = {r["id"]: r for r in read("metadata.json")}
for d in read("card-spread-history.json"):
    medium = d["medium"]
    features = {r["work"]["id"]: r["features"] for r in d["history"]}
    catalogue = {r["id"]: r["features"] for r in d["catalogue"]}
    shared = set(features) & set(catalogue)
    print(
        medium,
        "shared roots",
        len(shared),
        "different features",
        sum(features[i] != catalogue[i] for i in shared),
    )
    rows = read(f"{medium}-work.json")
    for key in ["score", "coverageOnly"]:
        for matched in [False, True]:
            groups = defaultdict(list)
            for r in rows:
                f = features[r["id"]]
                size = len(f.get("tags", []))
                match = (
                    bool(meta[r["id"]]["runtime_minutes"]),
                    bool(f.get("ageRatings")),
                    size // 6,
                )
                groups[(r["fold"], match if matched else None)].append(r)
            credit = comparisons = 0
            for group in groups.values():
                for a in group:
                    if a["stars"] < 4:
                        continue
                    for b in group:
                        if b["stars"] > 3:
                            continue
                        comparisons += 1
                        credit += (a[key] > b[key]) + 0.5 * (a[key] == b[key])
            print(
                "matched" if matched else "all",
                key,
                comparisons,
                round(100 * credit / comparisons, 2),
            )
