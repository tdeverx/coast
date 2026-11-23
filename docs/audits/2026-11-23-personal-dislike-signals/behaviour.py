"""Personal engagement contrast. Inputs and outputs are described in behaviour.md."""
import hashlib
import json
import math
import os
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime

DAY = 86400
FOREVER = math.inf


def read(path):
    with open(path) as stream:
        return json.load(stream)


def file_digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def stamp(s):
    if len(s) == 10:
        s += 'T00:00:00+00:00'
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()


def hashnum(s):
    return int.from_bytes(hashlib.sha256(s.encode()).digest()[:4], 'big')


def family_map(ids, relationships):
    parent = {}

    def root(i):
        while i in parent:
            i = parent[i]
        return i
    for i, j in relationships:
        a, b = sorted((root(i), root(j)))
        if a != b:
            parent[b] = a
    return {i: root(i) for i in ids}


def utility(stars):
    return max(0,20*(stars-.5)) if stars<=3 else 50+30*min(1,stars-3)+20*max(0,stars-4)


class History:
    def __init__(self, medium, capture, inputs, credits):
        self.medium = medium
        self.asof = capture['asOf']/1000
        rows = {r['work']['id']:r for r in capture['history']}
        self.ids = set(rows)
        rel = [(i, 'collection:'+j) for i,r in rows.items() for j in r.get('collections', [])]
        rel += [(i,'feature:'+j['id']) for i,r in rows.items() for j in r['features'].get('franchises',[])]
        self.fold_family=family_map(self.ids,rel)
        self.movie_release={}
        self.family_releases=defaultdict(dict)
        if medium=='movie':
            for film in inputs['films']:
                rel.append((film['work'],'m:'+film['family']))
                self.movie_release[film['work']]=stamp(film['release'])
        self.family=family_map(self.ids|set(self.movie_release),rel)
        for i,release in self.movie_release.items():
            self.family_releases[self.family[i]][i]=release
        self.show_release=defaultdict(dict)
        for e in inputs['census']:
            self.show_release[e['root']][e['season'],e['episode']]=stamp(e['release'])
        self.events=defaultdict(list)
        for e in inputs['watches']:
            if e['root'] not in rows or e['kind'] != ('movie' if medium=='movie' else 'episode'):
                continue
            if medium=='show' and (e['special'] or not e['season_number'] or e['season_number']<1):
                continue
            t=stamp(e['at'])
            release=stamp(e['release']) if e['release'] else None
            grid=(e['source'] in ('trakt','jellyfin') and release is not None and
                  -.5 <= (t-release)/DAY < 2 and e['at'][14:19] in ('00:00','30:00'))
            # A watch dated significantly before release is unsuitable evidence of a choice.
            ok=not grid and (release is None or release<=t+DAY)
            self.events[e['root']].append((t,e['media_id'],e['episode_number'],ok))
        self.features={}
        for i,r in rows.items():
            f=r['features']
            people={p['id'] for k in ('directors','writers') for p in f.get(k,[])}
            people.update('tmdb:'+str(c['id']) for c in credits.get(i,[]) if c['role']=='Creator')
            self.features[i]=({t['id'] for t in f.get('genres',[])},{t['id'] for t in f.get('tags',[])},people)
        self.similar={}

    def order(self, target):
        if target not in self.similar:
            rank=[]
            for i,terms in self.features.items():
                if self.family[i]==self.family[target]:
                    continue
                parts=[len(x & y)/len(x | y) for x,y in zip(terms,self.features[target]) if x and y]
                if parts and (s:=sum(parts)/len(parts))>0:
                    rank.append((-s,i,self.family[i]))
            self.similar[target]=sorted(rank)
        return self.similar[target]


