"""Compare sealed Coast audience forecasts against later, independently verified personal ratings."""
import argparse
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from nudge import lineage

MEDIA = ('movie', 'show')
CAPS = ('0', '2', '4', '8')


def instant(value):
    if not isinstance(value, str):
        return None
    try:
        stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return stamp.astimezone(timezone.utc) if stamp.tzinfo is not None else None
    except (OverflowError, ValueError):
        return None


def is_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def is_score(value):
    return value is None or is_number(value) and 0 <= value <= 100 and value == int(value)


def validate_entry(entry, sealed):
    if not isinstance(entry, dict) or entry.get('medium') not in MEDIA or not (
            isinstance(entry.get('key'), str) and re.fullmatch('[0-9a-f]{64}', entry['key'])):
        raise ValueError('Invalid prospective forecast identity.')
    if not {'native', 'baseline', 'scores', 'audience'} <= entry.keys():
        raise ValueError('Forecast is missing fields.')
    scores, baseline, audience = entry['scores'], entry['baseline'], entry['audience']
    if (not isinstance(scores, dict) or scores.keys() != set(CAPS) or not is_score(entry['native']) or not is_score(baseline)
            or not all(is_score(v) for v in scores.values()) or scores['0'] != baseline):
        raise ValueError('Invalid prospective score arms.')
    if any((score is None) != (baseline is None) or
           (score is not None and abs(score - baseline) > int(cap)) for cap, score in scores.items()):
        raise ValueError('Unpaired predictions or an out-of-range adjustment.')
    if audience is None:
        if any(score != baseline for score in scores.values()):
            raise ValueError('An audience adjustment has no sealed TMDB observation.')
    elif not (isinstance(audience, dict) and is_number(audience.get('score')) and 0 < audience['score'] <= 10
              and type(audience.get('votes')) is int and audience['votes'] > 0 and
              (time := instant(audience.get('observedAt'))) is not None and time <= sealed):
        raise ValueError('Invalid or post-seal TMDB observation.')


def pair_order(sample, arm):
    # Score and rating scales are discrete. Count pairs without a quadratic comparison of titles.
    counts = defaultdict(Counter)
    for stars, forecast in sample:
        counts[stars][int(forecast['scores'][arm])] += 1
    prior = [0] * 101
    dislikes = [0] * 101
    twice_wins = total = twice_polar_wins = polar_total = 0
    for stars, current in sorted(counts.items()):
        smaller = smaller_dislikes = 0
        n = sum(current.values())
        total += n * sum(prior)
        if stars >= 4:
            polar_total += n * sum(dislikes)
        for score in range(101):
            freq = current[score]
            twice_wins += freq * (2 * smaller + prior[score])
            if stars >= 4:
                twice_polar_wins += freq * (2 * smaller_dislikes + dislikes[score])
            smaller += prior[score]
            smaller_dislikes += dislikes[score]
        for score, freq in current.items():
            prior[score] += freq
            if stars <= 2.5:
                dislikes[score] += freq
    return {'allPairs': total, 'ordered': twice_wins / (2 * total) if total else None,
            'likedDislikePairs': polar_total, 'likedAboveDisliked': twice_polar_wins / (2 * polar_total) if polar_total else None}


def measurements(sample, arm):
    error = improvement = 0.
    counts = dict.fromkeys(('changed', 'closer', 'further', 'changedEquidistant',
                           'disliked', 'dislikedLower', 'dislikedHigher', 'dislikedBelow50', 'likedNewRed',
                           'fiveStars', 'fiveStarsLower', 'fiveStarsLostGreen', 'fiveStarsGainedGreen',
                           'disagreementFive', 'disagreementFiveLower'), 0)
    for stars, p in sample:
        base, score = p['baseline'], p['scores'][arm]
        target = lineage.utility(stars)
        actual_error = abs(score - target)
        error += actual_error
        gain = abs(base - target) - actual_error
        improvement += gain
        if score != base:
            counts['changed'] += 1
            counts['closer'] += gain > 0
            counts['further'] += gain < 0
            counts['changedEquidistant'] += gain == 0
        if stars <= 2.5:
            counts['disliked'] += 1
            counts['dislikedLower'] += score < base
            counts['dislikedHigher'] += score > base
            counts['dislikedBelow50'] += score < 50
        if stars >= 4:
            counts['likedNewRed'] += score < 50 <= base
        if stars == 5:
            counts['fiveStars'] += 1
            counts['fiveStarsLower'] += score < base
            counts['fiveStarsLostGreen'] += score < 80 <= base
            counts['fiveStarsGainedGreen'] += base < 80 <= score
            if p['audience'] and stars - p['audience']['score'] / 2 >= 1:
                counts['disagreementFive'] += 1
                counts['disagreementFiveLower'] += score < base
    return {'paired': len(sample), 'mae': error / len(sample) if sample else None,
            'maeImprovement': improvement / len(sample) if sample else None,
            'meanImprovementWhenChanged': improvement / counts['changed'] if counts['changed'] else None,
            **counts, **pair_order(sample, arm)}


