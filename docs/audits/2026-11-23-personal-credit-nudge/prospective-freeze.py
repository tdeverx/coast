"""Seal a private, personally unrated movie/show cohort and its contemporaneous audience figures."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import tempfile

import crowd_local
import nudge
import residual

POLICY = 'guarded-lead-local-tmdb-v1'
WEIGHTS = (0, 2, 4, 8)


def check(condition, explanation):
    if not condition:
        raise ValueError(explanation)


def instant(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    check(result.tzinfo is not None, 'A source timestamp is missing its timezone.')
    return result.astimezone(timezone.utc)


def key_for(salt, medium, work):
    return hashlib.sha256('/'.join((salt, medium, work)).encode()).hexdigest()


def snapshot_inputs(snapshot, now):
    read_at = instant(snapshot['readAt'])
    check(read_at <= now, 'Live read timestamp is in the future.')
    check(re.fullmatch(r'[0-9a-f]{64}', snapshot['accountKey']), 'Invalid study account identifier.')
    check(isinstance(snapshot['source'], str) and snapshot['source'].strip(), 'Missing snapshot provenance.')
    seen, audience = set(), {}
    collections = dict(snapshot.get('collections', {}))
    for row in snapshot['rows']:
        work = row['id']
        check(work not in seen, 'Duplicate title in live snapshot.')
        seen.add(work)
        if 'collections' in row:
            collections[work] = row['collections'] or []
        if row.get('score') is None and row.get('votes') in (None, 0):
            continue
        score, votes = row['score'], row['votes']
        check(type(score) in (int, float) and math.isfinite(score) and 0 < score <= 10
              and type(votes) is int and votes > 0, 'Invalid TMDB reception in snapshot.')
        check(instant(row['observedAt']) <= read_at, 'Provider timestamp is after the live read.')
        audience[work] = dict(score=score, votes=votes, observedAt=row['observedAt'])
    check(isinstance(snapshot['alreadyRated'], list), 'Missing live rating exclusion set.')
    check(isinstance(snapshot['catalogueIds'], list), 'Missing live catalogue membership.')
    return audience, collections


def families(dataset, features, collections):
    """Freeze the original history's components, then resolve candidates and any newly joined franchises."""
    parent = {}

    def root(key):
        while key in parent:
            key = parent[key]
        return key

    def add(work, groups, facts):
        keys = ['collection:' + k for k in groups]
        keys.extend('feature:' + k['id'] for k in facts.get('franchises', []))
        for key in keys:
            a, b = root(work), root(key)
            if a != b:
                parent[max(a, b)] = min(a, b)

    for row in dataset['history']:
        add(row['work']['id'], row.get('collections', []), row['features'])
    frozen = {row['work']['id']: root(row['work']['id']) for row in dataset['history']}
    for work, facts in features.items():
        add(work, collections.get(work, []), facts)
    return frozen, {i: {'cluster': root(i)} for i in features}


def forecast(dataset, meta, dates, graded, sealed, old_salt, new_salt, audience, collections, already_rated, catalogue):
    medium = dataset['medium']
    features = {r['work']['id']: r['features'] for r in dataset['history']}
    known = set(features)
    features.update({r['id']: r['features'] for r in dataset['catalogue']})
    historical, works = families(dataset, features, collections)
    panel, = (r for r in graded['runs'] if r['medium'] == medium and r['split'] == 'franchise' and r['budget'] == 'all')
    fold = {i: int(hashlib.sha256(f.encode()).hexdigest()[:2], 16) % 5 for i, f in historical.items()}
    updated_folds = defaultdict(set)
    for i in known:
        updated_folds[works[i]['cluster']].add(fold[i])
    ratings, errors = {}, {}
    for t in panel['targets']:
        i = t['id']
        check(t['cluster'] == historical[i] and str(fold[i]) == t['group'], 'Historical franchise receipt mismatch.')
        if i not in dates or dates[i]['stars'] != t['stars']:
            continue
        ratings[i] = t['stars']
        base = t['scores']['calibrated']
        # A newly discovered franchise link can span the historical train/test boundary.
        # Such titles may supply a personal star vote, but never a contaminated prediction error.
        if base is not None and len(updated_folds[works[i]['cluster']]) == 1:
            errors[i] = nudge.lineage.utility(ratings[i]) - base
    genres = {i: {x['id'] for x in f.get('genres', [])} for i, f in features.items()}
    metadata = {i: (a['score'], a['votes'], genres[i], {x['id'] for x in f.get('tags', [])})
                for i, f in features.items() if (a := audience.get(i))}
    credit_graph = nudge.graph(works, meta, genres, medium, donor_media={i: meta.get(i, {}) for i in ratings})
    eligible = [r['id'] for r in dataset['catalogue'] if not r['observed'] and r['id'] not in known]
    old_entries = {key_for(old_salt, medium, i): i for i in eligible}
    check({k for k, v in sealed.items() if v['medium'] == medium} == old_entries.keys(),
          'Frozen unseen pool differs from the native ledger.')
    records = []
    for old_key, i in old_entries.items():
        if i in already_rated or i not in catalogue:
            continue
        native = sealed[old_key]['v2']
        baseline = native
        new_scores = {str(w): baseline for w in WEIGHTS}
        donors = []
        if native is not None:
            delta, trace = nudge.proposal(i, ratings, credit_graph, 'lead', trace=True)
            guarded = residual.supported_delta(delta, trace['people'], errors)
            baseline = nudge.lineage.display(native + guarded)
            if i in metadata:
                neighbours = crowd_local.work_neighbours(i, works, metadata, errors)
                donors = crowd_local.select_donors(neighbours, metadata, errors, ratings)
            for weight in WEIGHTS:
                shift = crowd_local.propose(*metadata[i][:2], donors, cap=weight)[2] if i in metadata else 0.
                new_scores[str(weight)] = nudge.lineage.display(baseline + shift)
        check(new_scores['0'] == baseline, 'A zero-weight prediction moved.')
        records.append(dict(key=key_for(new_salt, medium, i), medium=medium, native=native, baseline=baseline,
                            scores=new_scores, audience=audience.get(i), neighbours=len(donors)))
    return records


