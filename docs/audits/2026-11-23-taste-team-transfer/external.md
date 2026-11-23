# Independent viewers' earlier ratings of the same movie directors

The copied Coast DB contained two profiles with any movie/show ratings. Only the original account had 25 ratings and a dislike. We therefore tested movies on anonymous MovieLens viewers, with strictly earlier ratings from each individual. The stable 25M sample disproved a promising seven-opportunity pilot: a prior disliked movie by the same director in similar genres identified some subsequent dislikes, but it also reduced the score of many films that those viewers liked.

## Frozen one-donor rule

We selected one sixteenth of the stable MovieLens 25M release by a fixed hash of the viewer ID. Of 10,044 sampled viewers, 2,734 had 25 prior ratings and a separate later rating day at their 80% chronological cutoff. Their 297,010 held-out ratings included 64,137 dislikes and 127,180 films rated four stars or higher. The full, publicly identified director team, Coast genre and collection data were usable on 52,739 held-out ratings. Some 17,599 had previous ratings from the same director outside the target’s franchise. Requiring those earlier opinions to be consistently negative, a half-overlap of genre sets, concordant source credit IDs and donor residuals produced only 177 qualifying predictions. [Protocol](external-protocol.md)

| Check | Qualified predictions | Changed | Correctly crossed below 50 | Four-plus wrongly crossed below 50 | Middling wrongly crossed below 50 | Five-star scores lowered |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small pilot, one prior family | 7 | 6 | 2 | 0 | 0 | 0 |
| Stable 25M, viewer group 0, one prior family | 177 | 167 | 23 | 29 | 36 | 4 |
| Stable 25M, viewer group 0, two prior families | 7 | 6 | 0 | 1 | 0 | 0 |

The 167 reductions involved 133 viewers and 38 distinct director teams. The 23 newly identified dislikes came from 21 viewers and 18 teams; the 29 liked false reds came from 27 viewers and 19 teams. None of the four five-star reductions left green; the green count alone misses those changes. Of the 167 adjustments, 49 moved closer to the viewer’s eventual star utility, 116 farther and two stayed equally distant. The average absolute error grew by 11.83 fit points over all 177 opportunities. A generic likelihood of personal dislike is insufficient justification for transferring the full magnitude of the previous prediction error.

The pilot used the separate MovieLens latest-small archive and was even less conclusive: only 168 viewers with 18,286 later ratings met the date requirement, and all seven qualifying targets were actual dislikes. Four of the six changed predictions were already red. GroupLens releases can share users and movies, so their numbers are kept separate. The 25M benchmark is the primary external test. [Stable public benchmark](https://grouplens.org/datasets/movielens/25m/) · [Pilot dataset](https://grouplens.org/datasets/movielens/latest/)

## Disjoint 25M viewers and a gentler adjustment

We fixed the shrinkage rule before seeing this group's outcomes. There were 2,693 eligible viewers, 280,575 later ratings and 192 one-family opportunities. All 147 viewers with a proposal were verified to be disjoint from the original proposed cases by the prespecified hash. The full shift still marked many liked or middling titles as personal dislikes. The softer alternative applies half the previous prediction error for one donor family and two thirds for two.

| Minimum prior families and transfer | Opportunities | Correct new red | Four-plus false red | Middling false red | Five-stars lowered / newly red / left green | Mean absolute fit error, before → after | Closer / farther / same-distance among changed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| One, full | 192 | 26 | 18 | 52 | 5 / 2 / 1 | 17.13 → 23.81 | 61 / 114 / 3 |
| One, reduced | 192 | 18 | 11 | 34 | 5 / 1 / 1 | 17.13 → 16.93 | 85 / 88 / 3 |
| Two, full | 7 | 1 | 1 | 0 | 0 / 0 / 0 | 20.00 → 16.43 | 3 / 3 / 0 |
| Two, reduced | 7 | 1 | 1 | 0 | 0 / 0 / 0 | 20.00 → 16.43 | 3 / 3 / 0 |

The 192 proposed matches were indeed enriched for dislikes: 90 were rated 2½ or below. They also included 76 middling opinions and 26 highly rated films including five five-stars. The reduced rule's modest mean error improvement came with 45 incorrectly introduced red scores across the middling and liked groups. Raising the minimum donor count left seven cases and still permitted a liked false red. Keeping this evidence informational avoids overstating one creative team's ability to predict an individual movie. [Full confirmation results](external-25m-confirmation.json)

The identical full team transfer both identified a dislike for one viewer and marked a different viewer’s liked movie red for seven director teams in this confirmation group. We verified all input identity, chronology and franchise exclusions, repeated the native replay and independently recounted all four arms' threshold crossings and paired mean errors from individual predictions.

## Data and reproduction

The native calibrated Coast model is rebuilt for each user using only that person’s ratings. A three-fold franchise withholding step gives the donor’s independent prediction error; the test target’s own rating remains hidden throughout. Genre and director information for unmapped training works comes from MovieLens and IMDb; complete Coast metadata is used where available. The eligibility test requires matching target and donor director sets separately in IMDb and Coast, as well as the same director count in both sources. The public archives give stable movie IDs. Current metadata remains a retrospective limitation. Results measure only film transfers with this catalogue overlap. A person can also like another title with incomplete director data which the veto cannot recognise. [IMDb director dataset](https://developer.imdb.com/non-commercial-datasets/)

The research used MovieLens following its non-commercial research terms. Cite F. Maxwell Harper and Joseph A. Konstan, *The MovieLens Datasets: History and Context* (2015). Public raw datasets, personal rows, trained models and identifier exports stay outside Coast. Only aggregate results are recorded here. [Dataset paper](https://doi.org/10.1145/2827872) · [GroupLens usage terms](https://files.grouplens.org/datasets/movielens/ml-25m-README.html)

Run the following with the established local research copy, the archive and the extracted data paths from the [previous holdout audit](../2026-11-23-personal-dislike-signals/README.md). Outputs containing IDs must be new private files. The SHA-256 of the ZIP used for 25M is `8b21cfb7eb1706b4ec0aac894368d90acf26ebdfb6aced3ebd4ad5bd1eb9c6aa`. The small ZIP is `696d65a3dfceac7c45750ad32df2c259311949efec81f0f144fdfb91ebc9e436`. The locally archived IMDb director table, updated independently by IMDb, is `b22b33bd4d651e62517afd6a40c00ccaaa06f4ded5f19fa724cb3060e581efd2`.

```sh
bun --env-file="$privateDevEnv" external-ids.ts "$newIdCrosswalk"
python3 -B external.py "$archive" "$imdbCrew" "$newIdCrosswalk" "$soloCapture" "$savedMetadata" "$newPrivateInput"
bun external.ts "$newPrivateInput"
COAST_MOVIELENS_SHARD=1 python3 -B external.py "$archive" "$imdbCrew" "$newIdCrosswalk" "$soloCapture" "$savedMetadata" "$newConfirmationInput"
bun external.ts "$newConfirmationInput" shadow
```

[Pilot aggregates](external-small.json) · [Stable benchmark group 0](external-25m.json)
