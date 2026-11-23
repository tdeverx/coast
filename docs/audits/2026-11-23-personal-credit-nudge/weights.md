# How much should public reception influence a match?

We replayed four fixed weights on the same 873 personally rated movies and shows. A weight is the maximum number of match points public reception can contribute before discounts for vote count, evidence and personal agreement. Other independent titles must also show that the personal score historically missed in the same direction. That last check limits the correction at every weight.

## Whole-title holdouts

| Maximum points | Average absolute error | Different display scores | Of 40 dislikes, lower / higher | Of 125 five-stars, lower / higher | Green five-stars lost | Movie / show ordering |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 11.444 | 0 | 0 / 0 | 0 / 0 | 0 | 61.69% / 70.05% |
| 2 | 11.431 | 18 | 0 / 0 | 0 / 1 | 0 | 61.93% / 70.08% |
| 4 | 11.378 | 110 | 2 / 1 | 2 / 15 | 0 | 62.74% / 70.58% |
| 8 | 11.305 | 259 | 9 / 1 | 7 / 29 | 0 | 63.48% / 71.09% |

All seven five-star downgrades at weight 8 came from the 93 films or shows this viewer rated at least one full star above the audience. No candidate moved any of the forty dislikes below 50. The largest individual score changes at weights 2, 4 and 8 were one, two and four displayed points respectively. The paired absolute-error reductions before rounding were 0.039, 0.075 and 0.137 points against the unchanged personal baseline. These averages are small on the 0–100 match scale.

Ordering compares differently rated titles in the same held fold, giving ties half credit. Specifically for a liked title ranking above a dislike, the movie comparison moved from 73.27% at zero to 74.46% at four and 75.54% at eight. For shows it moved from 83.70% to 83.86% and 84.53%.

## Other holdouts

Among 382 predictions made using only earlier personal ratings, eight lowered four of the fourteen dislikes and raised one. It also lowered three five-stars and moved one below 80. Four lowered three dislikes, raised one and lost no green five-stars. For earlier-rating shows the probability of ordering a liked title above a dislike rose from 53.71% at zero to 54.70% at four and 57.67% at eight.

When entire franchises were withheld, two previously green five-stars fell below 80 at eight, versus one at four. Neither weight lost a green five-star on the alternate franchise assignment. Every weight retained the original 2,619 zero-rating forecasts. With only two historical ratings, one sparse show sample had *worse* continuous error at eight by 0.091 points. No arm placed a previously non-red four-star-or-higher title below 50 across the 32 panels.

The historical TMDB observations all postdate the viewer's ratings. These overlapping replays establish a trade-off on one account; the future recorded predictions can test the four weights without this timing limitation. Eight produced the best average ordering here and penalised more personal favourites. Four is the primary candidate for the forward test, with two and eight kept as predeclared comparisons.

## Same starting score as the forward experiment

The forward ledger starts each arm at the personal prediction with the guarded creator/director adjustment. We also applied all four audience weights to that archived starting score with the identical targets, audience evidence and cutoffs. Counts of risen and fallen titles below refer to changes from this starting score. The earlier-rating panels include 14 dislikes and 59 five-star favourites.

| Holdout | Maximum points | Average error | Movie / show ordering | Dislikes lower / higher | Five-stars lower / higher | Green five-stars lost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Whole title | 0 | 11.412 | 61.91% / 70.20% | 0 / 0 | 0 / 0 | 0 |
| Whole title | 2 | 11.399 | 62.14% / 70.23% | 0 / 0 | 0 / 1 | 0 |
| Whole title | 4 | 11.346 | 62.87% / 70.67% | 2 / 1 | 2 / 15 | 0 |
| Whole title | 8 | 11.273 | 63.44% / 71.13% | 9 / 1 | 7 / 29 | 0 |
| Earlier ratings | 0 | 12.110 | 54.89% / 60.53% | 0 / 0 | 0 / 0 | 0 |
| Earlier ratings | 2 | 12.099 | 54.86% / 60.56% | 1 / 0 | 1 / 1 | 0 |
| Earlier ratings | 4 | 12.050 | 56.22% / 60.75% | 3 / 1 | 1 / 10 | 0 |
| Earlier ratings | 8 | 11.971 | 58.15% / 61.59% | 4 / 1 | 3 / 13 | 1 |

At zero, four and eight points, whole-title liked-over-disliked ordering reached 75.05%, 76.24% and 76.53% for movies and 84.05%, 84.15% and 84.69% for shows. The stronger nudge still helped average ordering while exposing more favourites to a downgrade. Separate results for each holdout are in the `guardedLeadWeights` field of the aggregate JSON.

## Reproduce

The replay rebuilds the permitted neighbours from the same immutable capture, validates each of the 13,477 archived control forecasts and compares the shared formula with an independent calculation. It verifies the exact four-point result before evaluating the other weights. The JSON contains only aggregate results.

```sh
python3 -B weights.py GUARDED_CROWD_LEDGER GRADED_REPLAY CAPTURE CREDIT_METADATA VERIFIED_DATES INNER_PERSONAL_FORECASTS
```

[Aggregate results for all 32 panels](weights-results.json) · [Guarded adjustment protocol](crowd-local-protocol.md)
