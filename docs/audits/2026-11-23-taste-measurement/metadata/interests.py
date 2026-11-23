"""Single-viewer content-only prototypes and personal nearest-title comparators. Run in the private audit directory."""

import os

for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ[name] = "1"
import collections, hashlib, json, math, sys
from pathlib import Path
import numpy as np

p = Path(sys.argv[1])
read = lambda name: json.loads((p / name).read_text())
cohort = read("card-spread-history.json")
ordinal = read("ordinal-inputs-solo.json")
meta = {r["id"]: r for r in read("metadata.json")}
solo = {
    (r["medium"], r["rated"], r["id"]): r
    for r in read("family-scores.json")
    if r["arm"] == "all"
}
weights = {
    "genres": 0.30,
    "tags": 0.30,
    "cast": 0.10,
    "directors": 0.055,
    "writers": 0.045,
    "creators": 0.06,
    "studios": 0.10,
    "networks": 0.04,
}
special = {
    "Blade Runner 2049",
    "Sodom",
    "Naomi",
    "The Nevers",
    "Haters Back Off",
    "Spirited Away",
    "Howl's Moving Castle",
    "The Boy and the Heron",
}
fold = lambda x: hashlib.sha256(x.encode()).digest()[0] % 5


def kernel(ids, feats):
    # Each family gets one vote regardless of how many cast/keywords Coast has stored.
    K = np.zeros((len(ids), len(ids)), dtype=float)
    for field, w in weights.items():
        postings = collections.defaultdict(list)
        for i, id in enumerate(ids):
            values = set(m["id"] for m in (feats[id].get(field) or []))
            if field == "creators":
                values = {
                    r["id"]
                    for r in (meta[id].get("credits") or [])
                    if r["role"] == "Creator"
                }
            for term in values:
                postings[term].append((i, math.sqrt(w / len(values))))
        for records in postings.values():
            x = np.array([r[0] for r in records])
            v = np.array([r[1] for r in records])
            K[np.ix_(x, x)] += np.outer(v, v)
    norm = np.sqrt(np.diag(K))
    return K / np.maximum(1e-10, np.outer(norm, norm))


