# Evidence for the 32 remaining misses

The exact-team rule and personalised TMDB check put eight of 40 verified dislikes below 50 on the 870-title replay. The audit verifies those eight title IDs against a frozen digest, then joins the other 32 to their [original matched five-star comparisons](../2026-11-23-personal-dislike-signals/pairs.md). The comparison favourite was selected for explanation after grading. Neither the target's tracking nor its rating enters the prediction.

| Matched evidence | Result |
| --- | ---: |
| Missed movies / shows | 7 / 25 |
| Distinct matched five-stars | 25 |
| Miss scored below / tied / above its five-star comparison | 24 / 2 / 6 |
| Median score on the misses | 75 |
| Misses scoring at least 70 | 22 |
| Recurring positive traits exclusive to the miss / five-star side | 23 / 32 titles |
| Recurring negative traits exclusive to the miss / five-star side | 2 / 0 titles |

The original analysis counted other directly rated families outside the comparison fold and excluded both comparison franchises. Of the two misses with recurring negative traits, one had a cast and a studio clue supported by different titles. The other had a network clue. Every negative witness for those two was rated on the same recorded day as the target or later. Neither pattern could have predicted the original recorded rating day.

The private output also searches beyond the original comparison fold for the closest unrelated 4½–5-star and low-rated titles. Similarity weights tags and themes twice, studios and networks at 0.6, and genres and personal credits at one. It scales by descriptor rarity in the directly rated sample and normalises by the feature weights of both titles. These examples describe metadata overlap. They have no effect on the prediction.

## Does the viewer usually dislike unscripted entertainment?

The format test groups shows carrying the Reality or Talk genre or an explicit game-show, talent-show, reality-show or talk-show tag. Documentaries form a second group when the first does not apply. The original eight stay below neutral. For each other target the test uses only eligible ratings from unrelated franchises, counting a family once. It requires two independent low-rated families and then tries either a strict majority of dislikes or a median below three stars. A qualifying score crosses to 49.

| Split | Majority: extra dislikes / liked wrongly lowered | Median: extra dislikes / liked wrongly lowered |
| --- | ---: | ---: |
| Whole history, target and relatives hidden | 0 / 3 | 0 / 3 |
| Earlier recorded days only | 0 / 0 | 0 / 0 |
| Original franchise folds | 1 / 2 | 1 / 2 |
| Reassigned franchise folds | 0 / 2 | 1 / 3 |

Each non-chronological arm also lowered one three-star show. The full sample contains eight unscripted entertainment shows with four dislikes, three likes and one neutral. Removing a disliked target leaves three low views in seven. Removing a liked target leaves four in seven, enough to reject the viewer's own liked title. The four other documentaries had no disliked title. The evidence does not justify a format penalty.

## Reproduce

Run [residual_pairs.py](residual_pairs.py) with the same private inputs used for the retained baseline. Its last three inputs are the private named output of [pairs.py](../2026-11-23-personal-dislike-signals/pairs.py), the verified credits metadata used by that script, and a new output path. The output retains names, dates and ratings for local review and is created with owner-only permissions.

```sh
python3 residual_pairs.py CAPTURE GRADED VERIFIED_RATINGS FULL_TEAM MOVIE_RAW SHOW_RAW \
  ARCHIVED_TEAMS EARLIER_RAW FRANCHISE_RAW TIE_WITNESS NAMED_PAIRS METADATA NEW_PRIVATE_OUTPUT
```
