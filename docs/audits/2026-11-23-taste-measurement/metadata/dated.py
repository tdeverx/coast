from research import (
    Path,
    get,
    p,
    ds,
    vec,
    meta,
    np,
    itertools,
    json,
    ordinal_folds,
    text_kernel,
    reg,
    rounded,
    score_metrics,
)

import hashlib

byday = lambda at: (
    hashlib.sha256(("past-day-ordinal:" + at[:10]).encode()).digest()[0] % 5
)
for medium in ["movie", "show"]:
    data = next(d for d in ds if d["medium"] == medium)
    for cut in ["2022", "2024"]:
        group = next(
            g
            for g in ordinal_folds
            if g["medium"] == medium
            and g["split"] == "rating date"
            and g["fold"] == cut
        )
        train = [x for x in group["train"] if x["id"] in vec]
        test = [x for x in group["test"] if x["id"] in vec and x["score"] is not None]
        trainbase = np.array(
            [x["score"] if x["score"] is not None else np.nan for x in train]
        )
        T = len(train)
        ids = [r["id"] for r in train + test]
        L = np.array([x["stars"] for x in train + test])
        y = 100 * (L >= 4)
        F = np.array([byday(x["at"]) for x in train + test])
        IX = np.arange(T)
        TEST = np.arange(T, len(ids))
        x_test = np.array([x["score"] for x in test], dtype=float)
        fg = {r["work"]["id"]: r["features"] for r in data["history"]}
        k = text_kernel(ids, "semantic")
        lex = text_kernel(ids, "lexical")
        candidates = {}
        choices = {}
        for name, ker in [("sem", k), ("lex", lex)]:
            loss = {}
            options = {}
            for power, lam in itertools.product([1, 2], [1.0, 8.0, 32.0]):
                kk = ker**power
                inn = np.zeros(T)
                star = np.zeros(T)
                pri = np.zeros(T)
                priorstar = np.zeros(T)
                for h in sorted(set(F[:T])):
                    tt = IX[F[:T] != h]
                    held = IX[F[:T] == h]
                    inn[held] = reg(kk, ids, tt, y, held, lam)
                    star[held] = reg(kk, ids, tt, L, held, lam)
                    pri[held] = y[tt].mean()
                    priorstar[held] = L[tt].mean()
                probs = reg(kk, ids, IX, y, TEST, lam)
                ss = reg(kk, ids, IX, L, TEST, lam)
                for typ, tr, te in [
                    ("delta", inn - pri, probs - y[IX].mean()),
                    ("blend", inn - trainbase, probs - x_test),
                    ("stars", 20 * (star - priorstar), 20 * (ss - L[IX].mean())),
                ]:
                    for strength in (0, 0.25, 0.5, 1):
                        tag = (power, lam, typ, strength)
                        t = np.isfinite(trainbase)
                        v = np.clip(trainbase + np.clip(strength * tr, -15, 15), 0, 100)
                        loss[tag] = np.mean((v[t] - y[IX][t]) ** 2)
                        options[tag] = rounded(x_test + np.clip(strength * te, -15, 15))
            best = sorted(loss, key=lambda a: (loss[a], a[3], a[1], a[0]))[0]
            choices[name] = best
            candidates[name + "Nested"] = options[best]
            candidates[name + "StarDelta"] = options[(1, 8.0, "stars", 0.5)]
            candidates[name + "LikeDelta"] = options[(1, 8.0, "delta", 0.5)]
        result = []
        for j, r in enumerate(test):
            id = r["id"]
            base = r["score"]
            row = {
                **r,
                "fold": 0,
                "title": meta[id]["title"],
                "genres": [v["name"] for v in fg.get(id, {}).get("genres", [])],
            }
            row.update({k: int(v[j]) for k, v in candidates.items()})
            result.append(row)
        print(
            medium,
            cut,
            len(train),
            len(test),
            "days",
            len(set(q["at"][:10] for q in train)),
            len(set(q["at"][:10] for q in test)),
            choices,
        )
        print(
            json.dumps(
                {k: score_metrics(result, k) for k in ("score", *candidates.keys())},
                default=float,
            ),
            flush=True,
        )
        (p / (medium + "-dated-" + cut + ".json")).write_text(json.dumps(result))
