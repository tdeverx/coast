# How each score version performed

These are the frozen, five-fold whole-work comparisons for the V2 investigation. For each held-out title, Coast trained on the other folds after removing that title's rating and activity. Other training titles could contribute all their ratings unless the model itself ignored them. Each cell reports how often the model correctly ordered **all unequal ratings / 4-or-more vs 3-or-less / 5 vs 3½**, in percent. Ties receive half credit. All rows have the same paired coverage with the incumbent, 444 movies and 428 of 429 shows. This retrospective test covers one viewer. [Replay definitions](../2026-11-23-taste-v2/replay.ts) · [Metric definitions](../2026-11-23-taste-v2/evaluate.py)

| Model or controlled change | Movies | Shows |
| --- | ---: | ---: |
| Incumbent (`v1`) | 60.82 / 75.93 / 67.24 | 68.82 / 79.29 / 77.90 |
| Transparent genres and tags (`baseline`) | 57.47 / 72.53 / 61.08 | 67.87 / 77.04 / 78.62 |
| Ordered ratings with genres and tags (`ordinal`) | 57.82 / 73.77 / 62.06 | 67.25 / 78.64 / 73.57 |
| Genres, tags and themes (`descriptive`) | 57.82 / 73.77 / 62.06 | 67.25 / 78.64 / 73.57 |
| Add cast, directors, writers, creators (`people`) | 61.23 / 74.67 / 69.89 | 67.33 / 78.72 / 73.83 |
| Also add studios, networks and franchises (`companies`) | 60.76 / 73.01 / 68.66 | 68.62 / 78.14 / 78.72 |
| All metadata except the creator role (`noCreators`) | 60.90 / 71.39 / 68.34 | 69.76 / 78.15 / 79.94 |
| All verified metadata with the creator role (`metadata`) | 60.90 / 71.39 / 68.34 | 69.86 / 78.34 / 79.89 |
| Actions alone (`actions`) | 55.62 / 67.71 / 55.09 | 52.17 / 61.05 / 55.40 |
| Ratings with action evidence (`combined`) | 60.94 / 69.76 / 68.70 | 69.64 / 78.31 / 79.63 |
| Also apply supported trait-pair offsets (`context`) | 60.87 / 69.49 / 68.30 | 69.75 / 78.39 / 79.33 |
| Context without the ordered rating model (`withoutOrdinal`) | 59.65 / 61.05 / 66.34 | 66.70 / 71.95 / 79.79 |
| Context with additional viewing habits (`withHabits`) | 60.93 / 69.79 / 68.34 | 69.78 / 78.45 / 79.33 |
| Separate rating and viewing models (`personal`) | 60.77 / 74.82 / 69.15 | 69.90 / 78.45 / 79.79 |
| Add explicit strong-versus-weak contrast (`contrast`) | 61.21 / 76.14 / 69.76 | 68.80 / 78.88 / 77.39 |
| Blend ordered ratings and signed personal attributes (`balanced`) | 61.69 / 78.61 / 68.62 | 69.97 / 79.47 / 79.74 |
| Project the blend onto the viewer's rating scale (`calibrated`) | 61.69 / 78.61 / 68.62 | 69.94 / 79.38 / 79.68 |

Removing the ordered rating model from the context model cost 8.44 points on liked-versus-weak movies and 6.44 on shows. The separate people and company tests produced different results by medium. Adding people improved five-versus-3½ movie ordering by 7.83 points over descriptive traits alone. Adding companies to that model improved the same show comparison by 4.89 points. The copied metadata had no populated theme values, so this replay cannot establish a theme effect or infer the contribution of an individual actor, network or creator. [Specific trait-pair checks](exceptions.md)

The final display projection reduced weak titles scoring at least 80 from 17 to 9 movies and 25 to 13 shows relative to the raw blend. It also reduced five-star titles reaching 80 from 64 to 60 movies and 57 to 51 shows. On the strictly later rating days, the incumbent versus projected model retained 32 versus 29 five-star movies in green and 20 versus 16 five-star shows. Five-versus-3½ ordering for later shows fell from 69.78% to 65.93%, beyond the two-point guard. With no training stars, the original movie franchise split also lost 3.52 points on this comparison. The zero-, two-, ten- and fifty-rating comparisons, the two franchise assignments, intervals and genre top-twenty results are reported separately. [Acceptance and sparse-history results](../2026-11-23-taste-v2/README.md) · [Machine-readable paired measurements](../2026-11-23-taste-v2/graded-results.json)

For reproduction, run the existing evaluator on the private outputs of the replay's `full` and `graded` modes. Use the models for which `split=work` and `budget=all`. The two files agree on the incumbent and raw blend for both media, including green counts and shared coverage. Their SHA-256 digests are `2d04a161d253e5c44cb503d0442f13957fa5fef697813f04cade75f6c9c327c1` and `cb32d4dafef676b9ef9181568ed4f1bea5512d345561b6b978f12a522088d001`.
