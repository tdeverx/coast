# Does TMDB reception help predict a personal rating?

The retrospective comparison covered 444 movies and 426 shows rated directly by one viewer. Each prediction used a personal profile rebuilt with the title's entire history withheld. For a show, that included activity aggregated from its episodes. Predictions used the remaining history, personal evidence from shared creators and executive producers, and TMDB votes fetched on 23 November 2026. All 870 titles had a current audience score and vote count. Three additional catalogue roots had indirect ratings and were excluded from the comparison.

## Direct blends

Ordering is the percentage of differently rated pairs within a medium for which the higher-rated title received the higher prediction. Ties count half. Error is the mean absolute distance in points from the viewer's rating on Coast's 0–100 utility scale. Green starts at 80. Of 125 five-star titles, 110 started green. The 40 dislikes were rated 2½ stars or lower.

| Nominal TMDB share | Mean error | Movie ordering | Show ordering | Dislikes below 50 | Five-stars leaving / entering green |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0% | 11.366 | 61.48% | 70.44% | 0 | 0 / 0 |
| 5% | 11.284 | 63.35% | 71.45% | 0 | 2 / 0 |
| 10% | 11.247 | 64.74% | 72.13% | 0 | 10 / 1 |
| 20% | 11.360 | 66.22% | 73.45% | 0 | 27 / 1 |
| 40% | 11.974 | 66.72% | 74.10% | 0 | 41 / 1 |
| 100% | 15.967 | 65.25% | 69.91% | 2 | 76 / 1 |

TMDB helped sort titles, particularly at the 20% and 40% settings. That improvement came with a cost to the displayed match. At 40%, 32 dislikes moved down, yet all 40 still scored at least 50. Of the 93 five-star titles rated at least one star above public reception, 92 moved down. On the simpler scale of stars multiplied by 20, the mean error also rose from 9.55 to 10.36 points. The 95% franchise-resampled interval for the change in Coast-scale error was −0.21 to +0.19 points at 20% and +0.22 to +0.99 at 40%. These intervals describe this account.

## Public reception as a small adjustment

The alternative used up to twelve other rated franchises with similar genres or tags. Agreement between the viewer and TMDB, vote count, and past prediction errors on those comparisons limited the change to the personal score.

| Maximum adjustment | Mean error | Movie ordering | Show ordering | Dislikes down / up | Five-stars leaving / entering green |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 4 points | 11.305 | 62.34% | 70.81% | 1 / 1 | 0 / 1 |
| 8 points | 11.211 | 63.32% | 71.16% | 9 / 3 | 1 / 2 |

At the eight-point limit, 175 estimates moved closer to the actual rating and 75 moved further away. Every dislike still scored at least 50. The four-point limit preserved every previously green five-star. The eight-point version is worth recording alongside the existing prediction. The size of its improvement and the single-account sample favour keeping the existing displayed score.

The vote count reduces the actual public share in each direct blend. Both methods used today's public reception and the rest of the account's history. Their results answer the retrospective question about a hidden known rating. New ratings can independently test whether the observed advantage carries forward.

[Native holdout procedure](native.md) · [Weight comparison and uncertainty procedure](blend-protocol.md)
