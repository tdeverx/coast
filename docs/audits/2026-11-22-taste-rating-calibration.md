# Rating strength and calibration on held-out works

Giving moderate ratings more influence improved the order of the copied viewer's movie predictions. Mapping the percentages to the observed chance of a four-star rating reduced false highs, but also lowered many genuine favourites. These experiments used frozen development data. They made no production scoring or settings changes.

## Comparable predictions

The snapshot contains 765 movie and 566 show history roots. We reproduced all 1,746 previously frozen work-fold predictions, including abstentions, across rated and ratings-masked modes. Five stable canonical-ID folds held out each target's full tracking and ratings. The numeric sample contained 444 movies and 428 shows in each mode. We also withheld whole connected franchises and tested 111 movie and 107 show first-watch holdouts. The comparison catalogue contained the same 4,892 movie and 3,558 show opportunities. [Native replay](../../scripts/taste-replay.ts) · [Catalogue and score interpretation](2026-11-22-card-taste-score-distribution.md)

Ordering means a held-out four-star-or-higher title scored above one rated three or lower in the same fold, with half credit for a tie. We also counted 3½-star titles in the lower group as a harder discrimination check. Brier loss measures squared error if the percentage is interpreted as the chance of eventually giving at least four stars. This is one measurable interpretation of a match. It applies to titles the viewer chose to rate. Among those with a prediction, 73.4% of movies and 67.1% of shows received four stars or more.

## How much should a moderate rating count?

The existing model uses both the signed distance from three stars and the absolute distance as its evidence weight. The square-root variant keeps the same sign and magnitude of preference but changes the evidence weight from `abs(vote)` to `sqrt(abs(vote))`. Exact three-star evidence rises from 0.15 to 0.25 and remains directionally neutral. A 2½-star vote therefore supplies −0.125 signed units instead of −0.0625 before consensus and return adjustments. A 3½-star vote gains the equivalent positive influence. One and five stars retain their full weights.

| Rated work folds | Movies, existing → square root | Shows, existing → square root |
| --- | ---: | ---: |
| Four or more versus three or lower | 75.96 → 77.80% | 79.32 → 79.59% |
| Four or more versus 3½ or lower | 58.99 → 59.92% | 71.44 → 71.69% |
| Brier loss, lower is better | .2000 → .1989 | .2231 → .2213 |
| Liked titles among top 20 | 19 → 19 | 14 → 14 |
| Liked Animation / Sci-Fi titles in their top 20s | 16 / 17 → 16 / 17 | 16 / 14 → 18 / 14 |
| Held-out 2½ stars or lower scoring at least 80 | 4 → 3 of 7 | 9 → 7 of 32 |
| Held-out five-star titles scoring at least 80 | 59 → 58 of 66 | 54 → 54 of 59 |

A paired 1,000-sample title bootstrap within folds put the ordering change at +0.30 to +3.70 percentage points for movies and −0.67 to +1.24 for shows. These intervals condition on the fitted folds and one viewer. Integer ties and cohort size matter, especially for the seven low-rated movies.

Movie franchise ordering improved from 76.54% to 78.02%, but the number of liked Sci-Fi movies in its top 20 fell from 16 to 15. The show franchise assignments match the work folds in this snapshot. The full-reference median for six unseen Studio Ghibli films stayed at 86%, with all six at or above 80%. Three previously unscored, unfamiliar shows acquired choice estimates of 40–41%, with evidence strength of 29–32%. The remaining catalogue abstentions and all rated-work abstentions agreed.

Eight weighting variations included stronger negative evidence alone, full weight on every non-neutral rating, changes to neutral evidence alone, square-root evidence with the original neutral weight, a gentler 0.7 exponent, and separate positive-only and negative-only versions. Full non-neutral weight raised movie ordering to 77.98% but lost two liked Sci-Fi titles from each medium's work-fold top 20. Stronger negatives alone improved show ordering to 79.90% and cut its high-scoring dislikes from nine to five, while losing a liked movie in the overall and Sci-Fi top 20. Simply taking the square root and leaving neutral evidence at 0.15 cost one liked movie in each of those two groups. No variant cleared every guard across both work and franchise splits.

