"""Replay the catalogue scorer with the same independent donor fits as the locked benchmark."""
from argparse import ArgumentParser
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

from raw_public import full_history
from selected_catalogue import CatalogueRules, synopsis_vectors
from team_audience import read, write_new


def verify(args):
    graded = read(args.graded)
    for k in ('capture','metadata'):
        assert hashlib.sha256(getattr(args,k).read_bytes()).hexdigest()==graded['manifest'][k]
    tiers = {r['medium']:{t['id']:t for t in r['targets']} for r in graded['runs']
             if r['split']=='franchise' and r['budget']=='all'}
    nested = {(r['medium'],r['group']):{t['id']:t['base'] for t in r['points']}
              for r in read(args.inner) if r['split']=='franchise' and r['budget']=='all'}
    exact = defaultdict(dict)
    for path in args.exact:
        with path.open() as f:
            for line in f:
                d = json.loads(line)
                if d['type']=='donor' and not d['extraExcluded']:
                    exact[d['target']][d['id']] = d['score']
    native = {r['id']:(r,scores) for r,scores,_ in full_history(read(args.team),args.raw)}
    audience = {r['id']:r for r in read(args.public)['rows']}
    meta = {r['id']:r for r in read(args.metadata)}
    vectors = synopsis_vectors(args.embeddings)
    expected = {r['id']:r for r in read(args.expected)['full']['cases']}
    predictions, portable = {}, {}
    for panel in read(args.capture):
        medium = panel['medium']
        features = {r['work']['id']:r['features'] for r in panel['history']}
        features.update({r['id']:r['features'] for r in panel['catalogue']})
        tier = tiers[medium]
        rows = []
        for i,(held,score) in native.items():
            if held['medium']!=medium:
                continue
            data = audience.get(i,{})
            source = dict(**meta[i], features=features[i], medium=medium, family=tier[i]['cluster'],
                          stars=held['stars'], native=score['base'], bothRemovals=score['bothRemovals'],
                          known=True, withheld=True, voteAverage=data.get('score'), voteCount=data.get('votes',0))
            rows.append(source)
        estimator = CatalogueRules(medium,rows,vectors)
        specimens = []
        for row in rows:
            i = row['id']
            group = tier[i]['group']
            public = {j:(tier[j]['scores']['calibrated'] if tier[j]['group']==group else nested[medium,group][j])
                      for j in estimator.ratings}
            prediction = estimator.select(dict(row,exactDonorNative=exact[i],publicDonorNative=public))
            predictions[i] = prediction
            assert prediction['score']==expected[i]['selected'],(row['title'],prediction,expected[i]['selected'])
            if args.typescript_input:
                crowd = row['voteAverage']
                public_inputs = crowd is not None and crowd<6 and row['bothRemovals']<50<=row['native']
                specimens.append(dict(id=i, family=row['family'],features=row['features'],
                    facts=row.get('facts') or {},credits=row.get('credits'),stars=row['stars'],
                    voteAverage=crowd,voteCount=row['voteCount'],native=row['native'],lower=row['bothRemovals'],
                    vector=vectors[i].tolist() if i in vectors else None,exact=exact[i],
                    public=public if public_inputs else {},expected=prediction))
        portable[medium] = specimens
    assert set(predictions)==set(expected)
    print(len(predictions),Counter(r['rule'] for r in predictions.values()))
    if args.typescript_input:
        write_new(args.typescript_input,portable)
    write_new(args.output,dict(scores=predictions,frozenSourceSha256=hashlib.sha256(args.expected.read_bytes()).hexdigest()))


if __name__=='__main__':
    cli = ArgumentParser(description=__doc__)
    for field in ('graded','inner','capture','metadata','public','team','expected','output'):
        cli.add_argument(field,type=Path)
    cli.add_argument('--raw',nargs=2,required=True,type=Path)
    cli.add_argument('--exact',nargs='*',default=[],type=Path)
    cli.add_argument('--embeddings',nargs='+',required=True,type=Path)
    cli.add_argument('--typescript-input',type=Path,help='Write a private parity input for the portable scorer.')
    verify(cli.parse_args())
