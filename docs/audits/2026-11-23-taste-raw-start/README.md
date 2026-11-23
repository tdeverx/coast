# Why generous predictions survive negative evidence

An offline replay compared the same 444 movies and 426 shows directly rated by one viewer. Each native forecast was rebuilt with the target's entire personal history removed. The 40 dislikes include seven movies and 33 shows. The 125 favourites each received five stars. The results below use ordinary catalogue descriptions and current TMDB votes.

## What remains when three positive traits are hidden

On the example show, withholding its own record put the native prediction at 77. Also hiding the sci-fi genre, space tag and one cast member put it at 70. Three steps explain the remaining score.

1. The rating model learned a typical score of 70.95 from other shows before accounting for this show's traits. Its remaining metadata lowered the rating estimate to 66.71. Across the other 425 directly rated shows, the viewer had given 284 at least four stars.
2. The viewing component scored 64 and had just 1.38% of the rating-and-viewing mixture. That mixture came to 66.96. The personal score's built-in upper-half mapping then moved it to 70.35, displayed as 70 in this component.
3. A second calculation pooled affinities learned from the viewer's history. It still scored the remaining genres at 78, tags at 80 and cast at 78. Together they had about 84% of this component's weight. Its output was 83. The two components were equally weighted and rounded to 77. The final mapping learned from held-out ratings lowered that to 70.

Both calculations reward overlapping preferences from the same account. They already produce a high score before the final display mapping or any public audience adjustment. A 70 here represents strength of fit on Coast's scale.

## Restoring the earlier creative-team rule

The narrow rule requires the same set of lead creators or directors, similar genres, and no conflicting opinion among the viewer's other directly rated works from that team. It transfers the amount by which Coast overestimated a comparable title. Both the target and the comparison's franchise were withheld when estimating that error. The earlier small creator/producer adjustment was a separate experiment.

| Full-history method | Dislikes below 50 | Five-stars lowered | Five-stars leaving green | Four-star-or-better titles below 50 | Mean error |
| --- | ---: | ---: | ---: | ---: | ---: |
| Personal score | 0 | 0 | 0 | 0 | 11.407 |
| Exact creative team and genre | 4 | 0 | 0 | 0 | 11.285 |
| Exact team with public veto on a penalty | 4 | 0 | 0 | 0 | 11.285 |
| Exact team plus capped four-point public adjustment | 4 | 3 | 0 | 0 | 11.224 |
| Exact team plus capped eight-point public adjustment | 4 | 7 | 1 | 0 | 11.124 |
| Exact team plus 20% public blend | 4 | 100 | 30 | 0 | 11.320 |
| Exact team plus 40% public blend | 3 | 108 | 44 | 0 | 11.962 |

The four recovered dislikes came from two pairs of shows. Each had one negative comparison with the identical creative team when the target was withheld. Each pair supplied both directions of the apparent success. The strict rule changed no other prediction in this account. The previous chronological replay supported one direction where the comparison had already been rated. Tests on other viewers found that transferring an entire error from one film to another can hurt genuinely liked films. [Earlier work and external validation](../2026-11-23-taste-team-transfer/README.md)

## Can TMDB rescue a mistaken personal penalty?

In the archived alternate-franchise split, allowing one returning creator across different teams pushed a 4½-star show from 71 to 30. An eight-point cap brought it back to 32. A direct 40% blend brought it to 53. Allowing strong, well-supported public reception to veto the personal penalty restored the original 71. The example the strict rule correctly lowered stayed at 44. The same safeguard restored 28 to 73 on a sparse-rating split for the **same** viewer-title. On the ordinary whole-title split the strict rule already separated these titles at 43 and 70.

Across the original 32 panels, the wider team rule recovered the same dislikes as the exact-team rule. On the full-history replay a different crew-similarity test wrongly moved four other ratings below 50 and identified zero dislikes. A public veto rescued one of the four. A broad public blend penalised many five-star titles. The evidence favours keeping the narrower rule as a candidate and recording a veto separately.

## Changing the starting score directly

Every one of the 870 rebuilt baseline scores matched its saved prediction. Removing the favourable rating intercept on downward evidence alone caught zero dislikes below 50 and lowered 16 five-stars. Suppressing the upward contribution of the affinity calculation alone also caught zero and lowered 74 five-stars. Removing both together produced a lower tail, including many titles the viewer liked.

The public corroboration test allows a newly red prediction from the two removals only when the vote-adjusted audience rating is also below neutral and past comparisons with similar independently rated titles support a downward adjustment. It leaves other predictions in place. The last row gives the narrow exact-team rule priority, then tests the remaining titles for that public corroboration.

| Change | Dislikes below 50, of 40 | Middle ratings below 50, of 220 | Four-star-or-better below 50, of 610 | Five-stars lowered / leaving green | Mean error |
| --- | ---: | ---: | ---: | ---: | ---: |
| Existing score | 0 | 0 | 0 | 0 / 0 | 11.407 |
| Remove both sources of upward pressure | 14 | 35 | 27 | 77 / 14 | 14.955 |
| Exact team alone | 4 | 0 | 0 | 0 / 0 | 11.285 |
| Public corroboration alone | 4 | 9 | 2 | 0 / 0 | 11.366 |
| Exact team, then public corroboration | 8 | 9 | 2 | 0 / 0 | 11.244 |

The additional four correct calls all concerned shows. The two incorrect calls on highly rated titles were movies rated four and 4½ stars. Preserving every five-star prediction can conceal errors on titles the viewer enjoyed. A second replay used only personal rating days preceding each target (382 forecasts, including 14 dislikes). Exact team alone found one dislike, and adding corroboration found two. Together they also marked three middle ratings red. Every four-star-or-better title stayed above the red boundary in the earlier-day replay. Current TMDB reception was used in both comparisons.

Keep the existing raw scorer. The strongest candidate for preserving personal favourites on this account is the narrow creative-team correction. Additional publicly corroborated changes merit comparison on independent ratings before exposing them on cards.

The follow-up retained the exact creative-team rule and added a check for the viewer's own disagreements with weak public reception. [Protecting liked titles on the same holdouts](positive-evidence.md)

[Method and cohort definitions](protocol.md) · [Exact native component replay](raw-holdout.ts) · [Public corroboration comparison](raw_public.py) · [Exact-team replay](team_audience.py) · [Archived failure replay](archived_teams.py) · [Crew-similarity comparison](production-peer.py)
