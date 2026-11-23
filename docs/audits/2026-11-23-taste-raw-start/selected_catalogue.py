"""Publish the selected research policy for titles in one owner's dev catalogue.

The publisher consumes local metadata, a separately fitted calibrated personal score and
its two-component ablation. Ratings belong only to other eligible works when selecting
evidence. An item from the viewer's history needs a withheld personal forecast; a
target with a rated relative needs family-excluded donor residuals.
"""
from argparse import ArgumentParser
from collections import defaultdict
import hashlib
import json
from pathlib import Path
from statistics import mean
import subprocess
import sys
from tempfile import TemporaryDirectory

from peer_witness import crowd_local, inclusive_donors
from public_bias import public_fit, weighted_median
from separate_credits import catalogue, predict, similar_genres, trait_evidence
from story_credit_corroboration import descriptors, postings, verdict
from studio_margin import signed_margin
from team_audience import display, read, utility, write_new


def synopsis_vectors(files):
    import numpy as np

    vectors = {}
    for path in files:
        with np.load(path, allow_pickle=False) as data:
            for item, vector in zip(data['ids'], data['emb'], strict=True):
                norm = float(np.linalg.norm(vector.astype(float)))
                if norm > 0:
                    vectors[str(item)] = vector.astype(float) / norm
    return vectors


def refresh_vectors(data, vectors, frozen_text, encoder):
    """Reuse only embeddings of unchanged text. Encode new or edited descriptions locally."""
    texts = {r['id']:r.get('overview') for source in frozen_text for r in read(source)}
    missing = []
    for row in data['rows']:
        i, overview = row['id'],row.get('overview')
        if i in vectors and overview == texts.get(i):
            continue
        vectors.pop(i,None)
        if overview:
            missing.append(dict(id=i,overview=overview))
    if not missing:
        return
    with TemporaryDirectory(prefix='coast-preview-synopses-') as scratch:
        tmp = Path(scratch)
        (tmp/'catalogue.json').write_text(json.dumps(missing))
        (tmp/'history.json').write_text('[]')
        script = Path(__file__).resolve().parents[1]/'2026-11-23-taste-measurement/metadata/encode.py'
        subprocess.run([sys.executable,'-B',str(script),str(tmp/'catalogue.json'),str(tmp/'history.json'),
                        *map(str,encoder),str(tmp)],check=True)
        vectors.update(synopsis_vectors([tmp/'emb-others.npz']))


