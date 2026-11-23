"""Can earlier out-of-fold predictions give the percentage a probability interpretation?

python3 card-calibration.py private-ordinal-inputs.json
Only tunes on the fold's training data. Outputs aggregate counts and calibration, no title history.
"""
import json
import math
import statistics
import sys


def logit(p):
    p = min(.995, max(.005, p))
    return math.log(p / (1-p))


def sigmoid(x):
    return 1 / (1 + math.exp(-max(-30, min(30, x))))


def calibrator(earlier):
    # Penalise departure from the original mapping. A positive slope preserves ordering.
    a, b = 0., 1.
    for _ in range(25):
        ga, gb, h11, h12, h22 = -2*a, -2*(b-1), 2., 0., 2.
        for r in earlier:
            x = logit(r["score"]/100)
            p = sigmoid(a+b*x)
            error = int(r["stars"] >= 4)-p
            w = p*(1-p)
            ga += error
            gb += error*x
            h11 += w
            h12 += w*x
            h22 += w*x*x
        det = h11*h22 - h12*h12
        a += (ga*h22-gb*h12)/det
        b = max(.01, b+(gb*h11-ga*h12)/det)
    return lambda r: sigmoid(a + b*logit(r["score"]/100))


def describe(rows, scorer):
    p = [scorer(r) for r in rows]
    y = [int(r["stars"]>=4) for r in rows]
    return {"n": len(rows), "mean": round(100*statistics.mean(p),1), "four_plus": sum(y),
            "brier": round(statistics.mean((s-t)**2 for s,t in zip(p,y)),4),
            "weak_green": sum(s>=.8 and r["stars"]<=3 for s,r in zip(p,rows)),
            "five_green": sum(s>=.8 and r["stars"]==5 for s,r in zip(p,rows))}


with open(sys.argv[1]) as source:
    folds = json.load(source)
for fold in folds:
    if fold["split"] != "rating date":
        continue
    train, held = ([r for r in fold[k] if r["score"] is not None] for k in ("train","test"))
    calibrated = calibrator(train)
    prior = (1+sum(r["stars"]>=4 for r in train))/(2+len(train))
    print(fold["medium"], fold["fold"], "earlier", len(train))
    for label, method in (("identity",lambda r:r["score"]/100), ("prior",lambda r:prior), ("calibrated",calibrated)):
        print(label, describe(held, method))
    for low,high in ((0,50),(50,70),(70,80),(80,90),(90,101)):
        band = [r for r in held if low<=r["score"]<high]
        if band:
            print("original", low, high, describe(band,lambda r:r["score"]/100))
