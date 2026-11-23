# Personal creator and executive producer replay

Credited leads provided a small ranking improvement on the full movie and show holdouts. Executive producer credits expanded coverage, but their incremental effect depended on the medium. The combined rule moved 51 five-star scores up, preserved all 111 green favourites, and raised three of the 40 low-rated titles. It didn't identify a new dislike.

## Native scorer versus each adjustment

The 873 whole-work targets contain 444 movies and 429 shows. A dislike is a personal rating of 2½ stars or less. A favourite here means five stars. Red is below 50 and green begins at 80.

| Adjustment | Dislikes down / same / up (40) | Favourites down / same / up (125) | Green favourites | Movie ordering | Show ordering |
| --- | --- | --- | --- | --- | --- |
| Native baseline | 0 / 40 / 0 | 0 / 125 / 0 | 111 | 61.69% | 70.05% |
| Lead only | 0 / 38 / 2 | 0 / 83 / 42 | 111 | 61.79% | 70.39% |
| Executive only | 0 / 39 / 1 | 0 / 111 / 14 | 111 | 61.53% | 69.87% |
| Lead and executive | 0 / 37 / 3 | 0 / 74 / 51 | 111 | 61.94% | 70.10% |

Ordering compares differently rated titles within their own held fold and gives ties half credit. There are 14,944 comparable movie pairs and 14,539 show pairs. For four-star-or-higher titles against dislikes, movie ordering moved from 73.27% to 73.07% and show ordering from 83.70% to 84.39%. The combined rule slightly reduced mean absolute error against the replay's historical star-to-score mapping, from 10.54 to 10.52 for movies and 12.38 to 12.34 for shows. These data describe one person.

## What changed

Of the 40 dislikes, 26 had no eligible shared credit. Four had a negative adjustment smaller than half a point; nine had a positive adjustment, and one had zero direction despite a shared credit. Across all 873 targets the observed signed changes ran from −0.44 to +3.56 before display rounding. Two of the three increases on dislikes occurred within an existing colour band, and one changed from 79 to 80. All 40 began above 50.

The rating distribution matters. Of the 873 targets, 613 had four or more stars; only 40 had 2½ or less, including 28 at 2½. A small, raw adjustment transferring personal stars is therefore likely to be positive. Directional credit evidence for a work and the work’s eventual personal rating can reasonably disagree. A small credit nudge cannot explain a large baseline error by itself.

The per-person transfer did grow with independent evidence. In the lead-only arm, positive-direction evidence across one, two and three-or-more donor franchises produced median adjustments of +0.80, +1.42 and +1.92 points, respectively. The two mixed-sign lead cases had adjustments of −0.11 and +0.02. All seven purely negative lead cases had only one donor family. Even with executives included, there were no target/person pairs with purely negative evidence across two or more donor families. This snapshot demonstrates positive scaling and cancellation; repeated-dislike scaling is covered by the synthetic check and remains unvalidated on this account. These counts describe target/person comparisons, which repeat people across targets.

Lead credits reached 235 of the 873 targets; executive credits alone reached 310. Combining them reached 450, including cross-role matches. Adding executives to leads moved seven movie favourites up and none down relative to lead-only, but moved three show favourites up and four down. All of those show favourites still scored at least as well as under the native baseline. A broader filmography also brings less-specific matches.

## Other panels

The chronological replay admitted only ratings from a strictly earlier UTC date and excluded the target’s canonical franchise. The combined candidate’s movie ordering moved from 55.06% to 55.16% on all unequal-star pairs, but fell from 58 to 52½ wins on 65 liked-versus-disliked pairs. For shows those two percentages rose from 60.47% to 60.71% and 53.71% to 55.69%. Same-day comparisons share works, so 65 pairs are fewer than 65 independent observations.

Across all panels and arms, no five-star score fell below its native displayed score. None of the 2,619 no-rating predictions changed. Across the three repeated sparse seeds, combined scores changed on 2 of 2,619 appearances at two ratings, 35 at ten and 178 at fifty. The work, original franchise, reassigned franchise, date and sparse panels reuse works. Summing their rows would overstate the number of independent predictions.

## Reproduce

Read [the fixed protocol](nudge-protocol.md) for weights, permitted credits, family collapsing and cancellation. The frozen capture, metadata and verified date files must match the hashes embedded in the native replay. The evaluation reads personal ratings from the eligible training mask, excludes the entire target franchise and never credits the same person twice on a work. The timestamp refers to when the person rated a title; the available credit metadata is retrospective.

Run the following with private local fixture paths and a fresh private ledger destination. The output JSON contains grouped metrics only. The ledger retains per-title deltas and is created with owner-only permissions.

```sh
python3 nudge.py CAPTURE CREDIT_METADATA VERIFIED_RATING_DATES NATIVE_GRADED PRIVATE_LEDGER > nudge-results.json
```

[All 32 per-panel comparisons](nudge-results.json) · [Offline scorer and replay](nudge.py)
