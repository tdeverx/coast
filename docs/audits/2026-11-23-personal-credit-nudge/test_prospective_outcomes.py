import copy
import hashlib
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('prospective', Path(__file__).with_name('prospective-outcomes.py'))
prospective = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prospective)


def rating(work, stars, at):
    return dict(medium='movie', id=work, stars=stars, at=at)


def seal(day, salt, works):
    at = f'2026-01-{day:02d}T12:00:00Z'
    entries = []
    for work, baseline, two, four, eight in works:
        key = hashlib.sha256(f'{salt}/movie/{work}'.encode()).hexdigest()
        entries.append(dict(key=key, medium='movie', native=baseline, baseline=baseline,
                            scores=dict(zip(prospective.CAPS, (baseline, two, four, eight))),
                            audience={'score': 6., 'votes': 80, 'observedAt': at}))
    return dict(format='coast-prospective-audience', version=1, sealed=at, salt=salt,
                manifest=dict(accountKey='test-owner', policyVersion='test-v1'), entries=entries)


def evaluate(ledgers, events):
    return prospective.evaluate(ledgers, [dict(accountKey='test-owner', ratings=events)], prospective.instant('2026-01-30T00:00:00Z'))


class ProspectiveOutcomes(unittest.TestCase):
    def test_first_forecast_and_first_rating_with_overlapping_salted_rounds(self):
        root = [('low', 56, 55, 54, 52), ('high', 80, 81, 82, 84)]
        early = seal(3, 'a', root)
        late = seal(8, 'b', [('low', 88, 89, 90, 92), ('high', 70, 71, 72, 74)])
        events = [rating('low', 2, '2026-01-06T00:00:00Z'), rating('low', 4, '2026-01-09T00:00:00Z'),
                  rating('high', 5, '2026-01-15T00:00:00Z'), rating('high', 5, '2026-01-15T00:00:00Z')]
        a = evaluate([late, early], events)
        self.assertEqual(a, evaluate([early, late], list(reversed(events))))
        r = a['media']['movie']['allPaired']['4']
        self.assertEqual((a['matchedUniqueWorks'], r['paired'], r['maeImprovement'], r['dislikedLower']), (2, 2, 2., 1))
        self.assertEqual((r['closer'], r['further'], r['changedEquidistant'], r['meanImprovementWhenChanged']),
                         (2, 0, 0, 2.))
        self.assertIsNone(a['media']['movie']['allPaired']['0']['meanImprovementWhenChanged'])
        self.assertEqual((r['allPairs'], r['ordered'], r['likedDislikePairs'], r['likedAboveDisliked']), (1, 1., 1, 1.))
        self.assertEqual(a['media']['show']['allPaired']['4']['mae'], None)

    def test_bad_first_or_unordered_history_is_never_promoted_to_future_success(self):
        names = ('pre', 'equal', 'unknown', 'ambiguous', 'bad_stars', 'future', 'none', 'conflict')
        ledger = seal(5, 'salt', [(n, 80, 80, 81, 82) for n in names])
        other = seal(5, 'other-salt', [('conflict', 79, 80, 81, 82)])
        at = '2026-01-20T00:00:00Z'
        events = [rating('pre', 4, '2026-01-01T00:00:00Z'), rating('equal', 5, ledger['sealed']),
                  rating('unknown', 3, None), rating('ambiguous', 1, at), rating('bad_stars', 7, at),
                  rating('future', 3, '2026-02-15T00:00:00Z'), rating('conflict', 4, at)]
        events.extend(rating(n, 5, at) for n in ('pre', 'equal', 'unknown', 'ambiguous'))
        results = evaluate([other, ledger], events)
        self.assertEqual(results['excluded'], dict(alreadyRatedAtSeal=2, unknownRatingTime=1, futureOnly=1,
                                                    conflictingEarliestSeals=1, unverifiedFirstValue=2))
        self.assertEqual(results['media']['movie']['paired'], 0)

    def test_missing_forecasts_missing_audience_policy_and_source_validation(self):
        first = seal(3, 'a', [('abstain', None, None, None, None), ('missing', 62, 62, 62, 62)])
        first['entries'][1]['audience'] = None
        late = seal(8, 'b', [('abstain', 80, 81, 82, 84)])
        events = [rating(n, 5, '2026-01-10T13:00:00+01:00') for n in ('abstain', 'missing')]
        result = evaluate([late, first], events)['media']['movie']
        self.assertEqual((result['eligibleFirstRatings'], result['paired'], result['pairedWithTmdb']), (2, 1, 0))
        for variant in ('account', 'policy', 'postseal', 'missing'):
            bad = copy.deepcopy(first)
            if variant == 'account': bad['manifest']['accountKey'] = 'different'
            if variant == 'policy': bad['manifest']['policyVersion'] = 'different'
            if variant == 'postseal': bad['entries'][0]['audience']['observedAt'] = '2026-01-20T00:00:00Z'
            if variant == 'missing': bad['entries'][1]['scores']['2'] = 63
            with self.assertRaises(ValueError):
                evaluate([late, bad], events)


if __name__ == '__main__':
    unittest.main()
