# Audience agreement and personal prediction errors

Neither conditional audience model recognised any of the 40 withheld dislikes at the below-50 threshold. Both models moved some disliked titles closer to neutral. Both also lowered films the owner rated five stars against a comparatively weak audience reception.

## Whole-title results

The replay hid each work and its actions, with 444 movie and 429 show scores. The native scorer predicted every dislike above neutral. A disagreement favourite is a five-star work whose owner rating exceeds the TMDB average by at least one star on a five-star scale. There were 56 such movies and 37 shows. All 40 dislikes and all 125 five-star titles had TMDB scores and vote counts.

| Adjustment | Dislikes below 50, movies / shows | Mean change on dislikes, movies / shows | Disagreement favourites lowered, movies / shows | Those losing green, movies / shows |
| --- | --- | --- | --- | --- |
| Medium-wide slope on native errors | 0 / 0 | −5.29 / −1.79 | 18 / 8 | 7 / 0 |
| Genre and tag slopes with medium fallback | 0 / 0 | −4.00 / −1.33 | 19 / 8 | 5 / 0 |
| Same slopes with cross-fitted agreement check | 0 / 0 | −3.86 / −1.33 | 19 / 8 | 5 / 0 |
| Strict local agreement on the same reception side | 0 / 0 | −3.57 / −1.30 | 20 / 10 | 5 / 0 |

Neither conditional model introduced any new below-50 scores for works rated at least four stars. In the strict model, five other five-star films rose into green while five left it. The net green count alone would conceal all five losses. The strict rule improved the proportion of correctly ordered dislike-versus-liked pairs from 73.27% to 73.86% in movies and from 83.70% to 85.33% in shows. The prospective status of these improvements is unknown.

## Other frozen splits

The strict local rule recovered zero additional dislikes on either franchise assignment. It cost 10 and 8 green movie favourites on those two splits, respectively. It produced no show green losses on either. The date replay identified none of the seven later movie dislikes or seven later show dislikes. Five green movie favourites crossed below 80 and no green show favourites did. The medium-fallback conditional model also recovered zero on every one of those splits.

With zero, two or ten training ratings, both policies deferred to the existing score for every item by design. On the three 50-rating whole-title masks the strict policy recovered no additional dislikes, with movie green losses of 0, 0 and 5 and show green losses of 1, 0 and 0. Missing audience scores and original abstentions retain their baseline outcome. The [32-panel primary results](personal-results.json) and [32-panel stricter results](personal-strict-results.json) include both directions of each paired favourite crossing and all score changes among disagreement favourites.

## Method and reproduction

[The first protocol](personal-protocol.md) was fixed before examining the experiment's predictions. [The strict protocol](strict-local-protocol.md) was specified after observing the first results, before running the follow-up. The strict test admits a genre or tag only when at least eight separate families support its own cross-fitted correction on the relevant low or high audience-score side, with a majority of personal residuals in the predicted direction. No global fallback qualifies a strict prediction. Neither model receives the held title’s personal rating, playback, direct favourites or reviews.

Within each outer training set, the [native replay](inner.ts) produces training predictions for the audience model. It removes the predicted work’s entire inner franchise fold for whole-title and franchise comparisons. For the dates it reuses already recorded earlier forecasts and independently cross-fits the initial rating batch before the first scoreable day. The regressions learn the error between those unexposed personal predictions and their observed star utilities. Reliability is votes / (votes + 50). Lower count means less confidence in either direction. The dataset contains a single contemporary crowd snapshot, so none of the dated tests can establish past or future predictive performance with the audience data actually available then. [Temporal coverage](coverage.md)

Set the paths to the original private account capture, verified rating dates, TMDB metadata, the independent catalogue counts and the frozen graded replay. The inner and per-title outputs include personal evidence and should stay in an owner-only directory. Each command requires a fresh output path.

```sh
bun inner.ts "$capture" "$dates" "$metadata" "$catalogue" "$graded" "$private/inner.json"
python3 -B personal.py "$capture" "$dates" "$metadata" "$graded" "$private/inner.json" "$private/personal-report.json" "$private/personal-outcomes.json"
python3 -B personal.py --strict "$capture" "$dates" "$metadata" "$graded" "$private/inner.json" "$private/strict-report.json" "$private/strict-outcomes.json"
```
