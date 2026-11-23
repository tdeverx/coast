# Repeated negative evidence control

This is a read-only challenger to the sealed graded model. The following policy was specified before examining its holdouts. The previously published score, profile, forecast and source archive are unchanged.

Use only exact content tags, cast, directors, writers and verified show creators. Exclude generic genres, providers, networks, companies, recency, viewing frequency and nonselection. Within an attribute, average verified direct stars within each distinct franchise or unconnected work. A family is disliked when its mean is at most 2½. Every other rated family counts as counterevidence. Omit the entire target family from the attribute counts, as well as every held-out rating. Date tests can use only earlier rating days. Retain the same deterministically masked titles in the limited-rating tests.

For an attribute with at least two disliked independent families, take a uniform Beta(1,1) prior and require at least 85% posterior probability that its personal dislike rate exceeds one half. If an attribute qualifies, put an upper limit of `50 − 20 × (2 × posterior mean − 1)` on the already-graded score. Two disliked families out of two give a limit of 40. Where several qualify, apply the strongest limit once. Keep the original score or abstention if nothing qualifies. This pre-specified limit is a diagnostic intervention on ranking and display, not a claimed probability that a person will dislike a film. No anonymous audience evidence enters this test.

## Decision

**Reject the override.** All 16 movie cohorts returned the original predictions. The seven rated movies at or below 2½ stars supplied too little recurring evidence to identify a held dislike. On shows the control lowered several genuinely liked titles into red and failed to recover a single disliked title chronologically. The identical whole-title and original show-franchise outcomes reuse the same partition on these data.

| Show holdout | Dislikes below 50 (≤2½) | Weak titles below 50 (≤3) | Liked titles incorrectly below 50 (≥4) | Five-star titles green before → after | Liked-versus-weak ordering before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Whole title | 1 / 33 | 2 / 66 | 3 / 287 | 51 → 51 of 59 | 79.66% → 79.47% |
| Franchise | 1 / 33 | 2 / 66 | 3 / 287 | 51 → 51 of 59 | 79.66% → 79.47% |
| Alternate franchise assignment | 0 / 33 | 1 / 66 | 4 / 287 | 51 → 51 of 59 | 81.02% → 80.49% |
| Earlier rating days only | 0 / 7 | 0 / 18 | 3 / 128 | 16 → 16 of 24 | 68.03% → 67.03% |

Before the override, zero titles in those categories scored below 50. The whole-title control also marked a 3½-star show red. Across unequal rating pairs on later days, ordering accuracy moved from 60.47% to 60.16%. The number of weak show titles displayed green did not change on any of these splits. In whole-title folds, all 60 of 66 movie favourites previously shown green stayed green.

With all training ratings withheld, every target kept exactly the same prediction. The captured profile contains no literal zero-star ratings in either medium. Of 18 two-, ten- and fifty-rating samples across both media, only one sample moved any score: one 2½-star show turned red on one fifty-rating seed. The two other fifty-rating show samples did not reproduce it. Rates refer to all targets scorable by the same graded baseline and challenger in each fold. Comparisons against the incumbent elsewhere can have a smaller shared denominator.

A specific tag or credit in two disliked shows does not establish why the person disliked either. In this profile, escalating that association into an item-wide rejection created more false reds on liked shows than true reds on disliked shows. The prior majority-negative diagnostic allowed more trait families and a weaker evidence threshold. It identified potential cases to inspect, without establishing that they warranted an override. No cutoffs were changed in response to the result.

To reproduce the 32 paired cohorts, run `python3 replay.py CAPTURE VERIFIED_DATES VERIFIED_CREDITS GRADED_HOLDOUTS` from this directory. The evaluator reads frozen data and prints only aggregates. [Complete results](results.json) · [Read-only evaluator](replay.py) · [Original negative-tail audit](../2026-11-23-taste-v2/README.md#why-the-challenger-produces-no-red-scores)
