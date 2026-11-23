"""Compare each family-removal policy with an all-fields personal baseline on identical scorable roots."""

import json
import sys
from collections import defaultdict
from pathlib import Path

dataset = json.loads(Path(sys.argv[1]).read_text())
groups = defaultdict(dict)
for r in dataset:
    groups[(r["medium"], r["rated"], r["arm"])][r["id"]] = r


def metrics(rows):
    high = [r for r in rows if r["stars"] >= 4]
    low = [r for r in rows if r["stars"] <= 3]
    pairs = [
        (h["score"], l["score"]) for h in high for l in low if h["fold"] == l["fold"]
    ]
    return (
        round(100 * sum((h > l) + 0.5 * (h == l) for h, l in pairs) / len(pairs), 2),
        sum(r["stars"] <= 2.5 and r["score"] >= 80 for r in rows),
        sum(r["stars"] == 5 and r["score"] >= 80 for r in rows),
    )


for (medium, rated, arm), rows in groups.items():
    baseline = groups[(medium, rated, "all")]
    support = [
        i
        for i in rows
        if rows[i]["score"] is not None and baseline[i]["score"] is not None
    ]
    print(
        medium,
        "ratings" if rated else "masked",
        arm,
        len(support),
        metrics([baseline[i] for i in support]),
        metrics([rows[i] for i in support]),
    )