class Anchors:
    def __init__(self,h,eligible):
        clocks=defaultdict(set)
        for i in eligible:
            for t,m,_,_ in h.events[i]:
                clocks[t].add(m)
        valid={}
        active=defaultdict(set)
        for i in eligible:
            rows=sorted({(t,m,n or 0) for t,m,n,ok in h.events[i] if ok and len(clocks[t])<3})
            if rows:
                valid[i]=rows
                for t,_,_ in rows:
                    active[int(t//DAY)].add(h.family[i])
        self.intervals=[]
        def other_activity(fid,first):
            # Exclude the start and final boundary day instead of counting a partial day.
            days=[active.get(d,set())-{fid} for d in range(int(first//DAY)+1,int(first//DAY)+90)]
            return sum(bool(d) for d in days)>=3 and len(set().union(*days))>=2
        if h.medium=='show':
            for i,rows in valid.items():
                first=rows[0][0]
                if not any(n in (1,2) for t,_,n in rows if int(t//DAY)==int(first//DAY)):
                    continue
                if sum(t<=first for t in h.show_release[i].values())<8:
                    continue
                end=first+90*DAY
                seen=[(t,m) for t,m,n in rows if t<=end]
                if len(set(m for t,m in seen))>=6 and len({int(t//DAY) for t,m in seen})>=3:
                    self.intervals.append((i,1,end,FOREVER))
                elif other_activity(h.family[i], first):
                    by_episode={}
                    for t,m,_,_ in h.events[i]:
                        by_episode[m]=min(t,by_episode.get(m,FOREVER))
                    third=sorted(by_episode.values())[2:3]
                    expires=third[0] if third else FOREVER
                    if expires>end:
                        self.intervals.append((i,0,end,expires))
        else:
            families=defaultdict(list)
            for i in eligible:
                if h.events[i]:
                    families[h.family[i]].append((min(row[0] for row in h.events[i]),i))
            for fid,observed in families.items():
                first,i=min(observed)
                if (i not in valid or valid[i][0][0]!=first or i not in h.movie_release or
                    not any(h.movie_release[i]<release<=first for release in h.family_releases[fid].values())):
                    continue
                end=first+90*DAY
                if any(h.movie_release.get(j,0)>h.movie_release[i] and j in valid and
                       any(int(t//DAY)>int(first//DAY) and t<=end for t,_,_ in valid[j]) for _,j in observed):
                    self.intervals.append((i,1,end,FOREVER))
                else:
                    expires=min((t for t,j in observed if j!=i),default=FOREVER)
                    if expires>end and other_activity(fid,first):
                        self.intervals.append((i,0,end,expires))

    def classes(self,asof):
        return {i:c for i,c,start,stop in self.intervals if start<asof<=stop}

    def risk(self,rank,asof):
        classes=self.classes(asof)
        if sum(classes.values())<2 or len(classes)-sum(classes.values())<2:
            return None
        scores=[[],[]]
        seen=set()
        for negative,i,fid in rank:
            cls=classes.get(i)
            if cls is None or len(scores[cls])==2 or fid in seen:
                continue
            scores[cls].append(-negative);seen.add(fid)
            if all(len(s)==2 for s in scores):
                return (sum(scores[0])-sum(scores[1]))/2
        return None


def fit(rows):
    if len(rows)<16:
        return None
    xs,ys=zip(*rows)
    x,y=statistics.mean(xs),statistics.mean(ys)
    variance=sum((v-x)**2 for v in xs)
    if variance<1e-12:
        return None
    slope=sum((v-x)*(w-y) for v,w in rows)/variance
    error=math.sqrt(sum((w-y-slope*(v-x))**2 for v,w in rows)/((len(rows)-2)*variance))
    return x,min(0,slope+error)


def order(points,strict):
    wins=pairs=0
    for rows in points.values():
        for s,x,y in rows:
            if s<4:continue
            for t,a,b in rows:
                if t>2.5:continue
                u,v=(y,b) if strict else (x,a)
                pairs+=1;wins+=(u>v)+.5*(u==v)
    return (round(100*wins/pairs,3) if pairs else None,pairs)


def run(capture,inputs,dates,graded,inner,metadata,sink):
    old={(r['medium'],r['split'],r['budget'],r['group']):r['points'] for r in inner}
    titles={r['id']:r['title'] for r in metadata}
    credits={r['id']:r['credits'] or [] for r in metadata}
    results=[]
    for data in capture:
        medium=data['medium']
        h=History(medium,data,inputs,credits)
        verified={r['id']:r for r in dates if r['medium']==medium}
        dates_s={i:stamp(r['at'][:10]) for i,r in verified.items()}
        folds={i:hashnum('personal-behaviour:'+h.family[i])%3 for i in h.ids}
        snapshot=Anchors(h,h.ids).classes(h.asof)
        # Describe the signal on familiar titles, never use these labels as held predictors.
        anchor_diagnostics=defaultdict(Counter)
        for i,c in snapshot.items():
            hist=anchor_diagnostics['returned' if c else 'movedOn']
            hist['all']+=1
            if i in verified:
                stars=verified[i]['stars']
                hist['rated']+=1;hist['disliked']+=stars<=2.5;hist['liked']+=stars>=4;hist['five']+=stars==5
        # Cache only the scalar, honest risk predictions. Free fold event pools after use.
        risk_cache={}
        for p in [r for r in graded['runs'] if r['medium']==medium]:
            split,budget=p['split'],p['budget']
            groups=defaultdict(list)
            for target in p['targets']:groups[target['group']].append(target)
            counts=Counter();stats=defaultdict(list);deltas=defaultdict(list)
            for group,targets in groups.items():
                known=old[(medium,split,budget,group)]
                assert not set(t['id'] for t in targets) & {r['id'] for r in known}
                if (split,group) not in risk_cache:
                    target_ids={t['id'] for t in targets}
                    if split=='rolling-day':
                        allowed=h.ids-target_ids; now=stamp(group)
                    else:
                        now=h.asof
                        keys={'work':lambda i:i,'franchise':lambda i:h.fold_family[i],
                              'reassigned-franchise':lambda i:'coast-ordinal-eval-v1:'+h.fold_family[i]}
                        assign=lambda i:str((hashnum(keys[split](i))>>24)%5)
                        assert all(assign(i)==group for i in target_ids)
                        allowed={i for i in h.ids if assign(i)!=group}
                    heldfamilies={h.family[i] for i in target_ids}
                    allowed={i for i in allowed if h.family[i] not in heldfamilies}
                    full=Anchors(h,allowed)
                    actual={i:full.risk(h.order(i),now) for i in target_ids}
                    risks={}
                    for f in range(3):
                        pool=Anchors(h,{i for i in allowed if folds[i]!=f})
                        for i in verified:
                            if folds[i]!=f or i not in allowed:continue
                            if split=='rolling-day' and dates_s[i]>=now:continue
                            risks[i]=pool.risk(h.order(i),dates_s[i] if split=='rolling-day' else now)
                    risk_cache[split,group]=(risks,actual)
                risks,actual=risk_cache[split,group]
                pairs=[(risks[r['id']],utility(verified[r['id']]['stars'])-r['base']) for r in known if risks.get(r['id']) is not None]
                params=fit(pairs)
                counts['folds']+=1
                counts['learnedNegativeSlope']+=bool(params and params[1]<0)
                for t in targets:
                    i=t['id'];base=t['scores']['calibrated']
                    if base is None:
                        counts['abstainedBaseline']+=1;continue
                    risk=actual[i];stars=t['stars']
                    valid=params and risk is not None
                    new=base if not valid else min(100,max(0,math.floor(.5+base+params[1]*(risk-params[0]))))
                    counts['scored']+=1;counts['riskAvailable']+=risk is not None;counts['changed']+=base!=new
                    counts['disliked']+=stars<=2.5;counts['dislikedRed']+=stars<=2.5 and new<50
                    counts['likedNewRed']+=stars>=4 and new<50<=base;counts['middleNewRed']+=2.5<stars<4 and new<50<=base
                    counts['fiveLower']+=stars==5 and new<base;counts['fiveLostGreen']+=stars==5 and new<80<=base
                    counts['fiveGainedGreen']+=stars==5 and base<80<=new
                    stats[group].append((stars,base,new))
                    if stars<=2.5:deltas['disliked'].append(new-base)
                    if stars==5:deltas['five'].append(new-base)
                    if budget=='all' or split=='rolling-day':
                        sink.append(dict(medium=medium,split=split,group=group,id=i,title=titles[i],stars=stars,
                                         risk=risk,base=base,new=new))
            results.append(dict(medium=medium,split=split,budget=budget,counts=counts,
                meanDelta={k:round(statistics.mean(v),3) for k,v in deltas.items()},
                dislikeLikedPairOrder=[order(stats,a) for a in (False,True)],anchorDiagnostics=anchor_diagnostics))
    return results


if __name__=='__main__':
    if len(sys.argv)!=7:raise SystemExit('Pass capture, private event evidence, verified dates, graded replay, inner baseline predictions and metadata.')
    expected=read(sys.argv[4])['manifest']
    for index,key in ((1,'capture'),(3,'dates'),(6,'metadata')):
        if file_digest(sys.argv[index])!=expected[key]:
            raise SystemExit('Input does not match the original graded replay: '+key)
    ledger=[]
    rows=run(*(read(p) for p in sys.argv[1:]),ledger)
    if path:=os.environ.get('COAST_BEHAVIOUR_PRIVATE'):
        with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:json.dump(ledger,f)
    print(json.dumps(rows,indent=2))
