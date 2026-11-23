# Should middling taste matches score higher?

Keep the selected matching rules and their current display calibration. A broad lift helps many four- and five-star titles, but moves most of the remaining disliked titles in the same direction. Requiring independent evidence can avoid that trade-off on this viewer, with little coverage.

## Results

We rebuilt 444 movie and 426 show forecasts after withholding each target’s rating and tracking. All 870 native scores matched the archived scores. We measured the display adjustment on top of the selected exact-team, personalised TMDB and similarity rules. The [protocol](soft-calibration-protocol.md) specifies which scores can move. All eight previously detected dislikes kept their exact scores. The table counts any increase in the rounded percentage shown on a card.

| Adjustment | Four stars up | Four and a half up | Five stars up | Other dislikes up, out of 32 | Newly at 80 or higher among favourites |
| --- | ---: | ---: | ---: | ---: | ---: |
| Restore a quarter of the downward calibration | 106 | 54 | 15 | 25 | 59 |
| Restore half | 106 | 54 | 15 | 25 | 59 |
| Half with one independent keyword or lead-credit pattern | 25 | 17 | 5 | 3 | 19 |
| Half with both patterns, backed by different families | 1 | 1 | 0 | 0 | 0 |
| Half when both plot and keywords identify the same past favourite | 2 | 0 | 0 | 0 | 2 |
| Half when past errors in the same score band support a lift and there are no dislikes in that band | 1 | 0 | 0 | 0 | 0 |

The half restoration raised affected favourites by 2.23 points on average. Two dislikes gained six points and one crossed from 79 to 80. The quarter restoration limited the biggest dislike increase to three points. It still raised the same 25 dislikes. Mean absolute error across all 870 titles fell from 11.20 to 11.09 under the half restoration.

## Does it hold up on the other splits?

Each cell reports the number of four-star-or-better titles that rose and the number of dislikes that rose. Both franchise splits hold out related titles together. The last column uses only ratings from earlier days and contains 382 predictions. The chronological keyword and credit checks require comparison forecasts from before either family had supplied a rating. Missing evidence makes the check abstain.

| Adjustment | Full history | Franchise split | Reassigned franchise split | Earlier days |
| --- | ---: | ---: | ---: | ---: |
| Restore half | 175 / 25 | 175 / 26 | 178 / 27 | 100 / 6 |
| One independent keyword or lead-credit pattern | 47 / 3 | 37 / 3 | 46 / 7 | 2 / 0 |
| Both patterns, different families | 2 / 0 | 1 / 0 | 2 / 0 | 0 / 0 |
| Plot and keywords agree on a past favourite | 2 / 0 | 2 / 0 | 1 / 0 | 1 / 0 |
| Clean score band with previous underestimation | 1 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

The half restoration changed how often a favourite outranked a dislike within the same medium from 84.06% to 84.24% on full history, 80.78% to 80.40% and 84.34% to 84.07% on the franchise splits, and 67.41% to 67.10% on earlier days. Rounded ties receive half credit. A better mean absolute error on one account does not establish better ordering on new titles.

Many favourites and dislikes have identical raw and displayed scores within the same medium. Some also received those scores from the exact same trained model in a held-out franchise group. A new display curve cannot distinguish those pairs. The next useful experiment would need information that distinguishes their contents or the viewer's past interactions with similar works.

[Exact refit](pre-display-holdout.ts) · [Display and content comparisons](soft_calibration.py) · [Past-error and plot comparisons](calibration_outcome_guard.py)
