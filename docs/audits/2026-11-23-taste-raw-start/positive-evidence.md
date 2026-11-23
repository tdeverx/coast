# When public reception disagrees with personal taste

Keep the exact creative-team rule as the personal baseline. On the same 870 hidden titles, the strongest public-reception candidate retained the **same eight dislikes** below 50 and left **all 780 titles rated 3½ stars or higher at their original personal score**. One three-star show fell below 50. The independent unit here is one viewer, and the four additional correct calls all concern related sitcoms.

## How a small public adjustment caused a large error

The old rule first removed two positive components of the personal score to produce an alternative estimate. When the TMDB average was below neutral and the viewer usually agreed with the public about which comparable films were better, any negative adjustment could authorise the entire alternative score. The two affected films moved by 26 and 25 points on adjustments of only −1.29 and −0.66. The viewer had disliked zero of the twelve comparison films in either case. A preference between two well-liked films was enough to satisfy the direction check.

The new check estimates **how much the viewer usually rates comparable, poorly received titles above or below the public**. It uses the weighted median difference between personal utility and vote-adjusted TMDB utility. For the comparison, use up to twelve independent franchises, weighting genre/tag similarity and public vote count. Count each family once. At the cutoff, equally similar families share the available places. Apply this tie handling to both the existing direction check and the new estimate. Require at least two eligible comparison families, exclude the target family, and restrict the chronological replay to ratings from strictly earlier dates.

If the personalised public estimate reaches 50, keep the original personal score. If it remains below 50 and the other existing checks agree, allow the proposed red score. This happens only on the public branch. A separate exact-team correction retains priority. Both false-red films kept their original scores of 65 and 74. Their personalised public estimates were 68.1 and 69.8, respectively. The estimated values are used to check the direction of the downgrade, so they do not replace the personal score.

## Results

All rows below use the same 870 directly rated works, including 40 dislikes and 125 five-star favourites. The last two columns count any decrease in score, even when it stays above 50.

| Method | Dislikes below 50 | Three-stars below 50 | 3½-star titles lowered | Four-star-or-higher titles lowered |
| --- | ---: | ---: | ---: | ---: |
| Exact creative team alone | 4 | 0 | 0 | 0 |
| Exact team plus previous public check | 8 | 5 | 4 | 2 |
| With personal public-rating difference and deterministic ties | 8 | 1 | 0 | 0 |
| Require the rounded adjusted public estimate to support the size of the downgrade | 7 | 1 | 0 | 0 |

The eight correct low predictions were the identical eight from the previous public check. Each had a personal rating of 2½ stars. Neither method identified a deeper dislike on this replay. The last row is an exploratory follow-up that uses the higher of the two supported estimates, and retains the baseline if the adjusted public estimate rounds to neutral. One true case had an adjusted estimate of 49.74. That explains the change from eight to seven.

| Same viewer, alternative evidence available | Dislikes below 50 | Three-stars below 50 | 3½-stars below 50 | Four-star-or-higher lowered |
| --- | ---: | ---: | ---: | ---: |
| One complete target hidden, 870 titles | 8/40 | 1 | 0 | 0 |
| Whole franchises withheld together, 870 titles | 7/40 | 2 | 0 | 0 |
| Whole franchises reassigned to different folds, 870 titles | 7/40 | 1 | 1 | 0 |
| Earlier rating days only, 382 titles | 2/14 | 0 | 1 | 0 |

The earlier-day check used current TMDB reception and strictly earlier personal ratings. One of the two recovered films was outside that test, and the original scorer already kept the other above 50. The dated results therefore check other titles. The 3½-star false red in the reassigned and earlier-day tests was the same show.

The extra four low forecasts draw on overlapping comparison shows. As a stress test, excluding all eight original hits from **both public comparison sets** on the full-history replay left the four exact-team hits. The exact branch itself and its training evidence were held fixed. Keep the public guard in parallel evaluation. Its most consistent benefit in this replay is preserving highly rated titles.

## Other checks

- A positive rating on a different franchise entry restored both films in the full-history replay. Relevant sequel ratings arrived seconds after each original rating in the same logging batch. This gives the viewer evidence today, with limited value for evaluating what Coast would have known before those ratings.
- Requiring at least one disliked comparison or checking the single closest personally liked exception each preserved all eight on the fixed history. These guards left more three- and 3½-star false reds. Requiring the median estimate to indicate a full 2½-star dislike removed all four extra correct calls. These controls measure the cost of changing what counts as sufficient evidence.
- Breaking ties by catalogue ID can select different witnesses for identically tagged shows. Randomising this otherwise arbitrary tie order retained all eight on only 95 of 256 repetitions for the median rule. Sharing cutoff places across tied families removes dependence on the identifier.

[Study protocol](positive-evidence-protocol.md) · [Personal offset and replay](public_bias.py) · [Fractional tie handling and stress tests](peer_witness.py) · [Franchise-held checks](public_bias_franchises.py) · [Magnitude check](public_strength.py) · [Positive franchise control](personal_veto.py) · [Nearest disagreement control](public_exception.py)
