# Where the profile underrates favourites

All 610 titles rated at least four stars received their underlying personal model score on the 870-title replay with the selected exact-team, personalised TMDB and margin-capped rules. The result also held in both franchise splits and for the eligible earlier-day targets. The newer penalties explain none of these low scores.

| Personal rating | Full-history titles | Median match | Lowest match | Count under 70 | Count under 80 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4 stars | 278 | 81 | 59 | 20 | 106 |
| 4½ stars | 207 | 82 | 57 | 4 | 54 |
| 5 stars | 125 | 84 | 71 | 0 | 15 |

## What lowered the scores

The seven lowest four-star works were shows catalogued solely as Comedy. Across 43 such shows, the viewer gave 12 dislikes, five neutral ratings, nine 3½-star ratings and 17 four-star ratings. The median forecast was 63 for the four-star titles and 59.5 for the dislikes. Four-star shows combining Comedy with other genres had a median forecast of 74. Differences between these groups describe the viewer and this catalogue. They do not give a causal effect for adding a genre.

We rebuilt 19 individual profiles after omitting each target’s rating and tracking. The pre-display scores for the seven lowest four-star shows were 69–72. The final calibration learned from the viewer’s other ratings converted these to 59–62, a reduction of 10–11 points on each title. Removing the Comedy input increased some forecasts and slightly decreased another. Some otherwise useful differentiating details, such as a distinctive keyword or show creator, had no other directly rated work to draw on.

The lowest five-star title was a documentary series. After removing that series, the viewer had rated four other documentary shows, all 3½ or lower. Withholding Documentary at scoring time raised the prediction from 71 to 76. Withholding its LGBT keyword lowered it to 57. Of 32 other shows with that keyword, 30 were rated above three stars. The next two five-star shows both scored 72. Withholding Comedy from them raised their scores to 81 and 79 respectively. These feature interventions are separate and do not add together.

The lowest 4½-star show scored 57. Only six other directly rated shows carried its Reality genre, none reaching four stars. Its pre-display prediction was 65. The lowest four-star film scored 71, while three five-star films tied at 76. The latter three all scored 79 before the display conversion. On those films no single feature removal raised the forecast by more than one point.

## Where the work has paid off

Compare movies with movies and shows with shows. Give half credit to a tied pair. On the full-history replay, four-star-or-better works outranked dislikes in 82.36% of pairs under the underlying personal model and 84.06% under the selected policy. Dislikes below 50 rose from zero to eight of 40. All gains in ordering came from shows. In the earlier-day replay the corresponding ordering rose from 65.13% to 67.41%, with two of 14 dislikes below 50. These are retrospective results on one viewer subjected to repeated experiments.

A separate key-substitution check repeated the exact-team witness selection and the newer same-genre person/company candidate search for all 870 targets after replacing the identifiers for titles, people, provider credits, families and genres with opaque identifiers. The same relationships and scores were recovered after undoing the substitution. This verifies independence from particular identities in those rules. Measuring predictive accuracy on another viewer is a different test.

[Selected policy](margin.md) · [Private ranking report generator](favourite_ranks.py) · [Exact native feature-removal replay](favourite-tail-trace.ts) · [Genre context](liked_tail_context.py)
