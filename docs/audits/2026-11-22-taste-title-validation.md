# Can Coast recognise a favourite it has never seen?

Coast rebuilt the copied account's taste profile 873 times, withholding one rated movie or series each time. Of its 125 five-star titles, 110 stayed within five match points of their score with the title included. The typical five-star movie outranked 96% of unseen comparison movies. The typical five-star series outranked 91% of comparison shows. Low-rated movies were much harder to identify.

## Withholding a whole title

The history contained 765 movies and 566 shows, including 444 rated movies and 429 rated shows. For each rated title, the replay excluded all personal observations belonging to its canonical work, including episode and season observations, before fitting the profile again. The title’s public metadata remained available. An eligible withheld title returned to the pool of catalogue choices. Each fit rescored the same 256 unseen titles from its medium, selected by a stable hash before seeing the results. The percentile uses only peers with a score in both fits and gives half credit for a tie. The replay uses title-local habit measurements so another title cannot disclose the withheld title’s pacing.

| User rating | Titles with both scores | Median match, full → withheld | Median percentile, full → withheld | Within five match points |
| --- | ---: | ---: | ---: | ---: |
| Five-star movies | 66/66 | 89 → 85 | 100 → 96 | 56 |
| Five-star shows | 59/59 | 91 → 87 | 99.8 → 91 | 54 |
| Movies rated at least four | 326/326 | 85 → 84 | 95.9 → 91.2 | 313 |
| Shows rated at least four | 287/287 | 87 → 85 | 90.4 → 77.1 | 279 |
| Movies rated 2½ or lower | 7/7 | 77 → 81 | 32.4 → 66.6 | 5 |
| Shows rated 2½ or lower | 32/33 | 75 → 76 | 24.9 → 30.4 | 30 |

Of the five-star titles originally in the top quarter, 54 of 64 movies and 43 of 55 shows stayed there. One low-rated show had insufficient evidence for a prediction after withholding. The low-rated movie sample is small. Even so, a median blind score of 81 shows why retaining a similar score alone is insufficient. This measures fit with the account’s other preferences, using current catalogue metadata. The percentage has no established interpretation as a probability of liking the title. [Read-only validation script](../../scripts/taste-title-holdout.ts)

We independently checked four titles in a second clone. Each time, we moved the account’s ratings, tracking state, events and work reactions for the entire title family to a temporary disabled account. We verified the held-out title disappeared from the normal history query, ran the production background job, read its published card percentages and restored identical row counts. The two five-star cases scored 88 → 82 and 92 → 88. The two 2½-star cases stayed at 82 and 67. The latter still ranked near the tenth percentile for shows. This exercise covers default account-relative habit processing as well as the published cache path.

## Display and viewing habits

On the same five work folds and refreshed metadata, we measured how often the displayed percentage put a title rated at least four above one rated at most three. Compared with the original display and habit rules, movies improved from 71.87% to 75.96% with ratings and 61.78% to 64.73% without. Shows improved from 77.01% to 79.11% with ratings and 44.82% to 66.33% without. The movie top 20 contained one more liked title with ratings and one fewer without.

With the new display held constant, the revised show habits improved unrated pair ordering from 51.47% to 66.33% across 3,684 pairs. The paired conditional 95% interval for the improvement was +7.47 to +22.25 percentage points. The top 20 contained 16 liked shows, up from 12. The Animation top 20 retained 11 likes. With ratings enabled, ordering moved from 78.43% to 79.11% and the interval for the change included zero. Repeats now require direct series evidence or repeated viewing across multiple episodes. A viewer falling behind on an unrated show provides less evidence of dislike.

The historical evidence is less conclusive. The prespecified 107-show chronological split fell from 63.82% to 60.77%, with 16 → 13 liked titles in the top 20. Across four disjoint forward windows covering 214 held-out shows, order improved from 55.09% to 63.31%, but two windows declined and the paired 95% interval included zero. First-watch dates survive in the copy. Original Trakt rating dates and complete historical availability do not. The forward comparison measures agreement with ratings eventually recorded. [Habits replay](../../scripts/taste-habits-replay.ts) · [Display validation and exceptions](2026-11-22-taste-display-validation.md) · [TMDB credit coverage](2026-11-22-tv-credit-verification.md)

## Card loading

After rebuilding the account with the revised formula, we reran 21 trials on the copied database. Adding one score batch in parallel with normal card loading cost 0.74 ms at the paired median for 72 cached scores, 3.72 ms for a half-cached batch, and 7.01 ms for a fully uncached batch. For 24 cards the deltas were −0.01, +2.79 and +4.68 ms. For 72 uncached cards the overall p95 went from 25.36 to 31.16 ms. Card order and displayed scores matched across all paths. These are server-side timings for a single request with warm PostgreSQL buffers. [Method and earlier runs](2026-11-22-taste-card-loading.md)