class CatalogueRules:
    """Indices for a single medium. An unrated work is never a donor."""

    def __init__(self, medium, rows, vectors):
        self.rows = {r['id']: r for r in rows}
        assert len(self.rows) == len(rows) and all(r['medium'] == medium and r['family'] for r in rows)
        items = set(self.rows)
        capture = [dict(medium=medium, history=[], catalogue=rows)]
        self.works, self.companies, _, self.genres = catalogue(capture, rows, items)
        _, _, tags, credits = descriptors(capture, rows, items)
        self.fields = tags, credits
        self.ratings = {i:r for i,r in self.rows.items() if r.get('stars') is not None and r.get('direct',True)}
        self.stars = {i:r['stars'] for i,r in self.ratings.items()}
        self.families = {i:r['family'] for i,r in self.rows.items()}
        self.canonical = {i:{'cluster':family} for i,family in self.families.items()}
        self.names = {i:r.get('title', i) for i,r in self.rows.items()}
        self.rated_families = defaultdict(set)
        self.team = defaultdict(set)
        for i in self.ratings:
            self.rated_families[self.families[i]].add(i)
            if self.works[i][2]:
                self.team[frozenset(self.works[i][2])].add(i)
        def rated_index(traits):
            return postings({i:traits[i] for i in self.ratings})
        self.indices = rated_index(tags), rated_index(credits)
        self.studio_indices = rated_index({i:self.works[i][0] for i in self.ratings}), rated_index(self.companies)
        self.public = {i:(r['voteAverage'], r['voteCount'], self.genres[i],
                          {t['id'] for t in r['features'].get('tags', [])})
                       for i,r in self.rows.items() if r.get('voteCount', 0) and 0 < (r.get('voteAverage') or 0) <= 10}
        self.forecasts = {i:r['donorNative'] for i,r in self.ratings.items() if r.get('donorNative') is not None}
        self.public_forecasts = {i:r['publicNative'] for i,r in self.ratings.items() if r.get('publicNative') is not None}
        self.history_families = {self.families[i] for i,r in self.rows.items() if r.get('known') or i in self.ratings}
        self.vectors = vectors
        self.low = {i for i in self.ratings if self.stars[i] <= 2.5}
        self.low_traits = [
            {key for i in self.low for key in field[i]} for field in (tags,credits,self.companies)]

    def exact(self, i, base, allowed, predicted):
        team = frozenset(self.works[i][2])
        members = self.team.get(team,set()) & allowed
        if not members or any(self.stars[j] > 2.5 for j in members):
            return base
        residuals = defaultdict(list)
        for j in sorted(members):
            if j in predicted and similar_genres(self.genres[i], self.genres[j]):
                residuals[self.families[j]].append(utility(self.stars[j]) - predicted[j])
        correction = min(0,mean(mean(v) for v in residuals.values())) if residuals else 0
        return display(base + correction)

    def reception(self, i, base, lower, allowed, predicted):
        if i not in self.public or lower is None or not lower < 50 <= base:
            return base
        audience, votes = self.public[i][:2]
        if public_fit(audience,votes) >= 50:
            return base
        peers = allowed & predicted.keys()
        graph = crowd_local.work_neighbours(i,self.canonical,self.public,peers)
        errors = {j:utility(self.stars[j])-predicted[j] for _,j,_ in graph}
        donors,_ = inclusive_donors(graph,peers,self.public,self.stars,errors)
        if crowd_local.propose(audience,votes,donors,cap=8)[2] >= 0:
            return base
        low_public = {j for j in allowed if j in self.public and self.public[j][0] < 6}
        graph = crowd_local.work_neighbours(i,self.canonical,self.public,low_public)
        errors = {j:utility(self.stars[j])-public_fit(*self.public[j][:2]) for _,j,_ in graph}
        donors,_ = inclusive_donors(graph,low_public,self.public,self.stars,errors)
        if len(donors) >= 2:
            personal_audience = public_fit(audience,votes) + weighted_median([(d.error,d.weight) for d in donors])
            if personal_audience < 50:
                return lower
        return base

    def studio(self, i, base, allowed, comparable):
        if not self.companies[i] & self.low_traits[2]:
            return None
        pi, ci = self.studio_indices
        def traits(keys, index):
            return trait_evidence(keys,index,allowed,self.ratings,self.families,self.works)
        persons = list(traits(self.works[i][0],pi))
        if not persons:
            return None
        choices = []
        for company, *_ in traits(self.companies[i],ci):
            for person, *_ in persons:
                comparison = predict(i,[company],allowed,(defaultdict(set,{person:pi[person]}),ci),self.ratings,self.families,
                                     self.works,comparable=comparable).get('separatePeopleAndCompanies')
                if not comparison:
                    continue
                hard, _, _, low_person, low_company = comparison
                def weight(low, peers):
                    high = {j for j in peers & allowed if self.stars[j] > 3}
                    return signed_margin(i,low,high,self.genres,self.ratings,self.names)['factor']
                factor = min(weight(low_person,pi[person]), weight(low_company,ci[company]))
                choices.append(base + factor * (hard-base))
        return display(max(choices)) if choices else None

    def story(self, i, base, allowed):
        from content_agreement import nearest
        import numpy as np

        if i not in self.vectors or not self.fields[0][i] & self.low_traits[0] or not self.fields[1][i] & self.low_traits[1]:
            return base
        if 'corroborated' not in verdict(i,allowed,self.ratings,self.families,self.works,self.genres,self.fields,self.indices):
            return base
        sims = [(j,float(self.vectors[i] @ self.vectors[j])) for j in sorted(allowed) if j in self.vectors]
        likeness = np.array([s for _,s in sims])
        n = nearest(likeness,np.ones(len(sims),dtype=bool))
        if n is None:
            return base
        best, bad = sims[n]
        if self.stars[best] > 2.5 or bad <= 0:
            return base
        record = verdict(i,allowed,self.ratings,self.families,self.works,self.genres,self.fields,self.indices,
                         plot=best).get('independentSynopsisVerifiedTeams')
        good = max((s for j,s in sims if self.stars[j]>3),default=None)
        if record is None or good is None or bad-good <= 1e-12:
            return base
        return display(base+(record[0]-base)*min(1,(bad-max(0,good))/bad))

    def select(self, row):
        i, base = row['id'], row['native']
        family = self.rated_families[self.families[i]]
        allowed = self.ratings.keys()-family
        # Existing relatives or the target may have contributed to a donor model.
        # Withhold the residual-dependent arms when no matching double-exclusion fit exists.
        has_relative = self.families[i] in self.history_families
        exact = row.get('exactDonorNative', {} if has_relative else self.forecasts)
        public = row.get('publicDonorNative', {} if has_relative else self.public_forecasts)
        score = self.exact(i,base,allowed,exact)
        rule = 'exact-team' if score != base else 'personal'
        if score == base:
            score = self.reception(i,base,row.get('bothRemovals'),allowed,public)
            if score != base:
                rule = 'personalised-tmdb'
        if score >= 50:
            comparable = {j for j in allowed if similar_genres(self.genres[i],self.genres[j])}
            studio = self.studio(i,score,allowed,comparable)
            if studio is not None:
                if studio != score:
                    score,rule = studio,'person-company'
            else:
                story = self.story(i,score,allowed)
                if story != score:
                    score,rule = story,'story-credit'
        return dict(native=base,score=score,rule=rule,withheld=row.get('withheld') is True)


