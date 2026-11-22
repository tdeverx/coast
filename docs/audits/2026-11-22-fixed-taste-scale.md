# Fixed star scale and primary taste signals

The worker uses three stars as neutral for all media. Median ratings remain descriptive. Genres, tags and themes can support a title match directly, with matching names counted once. Repeat activity carries more weight than the reach of a feature across viewing history. The scorer still checks evidence strength and uses the prepared private reference and existing refresh job.

One real account was replayed read-only. Five deterministic holdout groups excluded each test title and its activity from training. The unrated variants also excluded all training ratings. Film and show AUC compares titles rated four stars or higher with titles rated three stars or lower. Game AUC compares upper and lower playtime ranks as an engagement proxy. Missing scores count as neutral. The same holdouts ran against the previous source, the fixed three-star scale and a fixed two-and-a-half-star alternative.

| History | Previous | Three stars neutral | Two and a half stars neutral | Previous, no training ratings | Updated, no training ratings |
| --- | ---: | ---: | ---: | ---: | ---: |
| Movies | .786 | .707 | .684 | .546 | .543 |
| Shows | .748 | .778 | .777 | .553 | .638 |
| Games, playtime proxy | .615 | .634 | .634 | .615 | .634 |

All 444 rated movies received a score. Show coverage increased from 423 to 428 of 429 with ratings and from 417 to 428 with ratings withheld. Both versions scored 175 of 204 games. In the rated-movie replay, in-process scoring rose from about 2.2 to 2.6 ms per 100 titles and the prepared reference shrank from 235 to 231 KiB. With ratings withheld, movies took about 1 ms per 100 titles in both versions. These measurements exclude database and network time.

The rated-movie ranking trails the previous model. The unrated movie ranking remains weak, with only 24 low-rated films in the replay. The account supplied no usable held-out rating samples for other media. Broader ranking quality and production latency remain unverified.

The next replay applied the audience discount during profile construction and rating-model training. It uses locally stored audience scores and vote counts, with the configured screen metadata order and native game audience scores. The discount is zero for sparse samples, a high audience score, or strong disagreement, and cannot exceed half of a negative vote. Every affected dimension receives the same revised vote. Candidate reads use the existing reference and feature batch.

The discount affected 3 of 444 rated movies and 10 of 429 rated shows in the replay. Rated movie AUC moved from .707 to .702 and show AUC held at .778. The sampled Animation and Sci-Fi & Fantasy show affinities moved by at most 0.01 points, to 73.72 and 79.54. A separate diagnostic gave already-positive rewatched titles a quarter of their remaining distance to a five-star vote. That moved the two show affinities to 76.84 and 82.57 and yielded AUC of .706 for movies and .776 for shows. That diagnostic was evaluated separately from the audience adjustment.

## Deliberate returns

The same holdouts were replayed against the audience-adjusted model before and after the separate return contribution. The same titles, metadata, fold IDs and evaluation criteria were used. The unrated comparison strips training ratings. A further diagnostic disables returns in the unrated profile while leaving ordinary consumption and playtime evidence in place.

| History | Rated baseline | Rated with separate returns | Unrated baseline | Unrated with separate returns | Unrated with returns disabled |
| --- | ---: | ---: | ---: | ---: | ---: |
| Movies | .702 | .695 | .543 | .543 | .453 |
| Shows | .778 | .780 | .638 | .638 | .582 |
| Games, playtime proxy | .634 | .634 | .634 | .634 | .634 |

Coverage stayed at 444 movies, 428 of 429 shows, and 175 of 204 games. Rated show Animation affinity moved from 73.72 to 78.05 and Sci-Fi & Fantasy from 79.54 to 82.69. Returns already helped the unrated model on this account. The new rated contribution provides mixed ranking results, with a small show gain and movie decline. The game sample supplied playtime rather than rated or repeated playthrough evidence. The replay had no comparable rating samples for books, comics or music.

The profile builder uses the existing return evidence and one additional scalar per feature. The persisted reference and candidate read path retain their shape. Matched in-process rated scoring took about 2.6 ms per 100 movies and 1.8 to 1.9 ms per 100 shows. These timings exclude metadata reads and network.

## Selective returns and combinations

The reference measures rated returns against other comparable rated titles. A second signal records repeat activity for sparse genre and subject combinations. Its estimate compares the pair against each component separately, requires at least five distinct observed works and shrinks noisy estimates. The worker keeps up to 256 supported combinations in the existing reference. Candidate reads do no additional I/O and preserve the separate fit for explicit ratings.

The same five holdout groups were replayed with ratings and with ratings stripped out of training. Animation and science-fiction top 20s were formed inside the relevant metadata cohorts from the out-of-fold scores. Ties use the stable work ID. Rated AUC compares titles at four stars or higher to titles at three stars or lower. The “other” column excludes either of the two focus genres.

| History | Training ratings | Overall AUC | Other-genre AUC | Animation top 20 rated 4★+ | Science fiction top 20 rated 4★+ |
| --- | --- | ---: | ---: | ---: | ---: |
| Movies | Included | .695 → .700 | .624 → .626 | 15 → 15 | 16 → 16 |
| Movies | Withheld | .543 → .547 | .506 → .504 | 16 → 15 | 12 → 12 |
| Shows | Included | .780 → .781 | .767 → .767 | 16 → 16 | 15 → 14 |
| Shows | Withheld | .638 → .638 | .609 → .609 | 13 → 13 | 16 → 16 |
| Games, playtime proxy | Either | .634 → .634 | .634 → .634 | — | — |

