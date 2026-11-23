"""A single viewer's content similarity model, using only that viewer's titles and opinions.

python3.13 personal-kernel.py private-capture.json private-solo-folds.json
Outer-fold predictions, including score bounds, are fixed before seeing held-out ratings.
"""
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
import numpy as np

GROUPS = {"genres":1., "tags":1., "themes":.8, "directors":.65, "writers":.55,
          "cast":.5, "studios":.4, "networks":.35, "franchises":.5,
          "decades":.12, "ageRatings":.12, "countries":.1, "languages":.08}


def similarity(ids, n_fit, features):
    matrix = np.zeros((len(ids),len(ids)))
    mass = np.zeros(len(ids))
    # Normalise within each family. Sharing several rare cast/crew IDs is evidence.
    # Long metadata lists and two absent families have no intrinsic similarity.
    for family, weight in GROUPS.items():
        keys = [{v["id"] for v in features.get(i,{}).get(family,[])} for i in ids]
        freq = Counter(k for row in keys[:n_fit] for k in row)
        inv = {k: min(3.,1.+np.log((1+n_fit)/(1+c))) for k,c in freq.items()}
        postings = defaultdict(list)
        for i, row in enumerate(keys):
            if not row:
                continue
            mass[i] += weight
            norm = np.sqrt(sum(inv.get(k,3.)**2 for k in row))
            for k in row:
                if k in freq:
                    postings[k].append((i,inv[k]/norm))
        for positions in postings.values():
            ix, vals = zip(*positions)
            matrix[np.ix_(ix,ix)] += weight*np.outer(vals,vals)
    return matrix / np.sqrt(np.maximum(1e-12,np.outer(mass,mass)))


def scores(fold, features):
    train = [r for r in fold["train"] if r["score"] is not None]
    held = [r for r in fold["test"] if r["score"] is not None]
    if not held:
        return []
    n = len(train)
    k = similarity([r["id"] for r in train+held],n,features)
    # A linear kernel vs one that gives extra evidence when several details match together.
    y = np.array([r["stars"] for r in train])
    y_like = (y>=4).astype(float)
    anchor = np.array([r["score"]/100 for r in train])
    base = np.array([r["score"]/100 for r in held])
    perm = sorted(range(n),key=lambda j: hashlib.sha256(("shuffle:"+train[j]["id"]).encode()).digest())
    values = {"Coast":base}
    for method, gram in [("additive",k), ("interactions",.45*k + .55*k**2)]:
        labels = np.column_stack([y-y.mean(),y_like-y_like.mean(),y_like-anchor,y[perm]-y.mean()])
        coef = np.linalg.solve(gram[:n,:n]+np.eye(n),labels)
        prediction = gram[n:,:n]@coef
        values[method+" stars"] = np.clip((y.mean()+prediction[:,0]-1)/4,0,1)
        values[method+" likes"] = np.clip(y_like.mean()+prediction[:,1],0,1)
        values[method+" correction"] = np.clip(base+np.clip(prediction[:,2],-.10,.10),0,1)
        values[method+" shuffled"] = np.clip((y.mean()+prediction[:,3]-1)/4,0,1)
    return [{"stars":r["stars"],"animation":any(v["name"]=="Animation" for v in features[r["id"]].get("genres",[])),
             "scifi":any(v["name"] in ("Science Fiction","Sci-Fi & Fantasy") for v in features[r["id"]].get("genres",[])),
             "scores":{name:round(float(val[i])*100) for name,val in values.items()}} for i,r in enumerate(held)]


def pairs(rows, name, favourite):
    pos = [r["scores"][name] for r in rows if (r["stars"]==5 if favourite else r["stars"]>=4)]
    neg = [r["scores"][name] for r in rows if (r["stars"]==3.5 if favourite else r["stars"]<=3)]
    a = np.subtract.outer(pos,neg)
    return np.sum(a>0)+.5*np.sum(a==0), a.size


def compare(groups):
    flat = [r for g in groups for r in g]
    for name in flat[0]["scores"]:
        metrics = []
        for favourite in [False,True]:
            credit,total = np.sum([pairs(g,name,favourite) for g in groups],axis=0)
            metrics.append(round(float(100*credit/total),2) if total else None)
        def top(field):
            # Do not compare scores from different fitted models for dated folds.
            eligible=[row for row in flat if row[field]]
            ordered=sorted(eligible,key=lambda row:-row["scores"][name])
            top=ordered[:20]
            if not top:return None
            boundary=top[-1]["scores"][name]
            above=[r for r in eligible if r["scores"][name]>boundary]
            tied=[r for r in eligible if r["scores"][name]==boundary]
            return round(sum(r["stars"]>=4 for r in above)+(len(top)-len(above))*np.mean([r["stars"]>=4 for r in tied]),2)
        print(name,metrics,"liked Animation/Sci-Fi in top 20 (fractional ties)",top("animation"),top("scifi"))


def main(capture,folds):
    for data in capture:
        features={r["work"]["id"]:r["features"] for r in data["history"]}
        features.update((r["id"],r["features"]) for r in data["catalogue"])
        by_split=defaultdict(list)
        for fold in folds:
            if fold["medium"]!=data["medium"]:
                continue
            key=fold["split"]+(" "+fold["fold"] if fold["split"]=="rating date" else "")
            by_split[key].append(scores(fold,features))
        for split,groups in by_split.items():
            print(data["medium"],split)
            compare(groups)


if __name__=="__main__":
    main(*(json.loads(Path(p).read_text()) for p in sys.argv[1:]))
