"""python3 daily-personal.py <capture.json> <daily-inputs.json> [new-private-forecasts.json]

One forecast per eligible title. Ratings on the same UTC date are revealed together.
"""
from collections import defaultdict
from pathlib import Path
import json
import os
import runpy
import sys

import numpy as np

personal = runpy.run_path(str(Path(__file__).with_name("personal-counts.py")))
methods = ("prior", "score", "main", "residual", "plus_main", "plus_residual")
rank_targets = ("strong_weak", "all_unequal", "five_three_half")


def forecast(capture, data):
    m = capture["medium"]
    raw = {r["work"]["id"]:r["features"] for r in capture["history"]}
    raw.update({r["id"]:r["features"] for r in capture["catalogue"]})
    features = {key:sorted(term for values in personal["group_features"](f).values() for term in values)
                for key,f in raw.items()}
    days = defaultdict(list)
    for r in data:
        if r["medium"] == m:
            days[r["at"][:10]].append(r)
    prior, forecasts = [], []
    for date, held in sorted(days.items()):
        assert all(r["historySize"] == len(prior) for r in held)
        if len(prior) >= 25:
            p = 100*(sum(r["stars"] >= 4 for r in prior)+.5)/(len(prior)+1)
            # Send every eligible title one forecast even if Coast abstained. The neutral control
            # then uses only the probability this viewer gave earlier titles at least four stars.
            targets = [dict(r,score=p if r["score"] is None else r["score"],prior=p,
                            fallback=r["score"] is None) for r in held]
            result, _ = personal["predictions"]({"train":prior,"test":targets},features)
            for row in result:
                f=raw[row["id"]]
                names={k:{term["name"].casefold() for term in f.get(k,[])} for k in ("genres","studios","tags")}
                row["subgroups"]=[key for key,yes in (
                    ("animation","animation" in names["genres"]),
                    ("sci-fi",bool({"science fiction","sci-fi & fantasy"}&names["genres"])),
                    ("ghibli","studio ghibli" in names["studios"]),("anime","anime" in names["tags"])) if yes]
            forecasts.extend(result)
        prior.extend(held)
    assert len(forecasts) == len({r["id"] for r in forecasts})
    return forecasts


def summarize(rows):
    days = defaultdict(list)
    for r in rows:
        days[r["at"][:10]].append(r)
    dates = sorted(days)
    losses = {method:[] for method in methods}
    victories = {method:[] for method in methods}
    totals = []
    ns = []
    for day in dates:
        rr = days[day]
        stars = np.array([r["stars"] for r in rr]); truth = stars>=4
        masks = [truth[:,None]&(stars<=3)[None,:], stars[:,None]>stars[None,:], (stars==5)[:,None]&(stars==3.5)[None,:]]
        totals.append([mask.sum() for mask in masks])
        ns.append(len(rr))
        for method in methods:
            probabilities = np.array([r[method]/100 for r in rr])
            losses[method].append(np.square(probabilities-truth).sum())
            integer = np.floor(100*probabilities+.5)
            diff = integer[:,None]-integer[None,:]
            credit = (diff>0)+.5*(diff==0)
            victories[method].append([(credit*mask).sum() for mask in masks])
    totals = np.array(totals)
    rng = np.random.default_rng(8429)
    wt = rng.multinomial(len(dates),np.ones(len(dates))/len(dates),3000)
    blocks = {rank:{"pairs":int(totals[:,i].sum()), "days":int((totals[:,i]>0).sum()),
                    "largest_day_pairs":int(totals[:,i].max())} for i,rank in enumerate(rank_targets)}
    out = {}
    for method in methods:
        v = np.array(victories[method])
        loss = np.array(losses[method])
        brier_delta = (wt@(loss-losses["score"]))/(wt@ns)
        delta = wt@(v-np.array(victories["score"]))
        n = wt@totals
        intervals = []
        for i in range(3):
            exists = n[:,i]>0
            intervals.append(np.round(100*np.quantile(delta[exists,i]/n[exists,i],[.025,.975]),2).tolist() if exists.any() else None)
        out[method] = {"brier":round(float(loss.sum()/len(rows)),5),"mean_day_brier":round(float((loss/ns).mean()),5),
                       "brier_delta_interval":np.round(np.quantile(brier_delta,[.025,.975]),5).tolist(),
                       "order":[round(float(100*w/n),2) if n else None for w,n in zip(v.sum(axis=0),totals.sum(axis=0))],
                       "order_delta_intervals":intervals}
    return {"titles":len(rows),"days":len(dates),"four_or_more":sum(r["stars"]>=4 for r in rows),
            "fallbacks":sum(r["fallback"] for r in rows),"blocks":blocks,"methods":out}


def subgroup_errors(rows):
    results={}
    for group in ("animation","sci-fi","ghibli","anime"):
        members=[r for r in rows if group in r["subgroups"]]
        if not members:
            results[group]={"n":0}
            continue
        results[group]={"n":len(members),"four_or_more":sum(r["stars"]>=4 for r in members),
                        "three_and_a_half":sum(r["stars"]==3.5 for r in members),
                        "average_score":{method:round(float(np.mean([r[method] for r in members])),2)
                                         for method in ("score","plus_residual")},
                        "brier":{method:round(float(np.mean([(r[method]/100-(r["stars"]>=4))**2 for r in members])),5)
                                 for method in ("prior","score","plus_main","plus_residual")}}
    return results


if __name__ == "__main__":
    capture, inputs = [json.loads(Path(p).read_text()) for p in sys.argv[1:3]]
    all_rows = []
    for c in capture:
        if c["medium"] not in ("movie","show"):
            continue
        rows = forecast(c,inputs)
        print(c["medium"],"subgroups",json.dumps(subgroup_errors(rows)),flush=True)
        for label, cohort in [("all",rows),("before_2022",[r for r in rows if r["at"]<"2022"]),
                              ("2022–23",[r for r in rows if "2022"<=r["at"]<"2024"]),
                              ("2024_onward",[r for r in rows if r["at"]>="2024"])]:
            if cohort:
                print(c["medium"],label,json.dumps(summarize(cohort)),flush=True)
        all_rows.extend(rows)
    if len(sys.argv)>3:
        with os.fdopen(os.open(sys.argv[3],os.O_WRONLY|os.O_EXCL|os.O_CREAT,0o600),"w") as f:
            json.dump(all_rows,f)
