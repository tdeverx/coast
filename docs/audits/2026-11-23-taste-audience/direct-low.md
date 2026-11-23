# Direct prediction of dislikes from low audience reception

## Rule fixed before replay

This follow-up asks whether TMDB can independently identify a prospective dislike. It examines an available target in the lower quartile of its medium's TMDB reception after shrinking the score toward the catalogue median by vote count. It reuses the earlier corroboration experiment's minimum of 20 votes and reliability factor of `votes / (votes + 50)`.

For each target and original training fold, take up to 48 independently rated training families most similar by genre and tag Jaccard overlap. Each family contributes one representative and the target's own family is excluded. The lower-reception group and comparison group must each contain at least eight known families. At least two personal ratings in the lower group must be 2½ stars or less. The original corroboration rule must also find a higher rate of three-stars-or-less in the lower group with its one-sided 90% criterion.

Convert the personal ratings in the lower group to the existing star utility scale (½, 1, 2, 2½, 3, 3½, 4, 4½, 5 stars map to 0, 10, 30, 40, 50, 65, 80, 90, 100). Include one neutral pseudo-family at 50. Using one observation per family, require the mean plus 1.28155 sample standard errors to be below 50. Only then lower the candidate score, to the rounded mean. A rounded score of 50 is neutral. Missing baseline scores stay missing.

Use all 32 frozen panels, the same rating masks, and the original rating-day cutoffs. Report each gate's counts and false reds among well-liked and five-star titles. Also record how many estimates would be below neutral before applying the upper bound, without using that information to change the rule. All results with current TMDB ratings and vote counts are retrospective.

## Results

The rule made zero changes in all 32 panels. All 40 disliked titles remained above 50 on the primary holdout, and every favourite retained its original score.

| Targets passing successive requirements | All panel appearances | Whole-title movies | Whole-title shows |
| --- | ---: | ---: | ---: |
| Baseline score available | 13,477 | 444 | 429 |
| Target in lower vote-adjusted quartile | 2,893 | 82 | 106 |
| At least eight prior families in each band | 720 | 53 | 97 |
| At least two actual dislikes in the lower band | 243 | 1 | 47 |
| Reliable increase in the weak-rating rate | 225 | 0 | 46 |
| Personal lower-band mean below 50 | 3 | 0 | 1 |
| One-sided upper bound below 50 | 0 | 0 | 0 |

Different panels reuse target works. The counts across all panels measure how often the rule could act under the different training masks. On the primary show panel, the lowest observed estimate after all the relative-agreement checks was 49.29 with an upper bound of 53.78. On the chronological show panel, 17 contexts showed relative agreement but even their lowest mean was 51.32.

For a sensitivity check, the three estimates crossing 50 on their mean alone would all have produced incorrect red scores. Two appearances were titles the viewer rated at least four stars, and one was a middling title. The observed viewer tended to rate some less-popular neighbours worse *relative to other shows* while still assigning them a positive absolute rating.

The [replay](direct-low.py) uses only the original private research inputs.

```sh
python3 -B direct-low.py "$capture" "$tmdb_metadata" "$verified_rating_dates" "$native_graded_replay"
```