def seal(capture_path, metadata_path, dates_path, graded_path, native_path, snapshot_path, output):
    paths = dict(capture=capture_path, metadata=metadata_path, dates=dates_path, graded=graded_path,
                 native=native_path, snapshot=snapshot_path)
    inputs, digests = {}, {}
    for name, path in paths.items():
        content = Path(path).read_bytes()
        digests[name] = hashlib.sha256(content).hexdigest()
        inputs[name] = json.loads(content)
    native, graded, snapshot = inputs['native'], inputs['graded'], inputs['snapshot']
    check(native['version'] == graded['version'] == 2 and native['manifest'] == graded['manifest'],
          'Native score ledgers do not share the same input manifest.')
    for name in ('metadata', 'dates', 'capture'):
        check(graded['manifest'][name] == digests[name], 'The input does not match the native receipt: ' + name)
    audience, collections = snapshot_inputs(snapshot, datetime.now(timezone.utc))
    check(instant(native['sealed']) <= instant(snapshot['readAt']), 'Native scores postdate the live read.')
    dates = {r['id']: r for r in inputs['dates']}
    check(all(instant(r['at']) < instant(snapshot['readAt']) for r in dates.values()), 'Future personal rating in the donor archive.')
    meta = {r['id']: r for r in inputs['metadata']}
    prior = {r['key']: r for r in native['entries']}
    check(len(prior) == len(native['entries']), 'Duplicate native ledger entry.')
    salt, entries = secrets.token_hex(32), []
    excluded = set(snapshot['alreadyRated'])
    catalogue = set(snapshot['catalogueIds'])
    for dataset in inputs['capture']:
        if dataset['medium'] in ('movie', 'show'):
            entries.extend(forecast(dataset, meta, dates, graded, prior, native['salt'], salt,
                                    audience, collections, excluded, catalogue))
    check(len({e['key'] for e in entries}) == len(entries) and bool(entries), 'Missing or duplicate forecasts.')
    receipt = dict(format='coast-prospective-audience', version=1, salt=salt,
                   sealed=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                   manifest=dict(accountKey=snapshot['accountKey'], policyVersion=POLICY, weights=list(WEIGHTS),
                                 inputs=digests, audienceSource=snapshot['source'], readAt=snapshot['readAt'],
                                 nativeSealed=native['sealed']), entries=entries)
    # Publish a complete owner-only ledger without overwriting an older measurement, even on a retry.
    output = Path(output)
    with tempfile.NamedTemporaryFile(dir=output.parent, mode='w') as tmp:
        json.dump(receipt, tmp, separators=(',', ':'), allow_nan=False)
        tmp.flush()
        os.fsync(tmp.fileno())
        os.link(tmp.name, output)
    return dict(sealed=receipt['sealed'], candidates=len(prior), excluded=len(prior)-len(entries),
                predictions=len(entries), scoreable=sum(r['native'] is not None for r in entries),
                withAudience=sum(r['audience'] is not None for r in entries))


if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ('capture', 'metadata', 'dates', 'graded', 'native', 'snapshot', 'output'):
        cli.add_argument(name)
    print(json.dumps(seal(*vars(cli.parse_args()).values())))
