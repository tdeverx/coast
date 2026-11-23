# Confidence in the displayed taste match

On the copied account, a single confidence adjustment inside the score curve gave more accurate movie and show percentages on held-out titles. A gradual transition preserves the established behavior for small profiles. This experiment isolates the display arithmetic. It holds the underlying rating, return, habit, metadata and creator models constant within each comparison.

## How the percentage was tested

The previous display first reduced the strength of a match according to its supporting evidence. The previous recommendation ranking then multiplied the distance from 50 by confidence. Those two numbers could order the same titles differently. Across the rated movie work folds, the previous ranking corrected 129 strict pair inversions in the displayed score and introduced 42. In pairs that improved, the median confidence was 76% on the preferred title and 68% on its counterpart.

The tested change uses one retention factor inside the existing fit curve. Mature profiles use the confidence in the combined affinity evidence, before any confidence discount specific to an inferred viewing choice. The independent rating correction and learned choice rule then apply in their original order. This preserves the ability to like a specific creator while rarely choosing the surrounding genre. The separate confidence figure describes certainty. A thin-signal abstention and a supported choice-only estimate retain their distinct behavior.

We also tried rounding the previous hidden ranking for cards, multiplying the unadjusted match by confidence after the curve, and using the final confidence after the choice discount in the curve. Rounding the old rank compressed six unseen Ghibli films to a median 78.5% and a two-five-star genre to 59%. Multiplying after the curve improved full-profile rated movie ordering to 78.34% but lowered that two-title case to 63% and its 5/5/3 result increased to 64%. Using the final choice-discounted confidence inside the curve weakened chronological show ordering. The selected approach kept those signals separate.

## Fixed holdouts on the refreshed copy

The comparison used the same 765 movie and 566 show history roots as the earlier audit, with 444 movie ratings and 429 show ratings. Twenty-two series had their metadata refreshed on the development copy. All 444 rated movies and 428 shows received a score. The five work folds and five connected-franchise folds used stable IDs and identical training and test sets for all formulas. Chronological holdouts contained 111 movies and 107 shows. No training stars could reliably be dated before the chronological cutoffs, so the two chronological rating modes coincide.

A pair is correct when a title rated at least four stars comes above a title rated at most three in the same held-out fold. Ties earn half credit. All figures below use the integer a person sees. The top 20 use canonical ID to break equal displayed percentages. This differs from the confidence-weighted ranking metric in the [earlier audit](2026-11-22-taste-system-changes.md).

| Held out | Rated movies | Unrated movies | Rated shows | Unrated shows |
| --- | ---: | ---: | ---: | ---: |
| Individual works | 71.87 → 75.96% | 61.78 → 64.73% | 77.01 → 78.43% | 44.82 → 51.47% |
| Whole franchises | 70.48 → 76.54% | 60.80 → 69.60% | 77.01 → 78.43% | 44.82 → 51.47% |
| Future works by first verified watch | 56.36 → 63.64% | 56.36 → 63.64% | 61.42 → 63.16% | 61.42 → 63.16% |
| Liked titles in top 20, individual works | 18 → 19 | 17 → 16 | 14 → 14 | 10 → 12 |

The rated work-fold improvements had paired 95% intervals of +0.36 to +7.83 percentage points for movies and −0.08 to +2.93 for shows. Without ratings, the intervals were −3.69 to +9.59 and +3.23 to +10.07 respectively. These use paired within-fold DeLong placement variance conditional on the fitted folds. They describe uncertainty among titles from one account. The show franchise assignments coincided with the individual works in this snapshot.

- **Animation and sci-fi.** Rated Animation top-20 likes held at 16/20 in both media. With ratings withheld, movie Animation moved from 14 to 13, and shows from 9 to 11. Rated movie Science Fiction fell from 18 to 17, and rated show Sci-Fi & Fantasy held at 14. Rated Animation shows lost 1.9 points in overall pair ordering, while unrated Animation shows gained 3.8 points. All seven rated movie genres with at least five positives and five negatives improved in pair ordering. Masked-rating Horror and Comedy movies regressed. Those slices contained five and eleven negative labels respectively. Chronological show top-20 likes fell from 16 to 12 despite better overall pair ordering.
- **Strength compared with observed likes.** In the 80–100 band for rated movies, the previous mean score was 86.8% with 73.5% actually liked across 427 movies. The revised mean was 84.3% with 77.1% liked across 336. The analogous show figures changed from 87.0% versus 73.9% to 84.5% versus 77.6%. Brier error for ratings of at least four stars fell from 0.2096 to 0.2000 for movies and from 0.2351 to 0.2210 for shows. Withheld-rating movies became underconfident on this sample. Their mean fell from 66.5% to 61.5%, while 73.4% were liked. These estimates only cover titles the account chose to rate.

The unrefreshed copy yielded the same movie results. With the original TV credits, rated show work ordering changed from 77.02% to 78.69% and ordering without ratings from 44.88% to 51.78%. Refreshing the credits did not create the measured display improvement.

## Specific preferences and cold start

On the complete fitted profile and the fixed catalogue sample, 11 Ghibli anime films retained an 88% median, down from 91%. The other 78 anime films moved from 38% to 31%, and the 120 other anime shows from 40% to 35%. Restricting the movie cohort to unseen titles gave an 86% median for six Ghibli films and 31% for 77 others. Masking all ratings gave 62%, 15% and 15% on the three full cohorts. Seven unseen Tim Burton films retained an 86% median and the unseen Caroline Thompson film scored 88%. These are title scores, separate from predictive accuracy on hidden opinions.

Applying the mature formula immediately changed a profile with two five-star sci-fi films from 77% to 68% on a matching sci-fi genre. We therefore tested a linear transition from the existing small-profile retention at two roots to the mature factor at 40, the existing threshold for fitting rating interactions. With this transition, the scores for two 5★ films, two 5★ plus one 3★, and two 5★ plus one 1★ stayed at 77%, 76% and 60%. At maturity it is identical to the single-confidence arm in the table.

Seven deterministic small-history draws per fold and medium tested the transition at 2, 8, 20 and 40 observed works. At eight works it reduced Brier error against the immediate mature formula in all four rating/medium comparisons. Rated movie ordering improved from 57.74% to 58.51%, while rated show ordering fell from 57.10% to 54.04%. At 20 works it improved or tied Brier error, with mixed ordering. With only two randomly selected works the median movie draw produced no scored held-out titles. These draws sample sparsity from an experienced user, so they cannot establish accuracy for new users generally. The transition preserves legible small-profile behavior and reduces an observed tendency to over-shrink. The data give no universal best transition length.

The replay uses current metadata for every arm. Missing historical metadata, catalogue availability at the time, and self-selection into ratings limit absolute calibration claims. [Evaluation tool](../../scripts/taste-replay.ts)
