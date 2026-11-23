# How much closer does a disliked match need to be?

Scaling the two follow-up penalties by the lead over a liked comparison preserved all eight original dislikes on the 870 hidden titles. One additional two-and-a-half-star show moved from 79 to 77. The two-star show previously moved from 74 to 40 now stays at 74. All 780 titles rated above three stars kept their scores. The earlier study's one three-star false red also kept its score.

## Comparing the evidence on its own terms

Keep the exact-team and personalised TMDB forecasts. For each previously qualifying new penalty, apply the fraction of the disliked similarity that exceeds the liked similarity. Compare personal ratings of at most 2½ stars with ratings above 3 stars. Ties, a missing side, or a closer liked work give zero penalty. The candidate item's own rating and tracking stay hidden. Round once after scaling.

- **Story, credit and plot.** The closest disliked synopsis scored 0.4677 and the closest liked synopsis 0.4487. The relative lead was 4.06%. Applying it to a proposed 39-point cut gave 77.42, displayed as 77. Normalising by the distance to the liked example instead gave 78.
- **Person and studio.** Compare genre similarity within the actual person's and company's credits. The performer comparisons were 0.500 versus 0.333. The studio produced a disliked title and a liked title both matching the target's genres exactly. The tied studio comparison gives zero weight to the joint penalty. Independently, comparing synopses alone also preserved 74.

| Holdout | Dislikes | Below 50 with retained reference | Previous full penalties | Evidence-scaled penalties | Liked titles lowered by scaling vs retained reference |
| --- | ---: | ---: | ---: | ---: | ---: |
| 870 titles, full history | 40 | 8 | 10 | 8 | 0 |
| 870, whole-franchise folds | 40 | 7 | 9 | 7 | 0 |
| 870, reassigned franchise folds | 40 | 7 | 7 | 7 | 0 |
| 382, strictly earlier rating days | 14 | 2 | 2 | 2 | 0 |

The same eight are intentionally protected. A separate control applied the plot margin to the incumbent downward corrections too, starting from the native personal model. It erased all eight below-50 predictions. The evidence behind an exact creative-team match or a personalised reception check is different from resemblance between synopses.

## What happens when personal history is incomplete?

Across 32 paired whole-franchise masks, the original eight stayed below 50 throughout. The story/credit show's scaled score ranged from 75 to 79. The person/studio show stayed at 74 in every mask. One mask removing 25% of the donor families lowered a three-and-a-half-star title from 76 to 75, versus 40 with the full penalty. No newly lowered liked title went red and no title rated four stars or higher lost a point. The incumbent model and its exact-team/TMDB scores stayed fixed in this stress test. Both secondary rules' eligible donors and nearest comparisons were reselected for each mask.

## Is a small plot lead evidence that the viewer will dislike the title?

On the full replay, 21 other eligible show families had an equally strong or stronger lead between disliked and liked synopsis comparisons. The comparison excluded the target family and the families supplying its witnesses and closest liked example. Nineteen families were liked and two were neutral. These estimate the strength of the plot clue alone. They do not measure the success rate of the full three-clue rule.

For a sensitivity check we assigned twice the cost to discouraging a title the viewer likes as to recommending one they dislike. This is an illustrative preference, not an inferred product setting. Neither the observed success rate nor a conservative lower bound justified a penalty on either named case in any primary panel or mask. The distinction matters: the relative margin can limit a proposed correction, while similarity alone has little support here as a reason to issue a warning. Both targets' recorded ratings fell outside the earlier-day evaluation cohort.

The results are retrospective and specific to one viewer. All work was offline. [Combined margin and global control](match_margin.py) · [Within-credit comparison](studio_margin.py) · [Cost-sensitive calibration](margin_reliability.py) · [Frozen eligibility and previous scores](pattern-followup.md)
