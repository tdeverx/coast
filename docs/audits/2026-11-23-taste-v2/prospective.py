"""Evaluate forecasts sealed by replay.ts before separately verified feedback arrives."""
import argparse
import datetime as dt
import hashlib
import json
from collections import defaultdict
from math import isfinite

def instant(text):
    try:
        stamp=dt.datetime.fromisoformat(text.replace("Z","+00:00"))
        return stamp.astimezone(dt.timezone.utc) if stamp.tzinfo else None
    except (AttributeError,ValueError):
        return None

parser=argparse.ArgumentParser()
parser.add_argument("ledger")
parser.add_argument("ratings",help="private canonical IDs, media, stars and original verified UTC rating times")
args=parser.parse_args()
with open(args.ledger) as f:ledger=json.load(f)
with open(args.ratings) as f:ratings=json.load(f)
sealed=instant(ledger.get('sealed'))
if ledger.get('version')!=2 or not sealed or not ledger.get('manifest'):
    raise ValueError('Invalid paired prospective ledger')
entries={r['key']:r for r in ledger['entries']}
if len(entries)!=len(ledger['entries']):raise ValueError('Duplicate prospective target')
feedback=defaultdict(set)
for r in ratings:
    if r.get('medium') not in ('movie','show') or not r.get('id'):continue
    t=instant(r.get('at')); stars=r.get('stars')
    if not t or not isinstance(stars,(int,float)) or not isfinite(stars) or not .5<=stars<=5:continue
    k=hashlib.sha256('/'.join([ledger['salt'],r['medium'],r['id']]).encode()).hexdigest()
    if k in entries:feedback[k].add((t,stars))
for medium in ('movie','show'):
    labels=[]
    for k,pred in entries.items():
        events=feedback[k]
        if pred['medium']!=medium or not events or any(t<=sealed for t,s in events):continue
        earliest=min(t for t,s in events)
        at_first={s for t,s in events if t==earliest}
        if len(at_first)==1:labels.append((at_first.pop(),pred))
    paired=[(s,r) for s,r in labels if r['v1'] is not None and r['v2'] is not None]
    report={'medium':medium,'eligibleFeedback':len(labels),'common':len(paired)}
    for name in ('v1','v2'):
        wins=pairs=0
        for s,r in paired:
            for t,p in paired:
                if s<=t:continue
                pairs+=1;wins+=(r[name]>p[name])+.5*(r[name]==p[name])
        greens=[s for s,r in paired if r[name]>=80]
        disliked=[r[name] for s,r in paired if s<=2.5]
        liked=[r[name] for s,r in paired if s>=4]
        report[name]={'coverage':sum(r[name] is not None for s,r in labels),'allStarPairs':pairs,
          'concordance':round(wins/pairs,4) if pairs else None,'green':len(greens),
          'greenFives':sum(s==5 for s in greens),'greenWeak':sum(s<=3 for s in greens),
          'disliked':len(disliked),'dislikedBelowNeutral':sum(score<50 for score in disliked),
          'dislikedGreen':sum(score>=80 for score in disliked),
          'liked':len(liked),'likedBelowNeutral':sum(score<50 for score in liked)}
    print(json.dumps(report))
