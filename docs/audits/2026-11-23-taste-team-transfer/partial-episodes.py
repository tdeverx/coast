"""Use replicated episode writing credits for show-to-show transfer."""
import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from statistics import mean

import partial


def replay(capture, metadata, dates, archive, inner, episodes):
    read_date = lambda x: datetime.fromtimestamp(x / 1000, timezone.utc).date()
    data = next(d for d in capture if d['medium']=='show')
    cutoff = (read_date(data['asOf']) + timedelta(days=1)).isoformat()
    assert len({e['media_id'] for e in episodes}) == len(episodes)
    panels = [p for p in archive['runs'] if p['medium']=='show']
    whole = next(p for p in panels if p['split']=='work' and p['budget']=='all')
    canonical = {t['id']:t for t in whole['targets']}
    dated = {r['id']:r for r in dates if r['medium']=='show'}
    native = {(r['split'],r['budget'],r['group']): {v['id']:v['base'] for v in r['points']}
              for r in inner if r['medium']=='show'}
    genres = {r['work']['id']: {g['id'] for g in r['features'].get('genres',[])} for r in data['history']}
    ids = {m['id']:m for m in metadata}
    facts = partial.index_works(ids, genres, canonical, 'show')
    grouped_episodes = defaultdict(list)
    for e in episodes:
        assert e['show_id'] in canonical
        if e['aired']:
            grouped_episodes[e['show_id']].append((e['aired'], e['writers']))

    @lru_cache(maxsize=None)
    def staff(day, strict, proportion):
        teams = {}
        for work in canonical:
            credited = Counter()
            aired = 0
            for release, writers in grouped_episodes[work]:
                if release < day:
                    aired += 1
                    credited.update(person for person, observed in writers.items() if not strict or observed < day)
            teams[work] = frozenset(person for person, total in credited.items()
                                    if total >= 3 and (not proportion or total*10 >= aired))
        return teams

    reports, changes = [], []
    for panel in panels:
        split, budget = panel['split'], panel['budget']
        groups = defaultdict(list)
        for t in panel['targets']:
            groups[t['group']].append(t)
        modes = [(False,True), (False,False)]
        if split=='rolling-day':
            modes.append((True,True))
        for strict, proportion in modes:
            c = Counter()
            for group, targets in groups.items():
                day = group if split=='rolling-day' else cutoff
                known = partial.exact.allowed_ratings(canonical, dated, targets, group, split, budget)
                prior = native[split,budget,group]
                assert prior.keys() <= known.keys() and not (known.keys() & {t['id'] for t in targets})
                if split=='rolling-day':
                    assert all(dated[j]['at'][:10] < day for j in known)
                writers = staff(day, strict, proportion)
                by_writer = defaultdict(set)
                for j in known:
                    for person in writers[j]:
                        by_writer[person].add(j)
                for t in targets:
                    work, base, stars = t['id'], t['scores']['calibrated'], t['stars']
                    if base is None:
                        continue
                    authors, _, fam, target_genres = facts[work]
                    donors, possible = set(), set()
                    for w in writers[work]:
                        colleagues = [j for j in by_writer[w] if facts[j][2] != fam]
                        compatible = {j for j in colleagues if authors and facts[j][0] and authors.isdisjoint(facts[j][0])
                                      and partial.overlap_half(target_genres, facts[j][3])}
                        possible.update(compatible)
                        if all(known[j] <= 2.5 for j in colleagues):
                            donors.update(j for j in compatible if j in prior)
                    by_family = defaultdict(list)
                    for j in sorted(donors):
                        by_family[facts[j][2]].append(partial.lineage.utility(known[j])-prior[j])
                    score = base
                    if by_family:
                        score = partial.lineage.display(base + min(0.,mean(mean(v) for v in by_family.values())))
                    c.update(dict(scored=1,dislikes=stars<=2.5,withStaff=bool(writers[work]),
                                  dislikesWithStaff=bool(writers[work]) and stars<=2.5,
                                  opportunity=bool(possible),dislikeOpportunity=bool(possible) and stars<=2.5,
                                  admissibleDonor=bool(donors),changes=score!=base,
                                  recovered=stars<=2.5 and score<50<=base,
                                  newRedMiddle=2.5<stars<4 and score<50<=base,
                                  newRedLiked=stars>=4 and score<50<=base,
                                  loweredLiked=stars>=4 and score<base,
                                  fiveLower=stars==5 and score<base,
                                  fiveLostGreen=stars==5 and score<80<=base,
                                  twoFamilyChanges=len(by_family)>=2 and score!=base))
                    if possible:
                        changes.append(dict(split=split,budget=budget,strict=strict,proportion=proportion,
                                            id=work, base=base,score=score,stars=stars,
                                            possible=sorted(possible),donors=sorted(donors)))
            reports.append(dict(split=split,budget=budget,strict=strict,proportion=proportion,counts=c))
    return reports,changes


if __name__=='__main__':
    if len(sys.argv)!=7:
        raise SystemExit('Usage: partial-episodes.py CAPTURE METADATA DATES GRADED INNER EPISODE_WRITERS')
    capture, meta, dates, graded, inner, episodes = (partial.lineage.read(p) for p in sys.argv[1:])
    for name,p in zip(('capture','metadata','dates'),sys.argv[1:4]):
        assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==graded['manifest'][name]
    results, individual = replay(capture,meta,dates,graded,inner,episodes)
    if path := os.environ.get('COAST_EPISODE_TEAM_PRIVATE'):
        with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:
            json.dump(individual,f)
    print(json.dumps(results,separators=(',',':')))
