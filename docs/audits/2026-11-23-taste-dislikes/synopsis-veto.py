"""Out-of-sample follow-up. Corroborate each previously proposed red with the title synopsis.

The frozen, general-purpose text encoder saw no personal ratings. Admit a proposed
reduction only when an independently disliked work is closer in synopsis than the
nearest independently liked work. Use cosine similarity and defer on ties, missing
descriptions, fewer than two disliked training families, or no qualifying liked title.
The rule and inputs are the same for both existing contrast arms.
"""
import hashlib
import importlib.util
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np


def read(path):
    return json.loads(Path(path).read_text())


def evaluate(capture, dates, replay, proposals, embeddings):
    base=Path(__file__).resolve().parents[1]/"2026-11-23-taste-v2-counterevidence"/"replay.py"
    spec=importlib.util.spec_from_file_location("comparison",base)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    keys={str(key):i for i,key in enumerate(embeddings["ids"])}
    matrix=embeddings["emb"]
    matrix=matrix/np.maximum(np.linalg.norm(matrix,axis=1,keepdims=True),1e-12)
    proposed={(e["medium"],e["split"],e["budget"],e["group"],e["id"],e["arm"]):e for e in proposals}
    results=[]
    for data in capture:
        medium=data["medium"]
        labels={r["id"]:r for r in dates if r["medium"]==medium}
        rated={r["work"]["id"] for r in data["history"] if r["work"]["rating"] is not None}
        families=module.family_keys(data["history"])
        for run in replay["runs"]:
            if run["medium"]!=medium:
                continue
            split,budget=run["split"],run["budget"]
            folds=defaultdict(list)
            for target in run["targets"]:
                folds[target["group"]].append(target)
            for arm in sorted({e["arm"] for e in proposals}):
                counts=Counter()
                groups=defaultdict(list)
                for group,held in folds.items():
                    if split=="rolling-day":
                        train={i for i,r in labels.items() if r["at"][:10]<group}
                    else:
                        train=rated-{r["id"] for r in held}
                        if budget!="all":
                            limit,_,seed=budget.partition("#")
                            train=sorted(train,key=lambda i:hashlib.sha256(("solo:"+(seed or "1")+":"+i).encode()).hexdigest())[:int(limit)]
                    for t in held:
                        i=t["id"]
                        before=t["scores"]["calibrated"]
                        if before is None:
                            continue
                        after=before
                        event=proposed.get((medium,split,budget,group,i,arm))
                        if event:
                            assert event["before"]==before
                            counts["proposed"]+=1
                            available=[j for j in train if j in keys and j in labels and families[j]!=families[i]]
                            positive=[j for j in available if labels[j]["stars"]>=4]
                            negative=[j for j in available if labels[j]["stars"]<=2.5]
                            if i in keys and positive and len({families[j] for j in negative})>=2:
                                def closest(ids):
                                    return float((matrix[[keys[j] for j in ids]]@matrix[keys[i]]).max())
                                if closest(negative)>closest(positive):
                                    after=event["after"]
                        groups[group].append((t["stars"],before,after))
                        if before!=after:
                            counts["admitted"]+=1
                            counts["fiveScoresLowered"]+=t["stars"]==5
                            counts["fourAndHalfOrHigherLowered"]+=t["stars"]>=4.5
                before,old_order=module.metrics(groups,0)
                after,new_order=module.metrics(groups,1)
                results.append(dict(medium=medium,split=split,budget=budget,arm=arm,counts=dict(counts),
                                    before=before,after=after,rankingBefore=old_order,rankingAfter=new_order))
    return results


if __name__=="__main__":
    if len(sys.argv)!=6:
        raise SystemExit("Usage: synopsis-veto.py CAPTURE VERIFIED_DATES GRADED_REPLAY PRIVATE_PROPOSALS FROZEN_SYNOPSIS_EMBEDDINGS")
    print(json.dumps(evaluate(*map(read,sys.argv[1:5]),np.load(sys.argv[5])),separators=(",",":")))