def feedback(documents):
    reports = defaultdict(set)
    accounts = set()
    for document in documents:
        if isinstance(document, dict):
            account = document.get('accountKey')
            if not isinstance(account, str) or not account:
                raise ValueError('A rating export envelope needs its account key.')
            accounts.add(account)
            document = document.get('ratings')
        if not isinstance(document, list):
            raise ValueError('Expected direct rating records.')
        for r in document:
            if not isinstance(r, dict):
                raise ValueError('Invalid direct rating record.')
            if r.get('medium') not in MEDIA:
                continue
            if not isinstance(r.get('id'), str) or not r['id']:
                raise ValueError('A direct rating has no canonical work ID.')
            stars = r.get('stars')
            if not (is_number(stars) and .5 <= stars <= 5 and 2 * stars == int(2 * stars)):
                stars = None
            reports[r['medium'], r['id']].add((instant(r.get('at')), stars))
    return reports, accounts


def evaluate(ledgers, rating_documents, as_of):
    events, accounts = feedback(rating_documents)
    first, ambiguous = {}, set()
    account_policy = None
    receipts = Counter()
    for ledger in ledgers:
        sealed = instant(ledger.get('sealed'))
        manifest = ledger.get('manifest')
        if (ledger.get('format') != 'coast-prospective-audience' or ledger.get('version') != 1
                or not sealed or sealed > as_of or not isinstance(manifest, dict)
                or not isinstance(ledger.get('salt'), str) or not ledger['salt']
                or not isinstance(ledger.get('entries'), list)):
            raise ValueError('Invalid prospective ledger or future seal.')
        identity = manifest.get('accountKey'), manifest.get('policyVersion')
        if not all(isinstance(v, str) and v for v in identity):
            raise ValueError('Missing ledger account or policy version.')
        if (account_policy is not None and identity != account_policy) or accounts - {identity[0]}:
            raise ValueError('Mixed accounts or scoring policies cannot be combined.')
        account_policy = identity
        encoded = {}
        for p in ledger['entries']:
            validate_entry(p, sealed)
            k = p['medium'], p['key']
            if k in encoded:
                raise ValueError('Duplicate forecast identity in a seal.')
            encoded[k] = p
        receipts['ledgers'] += 1
        receipts['forecastRecords'] += len(encoded)
        for work in events:
            medium, work_id = work
            digest = hashlib.sha256('/'.join((ledger['salt'], medium, work_id)).encode()).hexdigest()
            entry = encoded.get((medium, digest))
            if entry is None:
                continue
            if work not in first or sealed < first[work][0]:
                first[work] = sealed, entry
                ambiguous.discard(work)
            elif sealed == first[work][0] and any(
                    first[work][1][k] != entry[k] for k in ('native', 'baseline', 'scores', 'audience')):
                ambiguous.add(work)
    if account_policy is None:
        raise ValueError('At least one prospective ledger is required.')
    samples = defaultdict(list)
    exclusions = Counter()
    for work, (sealed, entry) in first.items():
        observed = events[work]
        if any(t is not None and t <= sealed for t, _ in observed):
            exclusions['alreadyRatedAtSeal'] += 1
            continue
        if any(t is None for t, _ in observed):
            exclusions['unknownRatingTime'] += 1
            continue
        if work in ambiguous:
            exclusions['conflictingEarliestSeals'] += 1
            continue
        earliest = min(t for t, _ in observed)
        if earliest > as_of:
            exclusions['futureOnly'] += 1
            continue
        stars = {s for t, s in observed if t == earliest}
        if len(stars) != 1 or None in stars:
            exclusions['unverifiedFirstValue'] += 1
            continue
        samples[work[0]].append((stars.pop(), entry))
    results = {}
    for medium in MEDIA:
        all_labels = samples[medium]
        paired = [(s, p) for s, p in all_labels if p['baseline'] is not None]
        usable = [(s, p) for s, p in paired if p['audience'] is not None]
        results[medium] = dict(eligibleFirstRatings=len(all_labels), paired=len(paired), pairedWithTmdb=len(usable),
                               allPaired={k: measurements(paired, k) for k in CAPS},
                               withTmdb={k: measurements(usable, k) for k in CAPS})
    return dict(records=dict(receipts), matchedUniqueWorks=len(first), excluded=dict(exclusions), media=results)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('ratings', type=Path, help='Original direct ratings with canonical id, medium, stars and verified time at.')
    cli.add_argument('ledgers', type=Path, nargs='+', help='Owner-only sealed JSON files from the same viewer and policy.')
    cli.add_argument('--also-ratings', type=Path, action='append', default=[], help='Additional original rating event export.')
    args = cli.parse_args()
    result = evaluate((lineage.read(p) for p in args.ledgers), (lineage.read(p) for p in [args.ratings, *args.also_ratings]),
                      datetime.now(timezone.utc))
    print(json.dumps(result, separators=(',', ':'), allow_nan=False))


if __name__ == '__main__':
    main()