def subprofiles(K, train, k):
    """Deterministic spherical k-means over item cosine. Discard singleton clusters."""
    train = np.array(train, dtype=int)
    if len(train) == 0:
        return []
    sim = K[np.ix_(train, train)]
    k = min(k, max(1, len(train) // 6))
    seed = [int(np.argmax(sim.mean(axis=0)))]
    for _ in range(1, k):
        cost = sim[:, seed].max(axis=1)
        cost[seed] = 2
        seed.append(int(np.argmin(cost)))
    labels = sim[:, seed].argmax(axis=1)
    for _ in range(20):
        profiles = [np.flatnonzero(labels == n) for n in range(k)]
        cols = [
            sim[:, v].sum(axis=1) / max(1e-10, math.sqrt(sim[np.ix_(v, v)].sum()))
            if len(v)
            else np.full(len(train), -1)
            for v in profiles
        ]
        nxt = np.stack(cols, axis=1).argmax(axis=1)
        if np.array_equal(labels, nxt):
            break
        labels = nxt
    groups = [train[labels == n] for n in range(k) if (labels == n).sum() >= 3]
    return groups or [train]


def fit(K, train, stars, target, one_class=False):
    # Stable ID order provides a deterministic tie-break; target is always outside training.
    pos = train if one_class else train[stars[train] >= 4]
    neg = np.array([], dtype=int) if one_class else train[stars[train] <= 3]
    policies = {}
    for k in (1, 3, 6):

        def best(indices):
            if not len(indices):
                return np.zeros(len(target))
            affinities = []
            for group in subprofiles(K, indices, k):
                cols = K[np.ix_(target, group)]
                norms = max(1e-10, math.sqrt(K[np.ix_(group, group)].sum()))
                affinities.append(cols.sum(axis=1) / norms)
            return np.max(affinities, axis=0)

        policies["one" if k == 1 else "cluster" + str(k)] = best(pos) - best(neg)
    if not one_class:
        # Form groups without labels, then estimate each local distribution from its
        # member opinions. Four pseudo-observations limit leverage of tiny groups.
        for clusters in (3, 6):
            relevance, opinions = [], []
            for group in subprofiles(K, train, clusters):
                norm = max(1e-10, math.sqrt(K[np.ix_(group, group)].sum()))
                similarity = K[np.ix_(target, group)].sum(axis=1) / norm
                relevance.append(similarity**6)
                opinions.append(
                    (stars[group] - stars[train].mean()).sum() / (len(group) + 4)
                )
            relevance = np.stack(relevance, axis=1)
            opinions = np.array(opinions)
            policies["local" + str(clusters)] = (
                relevance @ opinions / (relevance.sum(axis=1) + 1e-8)
            )
    # Nearest observed works, centered on that viewer's own opinion distribution.
    # A target with no similar history receives no adjustment.
    for count in (4, 12):
        pred = []
        for j in target:
            sim = K[j, train]
            close = np.argsort(-sim, kind="stable")[:count]
            affinity = sim[close] ** 3
            if one_class:
                pred.append(affinity.sum() / count)
            else:
                pred.append(
                    np.dot(affinity, stars[train[close]] - stars[train].mean())
                    / (0.2 + affinity.sum())
                )
        policies["nearest" + str(count)] = np.array(pred)
    return policies


def rank(rows, key):
    out = {}
    for name, condition in [
        ("all", lambda r: True),
        ("animation", lambda r: "Animation" in r["genres"]),
        (
            "sci-fi",
            lambda r: any(
                x in r["genres"] for x in ["Sci-Fi & Fantasy", "Science Fiction"]
            ),
        ),
        (
            "other",
            lambda r: all(
                x not in r["genres"]
                for x in ["Sci-Fi & Fantasy", "Science Fiction", "Animation"]
            ),
        ),
    ]:
        total = credit = 0
        for f in set(r["fold"] for r in rows):
            rr = [r for r in rows if r["fold"] == f and condition(r)]
            pos = [r for r in rr if r["stars"] >= 4]
            neg = [r for r in rr if r["stars"] <= 3]
            pairs = [(a[key], b[key]) for a in pos for b in neg]
            total += len(pairs)
            credit += sum((a > b) + 0.5 * (a == b) for a, b in pairs)
        out[name] = [round(100 * credit / total, 2) if total else None, total]
    return out


def calculate(d):
    medium = d["medium"]
    feats = {r["work"]["id"]: r["features"] for r in d["history"]}
    feats.update({r["id"]: r["features"] for r in d["catalogue"] if r["id"] in feats})
    ids = sorted(feats)
    idx = {j: i for i, j in enumerate(ids)}
    K = kernel(ids, feats)
    history = {r["work"]["id"]: r["work"] for r in d["history"]}
    stars = np.array(
        [np.nan if history[i]["rating"] is None else history[i]["rating"] for i in ids]
    )

    scores = []
    for split in ["work", "masked", "franchise", "rating date"]:
        groups = [
            g
            for g in ordinal
            if g["medium"] == medium
            and g["split"] == ("work" if split == "masked" else split)
        ]
        for g in groups:
            f = g["fold"]
            tests = [r for r in g["test"] if r["score"] is not None]
            trainrows = [r for r in g["train"] if r["id"] in idx]
            train = np.array(sorted(idx[r["id"]] for r in trainrows))
            if split == "masked":
                train = np.array(
                    sorted(
                        idx[i]
                        for i, w in history.items()
                        if w["consumed"] and fold(i) != int(f)
                    )
                )
            test = np.array([idx[r["id"]] for r in tests])
            source_stars = np.full(len(ids), np.nan)
            if split != "masked":
                for rated in trainrows:
                    source_stars[idx[rated["id"]]] = rated["stars"]
            policies = fit(K, train, source_stars, test, split == "masked")
            selected = ("nearest4", 0)
            if split != "masked":
                fold_of = {idx[r["id"]]: q["fold"] for q in groups for r in q["test"]}

                def inner_fold(row):
                    if split == "rating date":
                        return fold("past-day-ordinal:" + row["at"][:10])
                    return fold_of[idx[row["id"]]]

                keys = ["nearest4", "nearest12", "local3", "local6"]
                perf = collections.defaultdict(lambda: [0, 0])
                for h in sorted({inner_fold(r) for r in trainrows}):
                    inside = np.array(
                        sorted(idx[r["id"]] for r in trainrows if inner_fold(r) != h),
                        dtype=int,
                    )
                    held = [
                        r
                        for r in trainrows
                        if inner_fold(r) == h and r["score"] is not None
                    ]
                    if not len(inside) or not held:
                        continue
                    iy = np.array([r["stars"] for r in held])
                    hi = iy >= 4
                    lo = iy <= 3
                    if not np.any(hi) or not np.any(lo):
                        continue
                    x = np.array([r["score"] for r in held])
                    points = fit(
                        K, inside, source_stars, np.array([idx[r["id"]] for r in held])
                    )
                    for key in keys:
                        for strength in (0, 4, 8):
                            pred = np.clip(
                                np.floor(
                                    x + np.clip(strength * points[key], -8, 8) + 0.5
                                ),
                                0,
                                100,
                            )
                            gaps = pred[hi, None] - pred[lo]
                            perf[(key, strength)][0] += (gaps > 0).sum() + 0.5 * (
                                gaps == 0
                            ).sum()
                            perf[(key, strength)][1] += gaps.size
                if perf:
                    selected = max(
                        perf,
                        key=lambda k: (
                            perf[k][0] / perf[k][1],
                            -k[1],
                            -keys.index(k[0]),
                        ),
                    )
            for q, t in enumerate(test):
                row = tests[q]
                id = ids[t]
                score = (
                    solo[(medium, split != "masked", id)]["score"]
                    if split in ["work", "masked"]
                    else row["score"]
                )
                if score is None:
                    continue
                record = {
                    "medium": medium,
                    "split": split,
                    "fold": f,
                    "id": id,
                    "stars": row["stars"],
                    "base": score,
                    "title": meta[id]["title"],
                    "genres": [a["name"] for a in feats[id].get("genres", [])],
                }
                for key, values in policies.items():
                    record[key] = float(values[q])
                    if split != "masked" and key in [
                        "nearest4",
                        "nearest12",
                        "local3",
                        "local6",
                    ]:
                        # Predeclared small bounded adjustment, expressed in star residuals;
                        # no fitted mapping from the test cohort’s native score distribution.
                        record[key + "Mix"] = int(
                            np.clip(
                                np.floor(score + np.clip(8 * values[q], -8, 8) + 0.5),
                                0,
                                100,
                            )
                        )
                if split != "masked":
                    key, strength = selected
                    record["selection"] = selected
                    record["nestedMix"] = int(
                        np.clip(
                            np.floor(
                                score
                                + np.clip(strength * policies[key][q], -8, 8)
                                + 0.5
                            ),
                            0,
                            100,
                        )
                    )
                if record["title"] in special and split == "work":
                    similar = sorted(train, key=lambda j: (-K[t, j], ids[j]))[:4]
                    record["examples"] = [
                        (meta[ids[j]]["title"], float(stars[j]), round(K[t, j], 3))
                        for j in similar
                    ]
                scores.append(record)
    return scores


results = [r for d in cohort for r in calculate(d)]
(p / "interest-scores.json").write_text(json.dumps(results))
for medium in ["movie", "show"]:
    for split in ["work", "masked", "franchise", "2022", "2024"]:
        rows = [
            r
            for r in results
            if r["medium"] == medium
            and (
                r["split"] == split
                or (r["split"] == "rating date" and r["fold"] == split)
            )
        ]
        print(
            medium,
            split,
            len(rows),
            json.dumps(
                {
                    k: rank(rows, k)
                    for k in [
                        "base",
                        "one",
                        "cluster3",
                        "cluster6",
                        "nearest4",
                        "nearest12",
                        *(
                            [
                                "local3",
                                "local6",
                                "local3Mix",
                                "local6Mix",
                                "nearest4Mix",
                                "nearest12Mix",
                                "nestedMix",
                            ]
                            if split != "masked"
                            else []
                        ),
                    ]
                }
            ),
        )
for row in results:
    if row.get("examples"):
        print("case", row["title"], row["stars"], row["examples"])