def publish(source,embeddings,output,holdouts=None,direct=None,verified=None,frozen_text=None,encoder=None):
    data = read(source)
    vectors = synopsis_vectors(embeddings)
    if encoder:
        refresh_vectors(data,vectors,frozen_text,encoder)
    held = {r['id']:r for r in read(holdouts)['full']['cases']} if holdouts else {}
    labels = {r['id']:r for r in read(direct)['ratings']} if direct else {}
    parity = read(verified) if verified else {}
    if holdouts:
        assert held.keys()==labels.keys() and data.get('verifiedRatingsHash')==hashlib.sha256(direct.read_bytes()).hexdigest()
        assert held.keys()==parity['scores'].keys() and hashlib.sha256(holdouts.read_bytes()).hexdigest()==parity['frozenSourceSha256']
        for row in data['rows']:
            row['direct'] = row['id'] in labels
    results = {}
    for medium in ('movie','show'):
        rows = [r for r in data['rows'] if r['medium']==medium]
        model = CatalogueRules(medium,rows,vectors)
        for r in rows:
            if r.get('native') is None or (r.get('known') or r.get('stars') is not None) and not r.get('withheld'):
                continue
            assert r['id'] not in results
            if r['id'] in held:
                old, label = held[r['id']],labels[r['id']]
                assert (r['stars'],r['medium'],r['native']) == (old['stars'],old['medium'],old['native'])
                assert r['withheld'] and (label['stars'],label['medium']) == (r['stars'],r['medium'])
                forecast = parity['scores'][r['id']]
                assert forecast['score']==old['selected'] and forecast['native']==old['native'] and forecast['withheld']
                results[r['id']] = forecast
                continue
            results[r['id']] = model.select(r)
    write_new(output,dict(version=1,userId=data['userId'],revision=data['revision'],rows=results,
                          sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
                          sourceRows=len(data['rows']),withheldRows=sum(r['withheld'] for r in results.values())))


if __name__ == '__main__':
    cli = ArgumentParser(description=__doc__)
    cli.add_argument('source',type=Path)
    cli.add_argument('output',type=Path)
    cli.add_argument('--embeddings',type=Path,nargs='+',required=True)
    cli.add_argument('--holdouts',type=Path,help='Verified selected whole-title replay for known titles in the source.')
    cli.add_argument('--direct',type=Path,help='Direct-rating snapshot corresponding to the verified replay.')
    cli.add_argument('--verified',type=Path,help='Independently reproduced named-rule scores for those holdouts.')
    cli.add_argument('--frozen-text',nargs='+',type=Path,help='Descriptions used for the supplied embeddings, in the same precedence order.')
    cli.add_argument('--encoder',nargs=2,type=Path,metavar=('MODEL','VOCAB'),help='Local snapshot of the same synopsis encoder.')
    args = cli.parse_args()
    if len({bool(args.holdouts),bool(args.direct),bool(args.verified)})!=1 or bool(args.frozen_text)!=bool(args.encoder):
        cli.error('Supply all three verified holdout inputs together, and both synopsis encoder options together.')
    publish(args.source,args.embeddings,args.output,args.holdouts,args.direct,args.verified,args.frozen_text,args.encoder)
