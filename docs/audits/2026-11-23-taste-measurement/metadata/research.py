"""Compare independent text information with the existing Coast score on the original five held-out folds."""

import os

for k in ["OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "OMP_NUM_THREADS"]:
    os.environ[k] = "1"
import json, re, math, sys, collections, itertools
from pathlib import Path
import numpy as np

p = Path(sys.argv[1]) if len(sys.argv) > 1 else None
if p is None:
    raise SystemExit("Usage: python research.py <private-input-and-output-directory>")
get = lambda file: json.loads(file.read_text())
ds = get(p / "card-spread-history.json")
meta = {r["id"]: r for r in get(p / "metadata.json")}
ordinal_folds = get(p / "ordinal-inputs.json")
emb = np.load(p / "emb-rated.npz")
vec = dict(zip(emb["ids"], emb["emb"]))


def text_kernel(ids, mode):
    if mode == "semantic":
        V = np.array([vec[i] for i in ids], dtype="float64")
        return V @ V.T
    # Fixed log-term-frequency cosine requires no vocabulary or IDF fitted on later titles.
    stop = set(
        "the and for with from into that their this they them when where who why how has have had him her his she its are was were can will but could should ones one known after before through over across about then each only just all any away such other some both which must than more while own very themselves been also first finds finds during within under among until these those".split()
    )
    postings = collections.defaultdict(list)
    K = np.zeros((len(ids), len(ids)))
    for j, i in enumerate(ids):
        words = [
            w
            for w in re.findall(r"[a-z]{3,}", (meta[i]["overview"] or "").lower())
            if w not in stop
        ]
        counts = collections.Counter(
            words + [a + "_" + b for a, b in zip(words, words[1:])]
        )
        v = {k: math.log1p(n) for k, n in counts.items()}
        norm = math.sqrt(sum(n * n for n in v.values())) or 1
        for t, x in v.items():
            postings[t].append((j, x / norm))
    for hits in postings.values():
        ix = np.array([j for j, _ in hits])
        weights = np.array([v for _, v in hits])
        K[np.ix_(ix, ix)] += np.outer(weights, weights)
    return K


def reg(K, ids, subs, y, new, lamb):
    a = K[np.ix_(subs, subs)]
    b = K[np.ix_(new, subs)]
    av = y[subs].mean()
    return av + b @ np.linalg.solve(a + np.eye(len(subs)) * lamb, y[subs] - av)


def score_metrics(rows, key):
    def p(w):
        return [r for r in rows if w(r)]

    def ranks(rs):
        a = b = 0
        for f in range(5):
            pos = [r[key] for r in rs if r["fold"] == f and r["stars"] >= 4]
            neg = [r[key] for r in rs if r["fold"] == f and r["stars"] <= 3]
            b += len(pos) * len(neg)
            a += sum((x > y) + 0.5 * (x == y) for x in pos for y in neg)
        return round(100 * a / b, 2) if b else None

    def hit(rs):
        return sum(
            r["stars"] >= 4 for r in sorted(rs, key=lambda r: (-r[key], r["id"]))[:20]
        )

    r = [v for v in rows if v[key] is not None]
    low = [v[key] for v in r if v["stars"] <= 2.5]
    high = [v[key] for v in r if v["stars"] == 5]
    return {
        "order": ranks(r),
        "brier": round(
            np.mean([(v[key] / 100 - (v["stars"] >= 4)) ** 2 for v in r]), 4
        ),
        "low/fav": [np.median(low), np.median(high)],
        "top": [
            hit(r),
            hit([v for v in r if "Animation" in v["genres"]]),
            hit(
                [
                    v
                    for v in r
                    if "Sci-Fi & Fantasy" in v["genres"]
                    or "Science Fiction" in v["genres"]
                ]
            ),
        ],
        "wrong80": [sum(v >= 80 for v in low), len(low)],
        "fav80": [sum(v >= 80 for v in high), len(high)],
    }


def rounded(v):
    return np.floor(np.clip(v, 0, 100) + 0.5)


def coverage(r, h):
    m = meta[r["id"]]
    return [
        float(bool(m["runtime_minutes"])),
        float(bool(h.get("ageRatings"))),
        np.log1p(len(h.get("tags", []))),
        np.log1p(len(h.get("cast", []))),
        np.log1p(len(h.get("studios", []))),
    ]


def calc(data, split):
    medium = data["medium"]
    history = {r["work"]["id"]: r for r in data["history"]}
    hist = [r for r in data["history"] if r["work"]["rating"] is not None]
    ids = [r["work"]["id"] for r in hist]
    idx = {i: n for n, i in enumerate(ids)}
    stars = np.array([r["work"]["rating"] for r in hist])
    labels = (stars >= 4).astype(float)
    y = labels * 100
    replay = {
        int(group["fold"]): group
        for group in ordinal_folds
        if group["medium"] == medium and group["split"] == split
    }
    bas = {
        r["id"]: (fold, r["score"])
        for fold, group in replay.items()
        for r in group["test"]
    }
    nested = {
        outer: {r["id"]: r["score"] for r in group["train"]}
        for outer, group in replay.items()
    }
    folds = np.array([bas[i][0] for i in ids])
    b0 = np.array([np.nan if bas[i][1] is None else bas[i][1] for i in ids])
    K = text_kernel(ids, "semantic")
    L = text_kernel(ids, "lexical")
    X = np.array([coverage({"id": i}, history[i]["features"]) for i in ids])
    result = []
    config = []
    for f in range(5):
        train = np.where(folds != f)[0]
        test = np.where((folds == f) & np.isfinite(b0))[0]
        groups = sorted(set(folds[train]))
        train_base = np.array(
            [np.nan if nested[f][ids[a]] is None else nested[f][ids[a]] for a in train]
        )
        train = train[np.isfinite(train_base)]
        train_base = train_base[np.isfinite(train_base)]
        corrected = {}
        metadata = [("sem", K), ("lex", L), ("fusion", 0.5 * K + 0.5 * L)]
        for name, ker in metadata:
            # Compare a conservative fixed blend, train-only model selection and within-training baseline residuals.
            outs = {}
            losses = {}
            for order, lam in itertools.product([1, 2], [1.0, 8.0, 32.0]):
                k = ker**order
                pred = np.zeros(len(train))
                pstars = np.zeros(len(train))
                pri = np.zeros(len(train))
                avstars = np.zeros(len(train))
                for g in groups:
                    a = train[folds[train] != g]
                    mask = folds[train] == g
                    pred[mask] = reg(k, ids, a, y, train[mask], lam)
                    pstars[mask] = reg(k, ids, a, stars, train[mask], lam)
                    pri[mask] = y[a].mean()
                    avstars[mask] = stars[a].mean()
                yi = reg(k, ids, train, y, test, lam)
                si = reg(k, ids, train, stars, test, lam)
                mean = y[train].mean()
                mstar = stars[train].mean()
                for kind, op, hold in [
                    ("delta", pred - pri, yi - mean),
                    ("blend", pred - train_base, yi - b0[test]),
                    ("stars", 20 * (pstars - avstars), 20 * (si - mstar)),
                ]:
                    for strength in (0, 0.25, 0.5, 1.0):
                        a = (order, lam, kind, strength)
                        df = np.clip(hold * strength, -15, 15)
                        outs[a] = rounded(b0[test] + df)
                        losses[a] = np.mean(
                            (
                                np.clip(
                                    train_base + np.clip(strength * op, -15, 15), 0, 100
                                )
                                - y[train]
                            )
                            ** 2
                        )
            ordered = sorted(losses, key=lambda a: (losses[a], a[3], a[1], a[0]))
            win = ordered[0]
            corrected[name + "Nested"] = outs[win]
            corrected[name + "LikeDelta"] = outs[(1, 8.0, "delta", 0.5)]
            corrected[name + "StarDelta"] = outs[(1, 8.0, "stars", 0.5)]
            config.append([f, name, win])
        raw = reg(K, ids, train, y, test, 8)
        A = (X[train] - X[train].mean(axis=0)) / (X[train].std(axis=0) + 0.05)
        B = (X[test] - X[train].mean(axis=0)) / (X[train].std(axis=0) + 0.05)
        pc = y[train].mean() + B @ np.linalg.solve(
            A.T @ A + 20 * np.eye(X.shape[1]), A.T @ (y[train] - y[train].mean())
        )
        for j, k in enumerate(test):
            id = ids[k]
            r = {
                "id": id,
                "title": meta[id]["title"],
                "genres": [
                    x["name"] for x in history[id]["features"].get("genres", [])
                ],
                "fold": f,
                "stars": float(stars[k]),
                "score": int(b0[k]),
                "textOnly": int(rounded(raw[j])),
                "coverageOnly": int(rounded(pc[j])),
            }
            r.update({k: int(v[j]) for k, v in corrected.items()})
            result.append(r)
    print(
        medium,
        split,
        "metrics",
        json.dumps(
            {
                k: score_metrics(result, k)
                for k in ["score", "textOnly", "coverageOnly"] + list(corrected)
            }
        ),
        flush=True,
    )
    print(medium, split, "selection", config, flush=True)
    for r in result:
        if r["title"] in (
            "Naomi",
            "The Nevers",
            "Sodom",
            "Blade Runner 2049",
            "Haters Back Off",
        ):
            print(
                r["title"],
                {
                    k: r[k]
                    for k in (
                        "stars",
                        "score",
                        "semNested",
                        "lexNested",
                        "semLikeDelta",
                        "semStarDelta",
                        "coverageOnly",
                    )
                },
                flush=True,
            )
    (p / (medium + "-" + split + ".json")).write_text(json.dumps(result))


if __name__ == "__main__":
    for d in ds:
        for split in ["work", "franchise"]:
            calc(d, split)
