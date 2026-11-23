# TV credit coverage on a development copy

On 22 November 2026, Coast refreshed 20 sampled series through its configured TMDB adapter on a disposable database copy. Series with a verified director or writer increased from **3 of 20 to 13 of 20**. The median number of distinct credited directors and writers per series rose from **zero to two**.

## Sample and method

The account's full taste history contained 566 shows. Of those, 563 had a single TMDB series identity eligible for this comparison. Grouped anthology identities were excluded. Using the episode count in the latest TMDB snapshot, or the count of local non-special episodes if missing, divided the eligible population into four groups. In each group, the first five public TMDB IDs ordered by the SHA-256 hash of the fixed prefix `2026-11-22-series-crew:` and the ID formed the sample. Selection was independent of ratings and existing credits.

| Episodes in series | Eligible shows | Sample size | With a director or writer before | After |
| --- | ---: | ---: | ---: | ---: |
| 1–12 | 133 | 5 | 0 | 4 |
| 13–39 | 237 | 5 | 3 | 4 |
| 40–99 | 117 | 5 | 0 | 1 |
| 100 or more | 76 | 5 | 0 | 4 |

Equal representation across the groups makes the overall 65% an observation about the sample. A population-wide estimate would require additional evidence, particularly for series with rotating crews.

The test also refreshed *The Midnight Club* and *It's a Sin* as separate checks for recurring creators, and requested three pilot episodes to check guest credits. All 25 provider requests succeeded. Coast ingested each response through its normal catalogue path and read the resulting taste features. Director and writer IDs matched the adapter's output on all 22 series. All writes were confined to the disposable copy. [TMDB series aggregate credits](https://developer.themoviedb.org/reference/tv-series-aggregate-credits) · [Coast TMDB adapter](../../src/lib/providers/tmdb/adapter.server.ts) · [Taste feature loader](../../src/lib/social/work-features.server.ts)

## What reached the profile

- Twelve of the 20 sampled shows had a director after the refresh, up from two. Nine had a writer, also up from two. *Schmigadoon!* gained directing credit for Barry Sonnenfeld and writing credits for Cinco Paul and Ken Daurio. [TMDB credits for Schmigadoon!](https://www.themoviedb.org/tv/98892-schmigadoon/cast)
- The series rule requires a person to hold the same credited role on at least 25% of episodes, with at least two episodes on a multi-episode series. The *Reign* pilot retained its director Brad Silberling and writers Stephanie Sengupta and Laurie McCarthy as episode credits. None appeared in these roles on the series root. The *Mistresses* pilot similarly retained director Cherie Nowlan. [TMDB credits for Reign](https://www.themoviedb.org/tv/48865-reign/cast)
- Including the two additional shows, coverage across the 566-show history rose from 24 to 34 shows with directors and 25 to 33 shows with writers. Shows with either credit rose from **37 to 48**. A new in-memory profile trained on the complete post-refresh history still had zero directors or writers eligible for exceptional creator weight. One director newly appeared across two rated series, but neither rating reached four stars. No person in either role had three highly rated independent shows in the refreshed evidence. This small refresh verified attribution. It did not establish whether a full catalogue refresh would produce a strong TV creator preference.
