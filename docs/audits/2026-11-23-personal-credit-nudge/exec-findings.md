# Executive-producer credits in personal taste predictions

Executive producers connected 175 of 429 shows and 168 of 444 movies to at least one additional rated franchise. The extra connections did little to identify titles this viewer would dislike. Across the 40 original dislikes, adding producers to the creator/director rule lowered one displayed score, raised one and left 38 unchanged. All 40 stayed at or above 50.

## Does it matter who the producer was?

The table gives the decrease in mean absolute error on the 0–100 scale, relative to the creator/director rule alone. Positive values favour adding producers. The control swaps entire producer teams between titles with the same medium, broad genre and number of producers. It keeps the actual rating history and all creator/director credits in place.

| Holdout | Titles | Actual producers | Median of 99 shuffled teams | Shuffles equalling or beating actual |
| --- | ---: | ---: | ---: | ---: |
| Movies, original | 444 | −0.009 | −0.025 | 3 / 99 |
| Movies, earlier ratings only | 194 | +0.019 | +0.025 | 63 / 99 |
| Shows, original | 429 | −0.017 | −0.006 | 93 / 99 |
| Shows, earlier ratings only | 188 | −0.028 | 0.000 | 98 / 99 |

The actual movie producers did better than most shuffled teams on the original split, but the creator/director rule alone still had the lowest error of the three. The earlier-rating movie result improved slightly over that rule, with a similar improvement for fake teams. For shows, the actual teams increased error in both tests.

The second control kept every target's credits fixed. Shuffling only the eligible rating history preserves each producer's credit count in each specific training fold. It gave the same conclusions for all four panels. Real and shuffled assignments differed on about 61% of producer edges for movies and 68% for shows in the first control. Some teams had no eligible swap partner. Both controls preserve the full team, stable person IDs, the exact producer count on every work, and every actual creator/director credit.

## How often is personal evidence available?

| Original holdout | Target has an exclusive executive credit | Shared executive on both sides | Target lead, previous executive | Target executive, previous lead | Additional family reached | Two or more additional families |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Movies, 444 | 289 | 151 | 37 | 40 | 168 | 110 |
| Shows, 429 | 284 | 159 | 62 | 50 | 175 | 112 |

Columns can overlap. An executive who also leads a title counts as its lead. A family is additional when it supplies a verified personal rating that the target could not already reach through a shared creator/director. Every prediction excludes the target's entire franchise and its fold's withheld ratings. The earlier-rating checks also exclude the target day and later days.

Of 125 five-star favourites, seven movies and three shows moved up on the displayed score, four shows moved down, and the remaining 111 stayed put. No five-star favourite crossed the green threshold in either direction. Across all original titles, adding producers created three green movies and one green show, and removed one green show.

The evidence supports retaining executive roles for explanation and investigation. This viewer's holdouts do not justify using a general producer bonus or penalty in predictions. The shuffles control one broad genre label and exact producer counts per title. They cannot distinguish the person's own effect from their usual collaborators, unrecorded subgenre differences or production era, and the earlier-rating data cover one viewer.

[Prespecified controls](exec-protocol.md) · [Aggregate results for both controls](exec-controls.json) · [Replay script](exec-placebo.py)
