# TMDB vote coverage and dates

Coast stores TMDB's ten-point `vote_average` together with its `vote_count` on the same source edition. A missing score or zero votes supplies no audience evidence. The experiment reads the saved TMDB edition from the frozen research capture. Other providers' scores and personal Trakt ratings are separate inputs. [TMDB adapter](../../../src/lib/providers/tmdb/adapter.server.ts)

## Whole-title holdouts

| Medium | Rated roots | With TMDB votes | 1–9 votes | 10–99 | 100–999 | 1,000 or more |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Movies | 444 | 443 | 3 | 15 | 52 | 373 |
| Shows | 429 | 429 | 8 | 83 | 180 | 158 |

Every one of the 40 disliked works and 125 five-star favourites had votes. The median disliked show had 83 votes and the median five-star show had 1,640. Large vote counts make a community assessment more stable, while personal agreement with that assessment remains a separate question.

As a descriptive check, 12 of the 40 dislikes had a TMDB average at or below 6/10. In the same range, the viewer rated 32 titles four stars or higher, including two five-star films. Across the entire sample, 27 five-star titles exceeded their TMDB average by at least three points on the ten-point scale. These are diagnostics from the held labels. Their identities and labels must stay outside any decision that changes a prediction.

## Historical availability

The Coast metadata snapshot key is work, provider, instance, language and region. A refresh can update the existing row. The copy therefore cannot reconstruct what a TMDB average or vote count was on an arbitrary past date. [Snapshot storage](../../../src/lib/server/db/schema.ts)

The read-only [database check](coverage.ts) looked across all saved TMDB language and region editions. The earliest valid vote snapshot anywhere in the copy was **19 November 2026 at 21:22 UTC**, and the latest was **23 November at 00:04 UTC**. The 871 independently dated personal ratings span **14 October 2020 to 7 November 2026**. Of those, 870 had valid TMDB votes in the copy and **zero** had a saved observation from before their personal rating. The remaining two roots in the 873-title structural replay were undated shows.

The chronological experiment can use earlier *personal labels* with today's crowd numbers to test whether the approach is promising. Its audience input still contains information from after the historical test dates. Requiring as-of audience observations makes the rule abstain on every dated target. Forward validation requires preserving the actual crowd score, vote count and prediction at forecast time, then judging it only against subsequent personal ratings.

A dated archive could support a second historical test if it preserves both vote fields for the same TMDB IDs. TMDB's published daily ID exports cover valid IDs and selected attributes such as popularity, and the service keeps them for three months. Its change-list documentation describes a 14-day discovery window. Neither document specifies a historical archive of audience averages and counts covering these personal rating dates. [Daily ID exports](https://developer.themoviedb.org/docs/daily-id-exports) · [Tracking changes](https://developer.themoviedb.org/docs/tracking-content-changes)

To repeat the database check, use the isolated local copy and the verified rating-date file from the [measurement audit](../2026-11-23-taste-measurement/README.md).

```sh
bun --env-file="$private_dev_env" docs/audits/2026-11-23-taste-audience/coverage.ts "$verified_rating_dates"
```
