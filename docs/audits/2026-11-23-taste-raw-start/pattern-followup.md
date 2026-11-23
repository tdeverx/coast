# Personal patterns behind the remaining optimistic matches

Three comparisons on different works identified one more disliked show while preserving every liked score in the full-history replay. The result depends on how Coast compares plots, and a liked show turned red in one incomplete-history replay. Keep the exact creative-team rule and personalised TMDB check as the reference. The two newer signals are offline comparisons. No scoring policy changed in this study.

| Held-out predictions | Dislikes | Retained reference | With the previous person/studio test | Also requiring a separate disliked plot comparison for a story/credit penalty |
| --- | ---: | ---: | ---: | ---: |
| All 870 films and shows | 40 | 8 | 9 | 10 |
| Original franchise folds, 870 | 40 | 7 | 8 | 9 |
| Reassigned franchise folds, 870 | 40 | 7 | 7 | 7 |
| Earlier rating days only, 382 | 14 | 2 | 2 | 2 |

Cells count actual dislikes with a forecast below 50. Both gains in the original franchise folds concern the same two titles as in the full replay. No score for a title rated above 2½ stars moved in these four comparisons. This includes all 780 full-history titles rated at least 3½ stars. The previous three-star false red stayed in place. These are one viewer's development results on repeatedly studied titles.

## What separated the additional dislike from two liked shows?

In the initial test, a specific story keyword and a verified person or company each had to point to a **different** personally disliked family in a similar genre. Matching the genre uses the existing one-half Jaccard threshold. Eligible personal ratings for each clue had to agree, with known, disjoint lead credits across its witnesses. This caught one two-and-a-half-star show, but also made a three-and-a-half-star film and a four-and-a-half-star show red.

The follow-up asked whether a third source of personal evidence agreed. The closest unrelated synopsis had to come from another disliked family with verified lead credits independent of the other witnesses. The two liked titles' closest plots both had positive personal ratings, protecting their scores. The disliked show's keyword, studio and plot each traced to a different low-rated show. Its forecast fell from 79 to 40. The 40 comes from other titles' rating utilities. Its magnitude has no independent calibration here. [Story, credit and plot replay](story_credit_corroboration.py)

The third check was suggested by the observed error. The nearest disliked plot had similarity 0.468, only slightly above the nearest four-and-a-half-star show's 0.449. All three supporting ratings came from the target's own recorded rating day. Omitting any one family removed the prediction. A second, label-blind plot comparison using catalogue word frequencies picked a different four-and-a-half-star show and preserved the original 79. The semantic and lexical estimates repeated their respective outcomes on the original franchise split. A separate check requiring Coast's more pessimistic personal score to agree recovered zero additional dislikes on the full replay. [Lexical comparison](lexical_synopsis_check.py) · [Personal score comparison](personal_second_opinion.py)

## Missing history can remove a correct call or introduce a wrong one

We kept all 870 prediction targets and the retained exact-team/TMDB forecasts. For each of 16 deterministic seeds at each fraction, we masked other whole franchises from the **two additional** signals, then rebuilt their eligible comparisons and nearest plots from scratch. Even targets with no earlier change could acquire a new forecast. The masks are paired across the two rules. This isolates their reliance on missing opinions. No underlying personal model was retrained during this stress test.

| Franchise mask | Previous studio gain present | Additional plot gain present | Both gains present | Total dislikes below 50 | Masks newly lowering a liked title |
| --- | ---: | ---: | ---: | --- | ---: |
| 10% | 11/16 | 15/16 | 10/16 | Nine in 6 masks, ten in 10 | 0/16 |
| 25% | 6/16 | 9/16 | 4/16 | Eight in 5 masks, nine in 7, ten in 4 | 1/16 |

In that last mask a three-and-a-half-star show's original 76 fell to 40. Hiding a four-star plot comparison allowed a disliked plot to take its place and agree with an unrelated cast and keyword clue. No four- or five-star forecast fell in these masks. The 16 seeds describe sensitivity to this particular history. They are not 16 independent viewers. [Studio rule masks](credit_family_masks.py) · [Story, credit and synopsis masks](story_credit_mask.py)

## Other patterns checked

| Personal pattern | What happened |
| --- | --- |
| Story traits that are individually liked but jointly disliked | Ten of the remaining 32 had two disliked precedents. All ten also had positive or middling counterevidence in the joint context. Requiring repeated independent negative families and checking positive exceptions recovered zero more. The looser rule wrongly rejected a four-star show and a four-and-a-half-star film. |
| Strong positive exceptions within a usually disliked category | The strict four-point nudge raised four police dramas. All four moved farther from their actual ratings. A looser nudge moved six five-stars into green and raised 13 actual dislikes. The small improvement in overall error hid the cost to the lower end. |
| A sequel changes director after the viewer liked the preceding entry | Both director-change and continuing-director examples usually received four stars. Neither condition recovered a dislike. Comparisons use only other verified film families. |
| Repeated opinions on a particular composer's or cinematographer's work | Only two of 40 dislikes had two comparable independent families with the same identified craft credit. No hidden target had two disliked families supplying that signal. |
| Preference for a weekly premiere or a same-day release in otherwise similar shows | Episode air dates and personal ratings supported at least three genre- and era-matched pairs for 306 full-history targets, including 18 remaining dislikes. The strict rule made zero changes. A bounded four-point nudge lowered eight liked shows and increased mean absolute error in every panel. Movies abstained. |

[Story combinations and positive exceptions](story_conjunction.py) · [Director changes](franchise_transition.py) · [Craft credits](craft_context.py) · [Release schedules](release_cadence.py)

For reproduction, supply the frozen [retained panels](retained_panels.py) and the preceding [person/studio result](corroborating-credits.md) to the linked scripts. Each script identifies its remaining inputs with `--help`. Individual predictions and account history stay in owner-only local result files. The tests use existing local metadata and do not contact providers.

The [similarity-margin replay](margin.md) compares the full penalties with partial reductions when a liked title is nearly as close.
