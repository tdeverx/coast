"""Apply training-only green thresholds and, separately, test a three-star anchor."""
import json
import math
import os
import statistics
import sys

with open(sys.argv[1]) as f: data=json.load(f)
calibration={(r['medium'],r['split'],r['group']):r['train'] for r in data['scales']}

def interpolation(x, points):
    for (a,b),(c,d) in zip(points,points[1:]):
        if x<=c:return b+(x-a)*(d-b)/(c-a)
    return 100

def fit(train):
    five=[r for r in train if r['stars']==5];weak=[r for r in train if r['stars']<=3]
    neutral=[r['raw'] for r in train if r['stars']==3]
    if len(five)<8 or len(weak)<8: return 80,50,False
    # Prefer the largest cutoff retaining incumbent green favourite recall. Ties
    # with identical recall select the threshold making fewer weak titles green.
    target_fives=sum(r['v1']>=80 for r in five)
    target_weak=sum(r['v1']>=80 for r in weak)
    choices=[]
    for green in range(70,91):
        nf=sum(r['raw']>=green for r in five)
        nw=sum(r['raw']>=green for r in weak)
        # Compare error rates on the two predeclared classes at their original rates.
        harm=max(0,(target_fives-nf)/len(five),(nw-target_weak)/len(weak))
        gain=(nf-target_fives)/len(five) + (target_weak-nw)/len(weak)
        choices.append((harm,-gain,abs(green-80),green))
    green=min(choices)[-1]
    # A sparse cohort cannot establish where an actual three-star title falls.
    # Shrink the optional three-star anchor toward the nominal prior; the green
    # threshold is a separate operating point.
    threshold=50
    if len(neutral)>=8:
        n=len(neutral)
        threshold=min(green-3,max(45,50+(statistics.median(neutral)-50)*n/(n+15)))
    return green,threshold,True

params={}
for run in data['runs']:
    for r in run['targets']:
        key=run['medium'],run['split'],r['group']
        if key not in params:params[key]=fit(calibration[key])
        green,mid,available=params[key];x=r['scores']['balanced']
        for name,neutral in [('learnedGreen',50),('threeStarAnchor',mid)]:
            y=None if x is None else math.floor(.5+interpolation(x,[(0,0),(neutral,50),(green,80),(100,100)]))
            r['scores'][name]=y
data.pop('scales')
with open(sys.argv[2],'x',opener=lambda p,flags: os.open(p,flags,0o600)) as f:
    json.dump(data,f,separators=(',',':'))
for m in ['movie','show']:
    for split in ['work','franchise','reassigned-franchise','rolling-day']:
        group=[v for (medium,kind,k),v in params.items() if medium==m and kind==split]
        if group:print(m,split,'fitted',sum(v[2] for v in group),'of',len(group),'green thresholds',sorted({v[0] for v in group}),'three-star anchors',[round(min(v[1] for v in group),1),round(max(v[1] for v in group),1)])