Isolating the two places that consume rating weights identified where the gain came from. Changing only the personal affinities lowered the false-high counts from four to three for movies and nine to seven for shows. Changing only the fitted rating correction left both counts at four and nine. Movie ordering improved in both isolated arms (76.81% and 77.02%, respectively), and improved most when both were enabled. Show Brier loss improved to .2204 with only the affinity change but rose to .2241 with only the correction change. These two uses of a rating need separate controls when experimenting with further corrections.

With all ratings masked, the square-root variant preserved every predicted value and abstention in the 8,450 catalogue controls. Both chronological holdouts were unchanged because no personal star ratings had trustworthy import dates before the cutoffs. This copy cannot establish the benefit of applying the new weights to historically available ratings. In isolated, single-genre profiles, the two-five-star case stayed at 77%, the five/five/one-star case stayed at 60%, and five/five/2½ moved from 75% to 73%. An empty profile still withheld the score.

## Can a learned map fix the percentage?

For each outer holdout we fitted the map using predictions on the other four folds. Each of those predictions came from a separate reference excluding both its own fold and the entire outer holdout. No outer title supplied a star rating, tracking event or tuning label to its own map. The ordinary logistic map used the log-odds of the current score, a nonnegative slope and a regularization prior towards the identity. We also tested a monotone binned map with 16 prior observations per bin, a confidence term, a graded-star target, a fixed correction cap, and two versions that protect the upper tail. All personal calibration falls back to the original score without 30 scored training labels and six examples of each outcome. With ratings masked it therefore made zero adjustments.

| Display, rated work folds | Movie Brier | Show Brier | Low-rated medians, movies / shows | Five-star medians, movies / shows | Six unseen Ghibli, median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current | .2000 | .2231 | 80 / 75 | 85 / 87 | 86 |
| Square-root evidence | .1989 | .2213 | 79 / 74.5 | 84 / 87 | 86 |
| Current model plus logistic probability | .1929 | .1964 | 71 / 56.5 | 77 / 80 | 78 |
| Square root plus limited graded-star mapping | .1942 | .2107 | 75 / 69 | 80 / 83 | 82 |
| Square root plus upper-tail protection | .1944 | .2083 | 71 / 66.5 | 81 / 86 | 85 |

The logistic probability map lowered average absolute error between the mean score and the fraction liked across ten-point bands from 9.32 to 2.00 percentage points for movies and from 14.51 to 4.03 for shows. Its Brier change against the original had conditional paired intervals of about −.0136 to −.0012 and −.0397 to −.0150 respectively. It also reduced the number of five-star movies scoring at least 80 from 59 to 16, and only two of the six unseen Ghibli movies remained at 80 or higher. Within-fold ordering barely moved. The map mainly corrected the numbers attached to the existing order.

The gentler upper-tail experiment limited the downward correction to ten points, weighted it by nearby labels and tapered it from the 35th to the 90th percentile of the training predictions. With square-root evidence, it reduced high-scoring known dislikes from four to one for movies and nine to three for shows. It preserved the work-fold top-20 counts and the median Ghibli score nearly recovered. Only 39 of 66 five-star movies still reached 80%, however. The number of previously unseen opportunity movies at 80 or higher fell from 1,945 of 4,190 to 449. One modest-looking shift around a dense band changes a large part of the catalogue presentation.

The square-root evidence adjustment merits testing on additional viewers and alongside independent features that distinguish favourites from weaker titles. Keep the personal probability maps as research candidates. A better-calibrated chance of giving four stars and a useful affinity percentage serve different purposes on this account, especially around rare preferences and genuine favourites.
