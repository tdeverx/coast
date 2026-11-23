"""Test bounded duration preferences within the target's own genre context."""
from argparse import ArgumentParser
from collections import defaultdict
from math import log, sqrt
from pathlib import Path
from statistics import mean, variance

from matched_traits import estimates
from retained_panels import retained_panels
from soft_calibration import family_days, inputs
from story_credit_corroboration import descriptors
from team_audience import display, read, utility, write_new


def shrink(delta, error, n):
    value=max(0,abs(delta)-error)*n/(n+6)
    return (1 if delta>0 else -1)*min(4,value)


def shifts(target, points):
    if len(points)<8:
        return 0,0
    n=len(points)
    mx=mean(x for x,_ in points)
    my=mean(y for _,y in points)
    ss=sum((x-mx)**2 for x,_ in points)
    linear=0
    if ss>0:
        slope=sum((x-mx)*(y-my) for x,y in points)/ss
        residual=sum((y-my-slope*(x-mx))**2 for x,y in points)/(n-2)
        linear=shrink(slope*(target-mx),sqrt(residual/ss)*abs(target-mx),n)
    near=[y for x,y in points if abs(x-target)<=log(1.25)]
    far=[y for x,y in points if abs(x-target)>=log(1.5)]
    grouped=0
    if min(len(near),len(far))>=4:
        weights=1/len(near)+1/len(far)
        grouped=shrink(mean(near)-mean(far),sqrt(variance(near)/len(near)+variance(far)/len(far)),2/weights)
    return linear,grouped


def compare(row, durations, family, direct, genres, predictions):
    cohorts=defaultdict(list)
    best={}
    target=durations.get(row.id)
    if not target:
        return (0,0),(0,0)
    for j,entry in direct.items():
        if j not in durations or not row.eligible(j):
            continue
        g=genres[j]
        intersection=len(g & genres[row.id])
        union=len(g)+len(genres[row.id])-intersection
        if not union or 2*intersection<union:
            continue
        score=intersection/union
        f=family[j]
        if score<best.get(f,0):
            continue
        if score>best.get(f,0):
            cohorts[f]=[]
            best[f]=score
        cohorts[f].append(j)
    raw=[]
    errors=[]
    for cohort in cohorts.values():
        length=mean(durations[j] for j in cohort)
        raw.append((length,mean(utility(direct[j]['stars']) for j in cohort)))
        if all(j in predictions for j in cohort):
            errors.append((length,mean(utility(direct[j]['stars'])-predictions[j] for j in cohort)))
    return shifts(target,raw),shifts(target,errors)


def run(args):
    direct,panels=retained_panels(args)
    baseline=read(args.selected)
    durations={r['id']:log(float(r['minutes'])) for r in read(args.durations) if r['minutes'] and float(r['minutes'])>0}
    _,genres,_,_=descriptors(read(args.capture),read(args.metadata),set(direct))
    tiers,inner,_=inputs(args,direct)
    first=family_days(read(args.dates),tiers)
    family={r.id:r.family for r in panels['full']}
    output={}
    for split,rows in panels.items():
        scores={r['id']:r['selected'] for r in baseline[split]['cases']}
        result=[]
        for r in rows:
            base=scores[r.id]
            cases=dict(id=r.id,stars=r.stars,medium=r.medium,genres=sorted(genres[r.id]),baseline=base)
            raw,errors=(0,0),(0,0)
            if r.native==base and base>=50:
                predictions=estimates(r,tiers,inner,panels['earlier'],first)
                raw,errors=compare(r,durations,family,direct,genres,predictions)
            for index,kind in enumerate(('slope','window')):
                ordinary,residual=raw[index],errors[index]
                agreement=min(abs(ordinary),abs(residual))*(1 if ordinary>0 else -1) if ordinary*residual>0 else 0
                for suff,value in (('',ordinary),('Error',residual),('Agree',agreement)):
                    cases[kind+suff]=display(base+value)
            result.append(cases)
        output[split]=result
    write_new(args.output,output)


if __name__=='__main__':
    parser=ArgumentParser(description=__doc__)
    for name in ('graded','direct','team','movie','show','archived','earlier','grouped','witness','selected','capture','metadata','output'):
        parser.add_argument(name,type=Path)
    for name in ('inner','dates','durations'):
        parser.add_argument('--'+name,required=True,type=Path)
    parser.set_defaults(raw=())
    run(parser.parse_args())
