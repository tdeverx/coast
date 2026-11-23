# Limiting the earlier audience adjustment to four points

The earlier [strict genre and tag rule](../2026-11-23-taste-audience/strict-local-protocol.md) estimates how much public reception helps predict this viewer's personal ratings and Coast's errors on other titles. This control changes only its maximum effect, to four percentage points in either direction. The four-point limit was selected before inspecting this comparison.

## Whole-title predictions

The original native score, original audience rule and bounded audience rule evaluated the same 873 titles. With the bounded rule, 27 of the 40 dislikes fell, 9 held their score and 4 rose. All remained at 50 or higher. Of 125 five-star favourites, 30 fell, 16 held their score and 79 rose. All 30 decreases were among the 93 favourites the viewer rated at least one star above the audience. Five previously green favourites fell below 80, and five others reached 80. The uncapped rule produced the same counts. No four-star-or-higher title fell below 50.

| Test | All differently rated movie pairs ordered correctly | All differently rated show pairs ordered correctly | Liked movie above disliked movie | Liked show above disliked show |
| --- | ---: | ---: | ---: | ---: |
| Native only | 61.69% | 70.05% | 73.27% | 83.70% |
| Original strict audience adjustment | 68.38% | 73.66% | 73.86% | 85.33% |
| Four-point audience adjustment | 67.78% | 73.46% | 73.07% | 85.57% |
| Guarded leads only | 61.91% | 70.20% | 75.05% | 84.05% |
| Guarded leads plus the same four-point audience adjustment | 67.73% | 73.51% | 73.27% | 85.89% |

Applying the same adjustment on top of the guarded-lead score still lowered 30 disagreement favourites, and five lost green. Reducing the size of a move cannot protect a favourite sitting close to a colour threshold.

## Date and franchise checks

On the dated panels the cap lowered seven of 14 dislikes, left five unchanged and raised two. None went below 50. Eleven of the 41 disagreement favourites fell, including five that lost green. Applying the same audience changes on top of the guarded-lead score cost four green favourites. On the two alternative held-franchise splits, nine and eight previously green favourites fell below 80 with the bounded rule. Both splits had zero recovered dislikes and zero new red predictions on four-star-or-higher works.

The original rule respects the outer masks and earlier personal rating dates and independently scores the donor families. It does not explicitly remove every other member of the target's franchise when fitting local crowd agreement on whole-title or date splits. The fitting sample included a relative for 137 of 444 whole-title movies (two of the seven dislikes) and 16 of 194 dated movies (one of the seven dislikes). No show in either split had this overlap. Both held-franchise splits excluded relatives from the fitting sample for all titles. Comparing against a new family-excluding method on the franchise splits avoids this difference. The saved provider observations followed all of this account's verified ratings, so the dated replay uses retrospective crowd data.

## Reproduction

The earlier strict forecasts were all interior integer scores, ranging from 54 to 95. Rounding before clipping to the integer interval from baseline minus four to baseline plus four gives the same displayed score as clipping the raw correction first. This also holds when adding the correction to the displayed guarded-lead baseline. The replay verifies the identity, rating and native score for every one of the 13,477 scored appearances in the 32 panels. Only grouped counts and measures are published. [All panel outcomes](crowd-cap-results.json) · [Control code](crowd-cap.py)

```sh
python3 -B crowd-cap.py PRIVATE_STRICT_AUDIENCE_OUTCOMES PRIVATE_GUARDED_LEAD_OUTCOMES ORIGINAL_GRADED_PANELS
```