The broader experiment that increased and expanded the rating-based pair weights weakened show ranking. The candidate retains the previous rating fit. It still drops one four-star-or-higher title from rated Sci-Fi & Fantasy shows and unrated animated movies, and ranking outside the focus genres declines slightly for movies without ratings. The comparison was used to select candidate weights, so it does not serve as independent validation.

## Return combinations as a tie-breaker

The worker publishes a separate return value alongside any score that has a supported combination. The recommendation query reads this value from the same fresh, owner-scoped cache row. It applies after the final ranking score and before the seeded or ID ordering. Candidate admission, the fit percentage and confidence retain their existing calculations. Stale cache rows contribute neither taste score nor return ordering. The real PostgreSQL query was exercised read-only with three synthetic cache rows and actual catalogue IDs, verifying both recommendation and genre rows against a stronger score and a stale score.

The same five holdout groups compared identical profiles with and without the tie-breaker. All scores, confidences, and coverage were identical. The following AUC figures use the confidence-weighted taste score, which is the taste component of recommendation ordering. The replay excludes provider and recent-interest weights. The two genre columns count titles rated four stars or higher in each top 20.

| History | Training ratings | Overall AUC | Other-genre AUC | Animation top 20 | Science fiction top 20 |
| --- | --- | ---: | ---: | ---: | ---: |
| Movies | Included | .8098 → .8097 | .7251 → .7254 | 16 → 16 | 16 → 16 |
| Movies | Withheld | .6817 → .6795 | .5793 → .5780 | 18 → 18 | 16 → 16 |
| Shows | Included | .7894 → .7894 | .7872 → .7872 | 18 → 18 | 14 → 14 |
| Shows | Withheld | .6628 → .6657 | .6479 → .6520 | 13 → 13 | 17 → 16 |
| Games, playtime proxy | Either | .6209 → .6209 | .6209 → .6209 | — | — |

For direct comparison with the previous table, raw taste-score ordering moved from .6957 to .6963 for rated movies, .5430 to .5365 for unrated movies, .7797 to .7800 for rated shows, and .6383 to .6511 for unrated shows. Those differences come from resolved ties. They show a small benefit for unrated show ranking, weaker unrated movie ranking, and limited changes in the top 20. These account-specific results remain local.

## Cross-provider watch evidence

A read-only check found 11,159 same-title, same-timestamp watch groups across Jellyfin and Trakt in one account. Jellyfin arrived first in all of them. The migration's matching query identified 11,153 pairs and preserved six cases with an intervening unwatch. The selection took about 152 ms in one PostgreSQL 17 execution across approximately 151,000 event rows and used temporary disk for its sort. That measurement excludes migration writes. Future Trakt imports use the existing account, media and timestamp index for a single matching lookup. History deletion has an index on the merged watch ID.

The same five holdout folds used the same fit model, catalog metadata, and rating labels before and after correcting repeat evidence. The candidate had repeat evidence on 469 movies and 322 shows before correction and on one movie and 34 shows after, including verified Jellyfin counts. Values below use confidence-weighted taste scores.

| History | Training ratings | Overall AUC | Other-genre AUC | Animation top 20 rated 4★+ | Science fiction top 20 rated 4★+ |
| --- | --- | ---: | ---: | ---: | ---: |
| Movies | Included | .8097 → .7975 | .7254 → .7064 | 16 → 16 | 16 → 16 |
| Movies | Withheld | .6795 → .6466 | .5780 → .5187 | 18 → 16 | 16 → 15 |
| Shows | Included | .7894 → .7841 | .7872 → .7796 | 18 → 16 | 14 → 14 |
| Shows | Withheld | .6657 → .5695 | .6520 → .6070 | 13 → 10 | 16 → 16 |
| Games, playtime proxy | Either | .6209 → .6209 | .6209 → .6209 | — | — |

The replay measures one account's taste evidence with the catalogue and holdouts already available. It identifies weaker ranking once inflated returns are removed, particularly for unrated titles. Recommendation ordering was held fixed.

The upgrade preserves the source IDs, excludes merged copies from media details and activity, and lets Undo in Progress ignore a duplicate received after the original action. The activity trigger uses the existing owner and source key index when it removes a projection. On synthetic PostgreSQL 17 upgrades, the migration took 0.29 seconds for 4,800 events with 800 matches. With 145,600 events and 11,200 matches it took 20.26 seconds immediately after bulk loading and 2.53 seconds with analyzed statistics. The timing includes schema changes and writes. Both sizes retained every event and original watch, corrected every seeded play count without changing position, and removed all duplicate activity projections. These are individual timings on disposable data, with no live migration.

## Personal Taste wall

The wall shows the saved affinity percentage with 50% as neutral. The preview and paginated signal browser order entries by the size of the affinity discounted by limited or conflicting evidence. Wide layouts display the four summary metrics in a row above the signals. The score calculation still receives the same values and credit selection. Saving a profile skips single-appearance people before calculating their affinity and calculates median ratings only for retained features.

A synthetic snapshot of 6,000 works with 156,000 single-appearance cast credits retained the same 300 recurring credits and produced identical affinity entries and full score breakdowns for 100 sampled works. Across five alternating runs after warm-up, median snapshot construction fell from 21.79 ms to 3.92 ms. The timing excludes evidence accumulation, PostgreSQL and publication.

Additional matched replays tested the influence of distinct episodes watched, saving titles and downweighting small inferred samples. A stronger small-sample discount lifted unrated movie AUC from .6466 to .6835, but lowered non-focus show AUC from .6070 to .5971 and the game engagement proxy from .6209 to .6021. A larger viewing-depth and save bonus lifted unrated show AUC from .5695 to .5982, while movie AUC fell from .6466 to .5610. Those weights were left out. The wall changes its display order without changing the fit scores.
