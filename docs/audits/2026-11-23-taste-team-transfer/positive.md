# Can enthusiasm for a creative team repair a missed favourite?

The positive counterpart raised 33 of the 873 whole-title scores. All 14 raised movies were already green and personally rated four stars or higher. Of the 19 raised shows, 16 were already green. Two four-star shows moved into green, along with one three-star show. No strict dislike gained points. Across all 32 panels, the positive arm recovered zero withheld five-star favourites that started below green.

Each eligible donor received at least 4½ stars from the viewer and shared the identical lead team and at least half its combined genres with the target. Any lower prior rating from that team outside the target's own franchise vetoed the boost. The boost transfers an independently predicted donor's personal error. The negative half of the symmetric comparison uses a direct rating of at most 2½ stars. [Fixed protocol](positive-protocol.md)

| Primary whole-title test | Targets raised | Distinct teams | Five-star titles repaired | Newly green liked / weak titles | Within-fold order before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Movies, one donor franchise | 14 | 7 | 0 of 6 | 0 / 0 | 61.69% → 61.68% |
| Shows, one donor franchise | 19 | 14 | 0 of 8 | 2 / 1 | 70.05% → 69.62% |
| Movies, two donor franchises | 3 | 1 | 0 of 6 | 0 / 0 | 61.69% → 61.79% |
| Shows, two donor franchises | 1 | 1 | 0 of 8 | 0 / 0 | 70.05% → 70.03% |

Green starts at 80. Liked means four stars or higher and weak means three stars or lower. A boost indicated by an enthusiastic opinion sometimes pushed a four-star work to 100. Across whole titles twelve forecasts reached 100 from below. The viewer had rated five of them five stars, five between four and 4½, and two between three and 3½. The size of the transfer mattered even among clearly liked titles.

Across the full 32 comparisons, no favourable boost fell back on popularity or the audience. It changed zero scores on zero-rating and two-rating samples, four appearances across the ten-rating samples and 31 across the 50-rating samples. None of the changes repaired a missed five-star item. Requiring independent evidence about the boost's size from eight *other* creative teams produced zero score changes in every panel. A team entirely absent from training necessarily supplied no direct evidence.

## Does this run forward?

When all donor opinions were strictly earlier than the hidden rating day, three films and eight shows received a positive adjustment. All eleven already had green scores. The film pair-order measure slipped from 55.06% to 54.89%, and the show measure rose from 60.47% to 60.58%. Requiring the donor's own baseline forecast also to have been made in the rolling evaluation, excluding the reconstructed initial ratings batch, left just one boost on one show. It was already green. Both are retrospective sequences of earlier personal opinions with contemporary credit metadata. They supply no prospective observation after the model was frozen.

The symmetric one-donor arm reproduces the four previously identified low scores on shows. It adds the positive changes above, including the three-star show crossing into green. In the date panel the single previously identified dislike survives, and the positive half adds no new green titles.

## Comparisons with similar, unboosted titles

An exploratory matched check looked for other-team titles in the same held fold, within three baseline score points and at least half genre overlap. Every one of the 33 primary targets had matching controls. The 14 films averaged 4.54 personal stars, against 4.29 for their matched works (27 distinct controls). All 14 had at least four stars versus 82% of controls when weighted per target. Equal weighting of the seven participating teams gave a target/control comparison of 4.37/4.15 stars. The matched film difference was positive on both franchise partitions as well. A familiar director making similar films appears useful as an explanation of an already-green film match on this account.

The 19 shows averaged 4.18 stars against 4.13 among their controls (46 distinct controls). Giving each team equal weight reversed the small difference to 4.04/4.16. No eligible same-day comparisons were available for the changed titles on the date panels. These descriptive comparisons reuse controls and cannot validate a point adjustment on future titles. [Matched comparison](positive-matched.py) · [Paired results](positive-matched-results.json)

## Story-world overlap

Different catalogue franchise identifiers do not guarantee unrelated stories. For example, an original series and its named spin-off can occupy separate catalogue roots. After spotting this in private examples, we excluded potential donor pairs with missing or overlapping cast, spin-off keywords, shared universe keywords or identical first meaningful title tokens. This sensitivity left nine raised films and two raised shows on the primary split. All eleven were already green. It eliminated all changes in the stricter forward-donor comparison.

It also excluded both earlier negative pairs because both shared a cast member. Shared casting can be a genuine feature of an unrelated production team, so this conservative sensitivity cannot by itself disprove the original negative clue. [Identity sensitivity](positive-independent-results.json)

The positive scores and individual green transitions were independently recounted across all 32 panels. A second full execution exactly reproduced the original result. Use the original private inputs and full sparse donor forecasts from the [authorship audit](../2026-11-23-personal-dislike-signals/lineage.md).

```sh
COAST_POSITIVE_PRIVATE="$new_private_predictions" python3 -B positive.py "$solo_capture" "$metadata" "$dates" "$graded" "$lineage_inner"
python3 -B positive.py --independence "$solo_capture" "$metadata" "$dates" "$graded" "$lineage_inner"
python3 -B positive-matched.py "$solo_capture" "$metadata" "$graded" "$new_private_predictions"
```

[Positive and symmetric results](positive-results.json) · [Replay implementation](positive.py)
