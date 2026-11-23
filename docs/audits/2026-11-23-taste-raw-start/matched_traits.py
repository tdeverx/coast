"""Test whether a specific trait distinguishes otherwise similar titles for this viewer."""
from argparse import ArgumentParser
from collections import Counter, defaultdict
from itertools import groupby
from pathlib import Path
from statistics import median

from retained_panels import GROUPED, retained_panels
from soft_calibration import family_days, inputs
from story_credit_corroboration import descriptors, postings
from team_audience import display, read, utility, write_new


def similarities(keys, genres, tags):
    pairs = {}
    nearest = {}
    for i in keys:
        g, t = genres[i], tags[i]
        values = {}
        for j in keys:
            intersection = len(g & genres[j])
            union = len(g) + len(genres[j]) - intersection
            if i == j or not union or 2 * intersection < union:
                continue
            gi = intersection / union
            tag_intersection = len(t & tags[j])
            tag_union = len(t) + len(tags[j]) - tag_intersection
            values[j] = 2*gi + (tag_intersection/tag_union if tag_union else 0)
        pairs[i] = values
        nearest[i] = [list(group) for _,group in groupby(sorted(values, key=values.get, reverse=True), key=values.get)]
    return pairs, nearest


def strongest(clues):
    if not clues:
        return None
    strength = max(abs(c[0]) for c in clues)
    top = [c for c in clues if abs(c[0]) == strength]
    if any(c[0] != top[0][0] for c in top):
        return None
    return top[0][0], set.union(*(families for _,families in top))


def clue(row, carriers, allowed, score, direct, family, distances, nearest, predictions):
    similar = distances[row.id]
    exposed = carriers & allowed & similar.keys()
    by_family = defaultdict(list)
    for j in exposed:
        by_family[family[j]].append(j)
    if len(by_family) < 3:
        return None,None
    carrier_families = {family[j] for j in carriers & allowed}
    treated = []
    for group in by_family.values():
        high = max(similar[j] for j in group)
        closest = [j for j in group if similar[j] == high]
        if len(closest) == 1:
            treated.append(closest[0])
    pairs = []
    for j in treated:
        for level in nearest[j]:
            peers = [k for k in level if k in allowed and k in similar and family[k] not in carrier_families]
            if peers:
                if len(peers) == 1:
                    pairs.append((j,peers[0]))
                break
    controls = Counter(family[k] for _, k in pairs)
    pairs = [(j,k) for j,k in pairs if controls[family[k]] == 1]
    ordinary = [(j,k,utility(direct[j]['stars']),utility(direct[k]['stars'])) for j,k in pairs]
    residual = [(j,k,left-predictions[j],right-predictions[k]) for j,k,left,right in ordinary
                if j in predictions and k in predictions]
    return direction_of(ordinary, False, score, direct, family),direction_of(residual, True, score, direct, family)


def direction_of(pairs, use_errors, score, direct, family):
    n = len(pairs)
    if n < 3:
        return None
    differences = [left-right for _,_,left,right in pairs]
    positives = sum(x>0 for x in differences)
    negatives = sum(x<0 for x in differences)
    agree = max(positives,negatives)/n
    if agree < .75:
        return None
    outcomes = [direct[j]['stars'] for j,_,_,_ in pairs]
    direction = 1 if positives > negatives else -1
    if direction == 1 and median(outcomes)<4 or direction == -1 and median(outcomes)>3.5:
        return None
    limit = max(0, direction*(median(map(utility,outcomes))-score))
    if use_errors:
        errors = [direction*left for _,_,left,_ in pairs]
        if sum(e>0 for e in errors) < .75*n:
            return None
        limit = min(limit,median(errors))
    step = min(4,limit,abs(median(differences))*n/(n+6)*(2*agree-1))
    if step < .5:
        return None
    return direction * step, {family[i] for j,k,_,_ in pairs for i in (j,k)}


def estimates(row, tiers, inner, dated, first):
    if row.split == 'earlier':
        return {r.id:r.native for r in dated if row.eligible(r.id)
                and r.group <= min(first[row.medium,row.family], first[row.medium,r.family])}
    split = row.split if row.split in GROUPED else 'franchise'
    tier = tiers[row.medium,split]
    group = tier[row.id]['group']
    held = inner[row.medium,split,group]
    return {i:t['scores']['calibrated'] if t['group']==group else held[i]
            for i,t in tier.items() if row.eligible(i)}


def run(args):
    direct, panels = retained_panels(args)
    selected = read(args.selected)
    _,genres,tags,credits = descriptors(read(args.capture), read(args.metadata), set(direct))
    family = {r.id:r.family for r in panels['full']}
    tiers,inner,_ = inputs(args,direct)
    first = family_days(read(args.dates),tiers)
    maps = [(tags,postings(tags)),(credits,postings(credits))]
    comparisons = {medium:similarities([i for i in direct if direct[i]['medium']==medium], genres, tags)
                   for medium in ('movie','show')}
    out = {}
    for split, panel in panels.items():
        baseline = {x['id']:x['selected'] for x in selected[split]['cases']}
        results = []
        for row in panel:
            base = baseline[row.id]
            result = dict(id=row.id, medium=row.medium, stars=row.stars, baseline=base,
                          genres=sorted(genres[row.id]), keyword=base, credit=base, agreement=base, upside=base)
            for name in ('keywordError','creditError','agreementError','upsideCreditError'):
                result[name]=base
            if base < 50 or base != row.native:
                results.append(result)
                continue
            distances,nearest=comparisons[row.medium]
            allowed={j for j in distances if row.eligible(j)}
            votes=estimates(row,tiers,inner,panels['earlier'],first)
            by_field={False:[],True:[]}
            for name,(field,index) in zip(('keyword','credit'),maps,strict=True):
                rules=[clue(row,index[key],allowed,base,direct,family,distances,nearest,votes)
                       for key in sorted(field[row.id]) if len(index[key])>=4]
                for use_errors,fields in by_field.items():
                    c=[rule[use_errors] for rule in rules if rule[use_errors]]
                    best=strongest(c)
                    label=name+'Error' if use_errors else name
                    if best:result[label]=display(base+best[0])
                    fields.append(c)
            for use_errors,(left,right) in by_field.items():
                both=[((1 if dt>0 else -1)*min(abs(dt),abs(dc)),ft|fc)
                      for dt,ft in left for dc,fc in right if dt*dc>0 and ft.isdisjoint(fc)]
                agreement=strongest(both)
                if agreement:result['agreementError' if use_errors else 'agreement']=display(base+agreement[0])
            result['upside']=max(result['agreement'],base)
            result['upsideCreditError']=max(result['creditError'],base)
            results.append(result)
        out[split] = results
    write_new(args.output,out)


if __name__ == '__main__':
    parser=ArgumentParser(description=__doc__)
    for name in ('graded','direct','team','movie','show','archived','earlier','grouped','witness',
                 'selected','capture','metadata','output'):
        parser.add_argument(name,type=Path)
    parser.add_argument('--inner',type=Path,required=True)
    parser.add_argument('--dates',type=Path,required=True)
    parser.set_defaults(raw=())
    run(parser.parse_args())
