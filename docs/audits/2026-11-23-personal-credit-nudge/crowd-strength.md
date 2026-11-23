# Does selecting individual titles add anything beyond a smaller adjustment?

The original capped and personally checked adjustments differ in both size and where they apply. This diagnostic keeps their signed spending equal. In every original medium, split, rating budget and holdout group, multiply all positive unguarded deltas by the ratio of checked positive movement to unguarded positive movement. Do the same separately for negative deltas. No held personal ratings enter this calculation. This is an offline comparison given the checked arm's total movement across a group.

| Holdout | Measures | Equal movement spread uniformly | Personal agreement plus error check |
| --- | --- | ---: | ---: |
| Whole movies | Correct order across all differently rated pairs | 62.41% | 62.74% |
| Whole shows | Correct order across all differently rated pairs | 70.24% | 70.58% |
| Whole movies | Liked title above disliked title | 75.25% | 74.46% |
| Whole shows | Liked title above disliked title | 83.65% | 83.86% |
| Dated movies | Liked title above disliked title | 90.00% | 90.00% |
| Dated shows | Liked title above disliked title | 53.22% | 54.70% |

Both versions lowered two of the original 40 dislikes, raised one and preserved all 111 initially green five-star titles. The personal check reduced the displayed score for two of 93 disagreement favourites and uniform shrinkage reduced three. Their unrounded mean absolute errors on the whole-title panels were 10.465 and 10.472 for movies, and 12.305 and 12.315 for shows, respectively. The selective rule helped slightly on overall ordering. Its ability to separate highly rated from disliked titles was mixed across media.

A holdout group with one candidate on a given side receives the exact same continuous adjustment under either rule. On the chronological panels, 78 of 95 nonempty movie directions and 26 of 34 nonempty show directions were singletons. Another direction with zero checked movement is identical under both rules regardless of group size. All ten full whole-title directions per medium contained multiple targets and nonzero movement. TMDB scores in the archive were observed after the historical personal ratings, so the date panels cannot establish prospective accuracy.

The [control script](crowd-strength.py) verifies equal continuous movement separately for each side before display rounding. [All 32 aggregate comparisons](crowd-strength-results.json)
