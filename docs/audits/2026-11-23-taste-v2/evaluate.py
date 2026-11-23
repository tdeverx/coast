"""Read an offline private replay. Report aggregate, paired metrics; no extra packages."""
import argparse
from collections import Counter, defaultdict
import json
import math
import random

parser = argparse.ArgumentParser()
parser.add_argument("replay")
parser.add_argument("--bootstrap", type=int, default=0, help="cluster-resample the final candidate on principal comparisons")
parser.add_argument("--sample", help="optional private verified title metadata to name individual errors")
parser.add_argument("--candidate",default="balanced",help="registered scoring arm to compare with v1")
args = parser.parse_args()
with open(args.replay) as f:
    replay = json.load(f)
names = {}
if args.sample:
    with open(args.sample) as f:
        names = {r['id']:r['title'] for r in json.load(f)}

def rate(wins, n):
    return round(100*wins/n, 2) if n else None

def filter_sorted(rows, name, common=None):
    groups = defaultdict(list)
    for r in rows:
        score = r['scores'].get(name)
        if score is not None and (common is None or r['id'] in common):
            groups[r['group']].append((score, min(20, round(4*r['stars'])),r['cluster']))
    return [sorted(g) for g in groups.values()]

def concordance(groups, weights=None):
    total = [0.0]*3
    denominator = [0]*3
    # Track ratings of lower-scored titles. Equal predictions receive half credit.
    for rows in groups:
        lower = [0]*21
        at = 0
        while at<len(rows):
            score = rows[at][0]
            same = [0]*21
            while at<len(rows) and rows[at][0]==score:
                _,s,c = rows[at]
                same[s] += 1 if weights is None else weights[c]
                at += 1
            all_lower = sum(lower)
            for s,n in enumerate(same):
                if not n:
                    continue
                total[0] += n*(sum(lower[:s]) + .5*sum(same[:s]))
                denominator[0] += n*(all_lower-lower[s]+sum(same[:s]))
                if s>=16:
                    total[1] += n*(sum(lower[:13])+.5*sum(same[:13]))
                    denominator[1] += n*(sum(lower[:13])+sum(same[:13]))
                elif s<=12:
                    denominator[1] += n*sum(lower[16:])
                if s==20:
                    total[2] += n*(lower[14]+.5*same[14])
                    denominator[2] += n*(lower[14]+same[14])
                elif s==14:
                    denominator[2] += n*lower[20]
            lower = [a+b for a,b in zip(lower,same)]
    return [rate(a,b) for a,b in zip(total,denominator)], denominator

def interval(x):
    if not x: return None
    x.sort()
    return [round(x[math.floor(.025*(len(x)-1))],2),round(x[math.ceil(.975*(len(x)-1))],2),len(x)]

def bootstrap(aa, bb, clusters, iterations):
    rng=random.Random(2141)
    deltas=[[],[],[]]
    for i in range(iterations):
        mult=Counter(rng.choices(clusters,k=len(clusters)))
        a,b=concordance(aa,mult)[0],concordance(bb,mult)[0]
        for j,(x,y) in enumerate(zip(a,b)):
            if x is not None and y is not None: deltas[j].append(y-x)
    return [interval(x) for x in deltas]

def top20(rows, name):
    scored=sorted((r for r in rows if r['scores'].get(name) is not None),key=lambda r:-r['scores'][name])
    if not scored:return None
    k=min(20,len(scored)); threshold=scored[k-1]['scores'][name]
    above=[r for r in scored if r['scores'][name]>threshold]
    tied=[r for r in scored if r['scores'][name]==threshold]
    return round(sum(r['stars']>=4 for r in above)+(k-len(above))*sum(r['stars']>=4 for r in tied)/len(tied),2)

for run in replay['runs']:
    medium,split,budget,rows=(run[k] for k in ['medium','split','budget','targets'])
    output={"medium":medium, "split":split,"budget":budget,"targets":len(rows),"models":{}}
    for name in rows[0]['scores']:
        scores=[r for r in rows if r['scores'].get(name) is not None]
        common={r['id'] for r in scores if r['scores']['v1'] is not None}
        aa=filter_sorted(rows,'v1',common)
        bb=filter_sorted(rows,name,common)
        a=concordance(aa)[0]; b,pairs=concordance(bb)
        result={'scored':len(scores),'common':len(common),'ratingPairs':pairs,'v1onCommon':a,'ranking':b,
          'greenWeak':sum(r['stars']<=3 and r['scores'][name]>=80 for r in scores),
          'greenFive':sum(r['stars']==5 and r['scores'][name]>=80 for r in scores),
          'greenAll':sum(r['scores'][name]>=80 for r in scores),
          'bands':dict(sorted(Counter(min(9,int(r['scores'][name]//10)) for r in scores).items()))}
        if name==args.candidate and args.bootstrap and budget in ('all','0','dated ratings only'):
            clusters=sorted({r['cluster'] for r in rows if r['id'] in common})
            result['clusterCount']=len(clusters)
            result['delta95']=bootstrap(aa,bb,clusters,args.bootstrap)
        if split=='rolling-day' and name in (args.candidate,'v1'):
            day_rates=[concordance([g])[0] for g in bb]
            result['equalDay']=[round(sum(xs)/len(xs),2) if xs else None
                for j in range(3) for xs in [[v[j] for v in day_rates if v[j] is not None]]]
        if split=='work' and budget in ('all','0') and name in (args.candidate,'v1'):
            def qualify(r,label):
                return label=='all' or any(label in g.lower() for g in r['genres'])
            cuts={}
            for g in ['all','animation','sci','drama','comedy','documentary','horror','action','romance']:
                section=[r for r in rows if qualify(r,g)]
                if section:cuts[g]={'n':len(section),'likedIn20':top20(section,name)}
            result['genres']=cuts
        output['models'][name]=result
    print(json.dumps(output,separators=(',',':')))
    if names and split=='work' and budget=='all':
        paired=[r for r in rows if all(r['scores'].get(m) is not None for m in (args.candidate,'v1'))]
        for name,kind,worst in [(args.candidate,'false high',sorted((r for r in paired if r['stars']<=2.5), key=lambda r:-r['scores'][args.candidate])),
            (args.candidate,'missed favourite',sorted((r for r in paired if r['stars']==5),key=lambda r:r['scores'][args.candidate])),
            (args.candidate,'largest difference', sorted(paired,key=lambda r:-abs(r['scores'][args.candidate]-r['scores']['v1'])))]:
            print(json.dumps({'medium':medium,'kind':kind,'cases':[[names.get(r['id'],'unlabelled'),r['stars'],r['scores']['v1'],r['scores'][name]] for r in worst[:5]]}))
