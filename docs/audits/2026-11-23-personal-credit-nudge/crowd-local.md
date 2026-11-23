# Personal agreement with public reception

The guarded adjustment improved average ordering a little and protected most five-star exceptions on this account. Most of that protection also came from uniformly reducing the audience's influence. The additional improvement from learning which works deserve a nudge was small and varied by medium.

The nearest comparisons were up to twelve independently rated franchises sharing genre or tags with the target. Coast learned whether the viewer tended to prefer the better-received titles among those comparisons. Differing tastes or uniformly positive ratings weakened the adjustment. Fewer public votes reduced its size. Finally, the adjustment could move only as far as past independent errors on comparable titles justified.

## Same 873 individually held titles

| Change to the personal score | Of 40 dislikes, lower / same / higher | Of 93 disagreement five-stars, lower | Of 111 green five-stars, lost green |
| --- | --- | ---: | ---: |
| Previous local audience method capped at four points | 27 / 9 / 4 | 30 | 5 |
| New small nudge without personal agreement | 17 / 20 / 3 | 22 | 3 |
| New nudge with personal agreement | 2 / 37 / 1 | 3 | 0 |
| Personal agreement and earlier error check | 2 / 37 / 1 | 2 | 0 |
| Uniformly reduced to the same amount of total upward and downward movement as the checked nudge | 2 / 37 / 1 | 3 | 0 |

All 40 dislikes stayed above 50. The checked adjustment raised fifteen of 125 five-stars and lowered two by one displayed point each. Against the original score, it lowered mean absolute error by 0.074 points for films and 0.058 for shows. Before rounding, it nudged 23 of the 40 dislikes downward. The rule predominantly behaved as a tiebreaker. The five-star disagreement cohort is defined as a personal rating at least one star above TMDB's raw average converted to stars. Only two of the 93 had a public average below 6/10.

## Does the personalised part improve ranking?

Compare the checked rule with uniformly shrinking the public nudge to the same amount of movement in each fold, separately for each direction. This diagnostic matches size without looking at the evaluation ratings. It is a sharper comparison than giving two methods the same theoretical cap.

| Whole-title question | Original | Uniform shrinkage | Personal agreement and check |
| --- | ---: | ---: | ---: |
| Are differently rated movies in the right order? | 61.69% | 62.41% | 62.74% |
| Are differently rated shows in the right order? | 70.05% | 70.24% | 70.58% |
| Does a liked movie outrank a disliked movie? | 73.27% | 75.25% | 74.46% |
| Does a liked show outrank a disliked show? | 83.70% | 83.65% | 83.86% |

When the checked audience nudge was added to the guarded creator/director candidate, liked-over-disliked ordering moved from 75.05% to 76.24% for movies and from 84.05% to 84.15% for shows. That sensitivity starts with already rounded native-plus-creator displays. It does not fit two interacting signals.

Hiding whole franchises instead of individual titles cost one green five-star film in the original franchise split, with another gaining green. The reassigned franchise split lost none. The chronological replay for the checked nudge lowered three of fourteen dislikes and one of forty-one disagreement five-stars, with zero green five-stars lost. All 2,619 scored appearances with no personal ratings stayed exactly at baseline.

## Limits and reproduction

The first saved TMDB average and vote count came after the last personal rating in the copied data. Even the earlier-rating panels therefore use later audience reception. The test establishes how these rules fit the archive; demonstrating forecast value needs a recorded pre-rating prediction and a contemporary audience snapshot. These data cover one account, and the 32 panels reuse titles. [Coverage and snapshot dates](../2026-11-23-taste-audience/coverage.md)

The scorer and report use only the Python standard library and the frozen private fixtures from the earlier replays. Run from this directory and provide a fresh destination for the private ledger.

```sh
python3 -B crowd_local.py CAPTURE CREDIT_METADATA VERIFIED_DATES NATIVE_GRADED NESTED_DONOR_FORECASTS GUARDED_LEAD_LEDGER NEW_PRIVATE_LEDGER
python3 -B crowd_report.py NEW_PRIVATE_LEDGER
```

[Fixed protocol](crowd-local-protocol.md) · [All 32 comparisons](crowd-local-results.json) · [Earlier method at the same cap](crowd-cap.md) · [Comparison at equal adjustment strength](crowd-strength.md)

The follow-up froze all four public-reception weights before new personal ratings. [Prospective study and coverage](prospective.md)
