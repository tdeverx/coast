# What watch history can tell Coast about taste

On the copied the viewer account, we could identify which shows the viewer would return to more easily than which shows they would rate highly. We found one definite ingestion error. A Jellyfin reimport could turn one dated watch into apparent repeat evidence. The fix is confined to the taste query. We kept the remaining behavioural models in replay.

## Identity and evidence

| Audit on the frozen history | Result |
| --- | --- |
| Movie/show roots that contributed to the personal history | 765 movies, 566 shows |
| Applied watch records across sources | 20,138 |
| Additional watch records already merged as provider duplicates | 11,153 |
| Episode history with multiple dated watches | 166 episodes with two distinct instants, six with three |
| Shows with an episode watched again on another day | 19 |
| Current Jellyfin play count of at least two | One movie, 154 episodes across 23 shows |
| Confirmed root repeat after the correction | One movie, six shows |
| Stronger deliberate-return flag / recorded active rewatch starts / explicitly dropped screen works | 0 / 0 / 0 |
| Coast playback sessions | 243 in total, 193 shared. None of the 50 personal sessions exceeded five minutes. |

The old query correctly combined Trakt and Jellyfin observations but counted a Jellyfin last-played snapshot a second time after an intervening unwatch. On one movie, two Jellyfin records and a Trakt echo pointed to the same 1997 timestamp, with an accepted Jellyfin count of one. Across the copy, grouping that one provider’s repeated snapshots removed 81 excess play counts on one movie and ten episodes. One episode went from 46 to two. The corrected query retained distinct Trakt plays at the same instant, manual plays, separate dated Jellyfin snapshots and independently supported earlier watches in the Jellyfin count. Running Coast’s query against all 1,331 roots changed a single movie’s inferred strength from repeat to ordinary consumption. The dedicated disposable-database suite passed all eight cases. [Taste aggregation](../../../src/lib/recommendations/interests.server.ts) · [Jellyfin import semantics](../../../src/lib/sync/jellyfin-playback.server.ts) · [Regression coverage](../../../tests/taste-history-evidence-db.test.ts)

A viewer can return to individual episodes without rewatching a third of a large series. Coast currently requires repeats on at least two episodes and one third of the observed episode breadth to promote that evidence to the show. Relaxing this to two repeated episodes plus three independently timed watch days lowered ratings-masked show ordering from 66.79% to 62.01%. The individual plays retain information, but this experiment weighs them too heavily as a vote for the entire series. [Series return criteria](../../../src/lib/recommendations/watch-habits.server.ts)

## A reliable watch can have an unreliable date

- We counted 4,951 admitted watch records in exact-timestamp groups of three or more. Of these, 2,108 belonged to groups spanning multiple titles. The largest group contained 356 records. One bulk history operation can truthfully mark many episodes as watched.
- Of the 590 dated movie watch records with a known catalogue release date, all 143 on the release date occurred at precisely **21:00 UTC**, including 112 before 2010. Another 33 predated the current canonical release date. These patterns weaken evidence for release urgency. A release date can also differ between markets and releases.
- The copy had 2,443 episode marks on the listed release day. A separate examination of the 19,855 watched movie/episode metadata rows found zero with an exact instant stored at the snapshot’s top-level firstAiredAt field. Trakt explicitly allows marking at release and its implementation can append episode runtime. A date and clock in imported history alone cannot distinguish a release-day enthusiast from a retrospective mark. [Trakt’s explanation of how release-date marks are recorded](https://forums.trakt.tv/t/strange-time-when-adding-to-history-using-release-date/9717)
- Of 232 shows with an inferred incomplete outcome, **202** had all known episodes released by the viewer’s last recorded watch accounted for, comparing distinct season/episode slots. Of those 202, 120 had a rating, 71 were rated at least four stars and 19 at most 2½. This is consistent with watching while a show was current and missing a later season. Our denominator uses the date-based catalogue currently available, and actual library availability can be later.

Changing the clock evidence alone provided mixed results. Suppressing an imported movie release-clock pattern raised masked movie ordering from 64.73% to 66.87%, but the liked titles in its top 20 went from 16 to 13. A stricter clock screen raised masked show ordering from 66.79% to 67.71%, but the top 20 went from 17 liked shows to 16. Treat bulk timestamps and imported date templates as uncertain in timing-specific experiments. Recorded consumption remains meaningful.

Coast already knows when a viewer explicitly selects “On air date”. The menu sends onReleaseDate, but the single-item schema discards that choice and bulk tracking reduces it to individual dates. The stored event records only whether the instant is known. Trakt supplies a separate history action for a scrobble, check-in or manual watch. The current adapter also discards that action. Retaining these distinctions would let timing use corroborated personal playback or check-ins, and keep explicit release-date marks as consumption. A generic Trakt watch cannot by itself distinguish marking a real premiere from backfilling it. [Coast air-date action](../../../src/lib/ui/work-menu/ScreenActions.svelte) · [Tracking input and persistence](../../../src/lib/core/tracking/service.server.ts) · [Coast Trakt record schema](../../../src/lib/providers/trakt/adapter.server.ts) · [Trakt history API](https://trakt.docs.apiary.io/reference/sync)

A GET-only check against the connected account matched all 688 Trakt movie history entries by stable provider identity and exact watch instant. Trakt classified 687 as generic watches and one as a check-in. **All 143 movie release-day matches were generic watches.** We also sampled 300 episode entries across three dates. Trakt labelled 244 generic watches and 56 scrobbles. Of 298 exact matches with Coast, 54 were scrobbles. All 18 locally matched release-day entries in that sample were generic watches. The episode sample is deliberately spread across time and does not estimate the distribution for the full history.

## Can we learn taste without any user ratings?

We fitted a small regularised content model to a behavioural event. The viewer had to return to at least two different seasons on at least two credible dates in each. The training terms excluded the held title, all its episodes and all personal ratings. Metadata terms needed three training examples. We fitted the expected return rate separately by opportunity and applied only the content residual to each card, with an adjustment capped at 12 points. Bulk timestamps and imported clock-grid dates near release were excluded from the session evidence. The latter is a sensitivity rule which can discard real appointments. [Reproduce the return models](implicit-returns.py)

| Training eligibility | Different titles, ordering | Later titles, ordering | Later liked top 20 | Later liked Animation top 20 | Later liked Sci-Fi top 20 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Frozen Coast benchmark, ratings masked | 66.79% | 64.65% | 12 | 17 | 16 |
| Ten episodes available by last watch | 69.84% | 66.03% | 14 | 15 | 19 |
| Two mature seasons by the training cutoff | 64.33% | 62.74% | 15 | 14 | 15 |
| Two mature seasons also available by last watch | 71.89% | 65.85% | 14 | 15 | 18 |

Ordering compares a four-star-or-higher show against one rated three stars or lower, crediting ties half. We scored 428 held works across five folds and 107 later first-watched titles. In the last row the improvement was +5.10 points on the work splits (paired conditional 95% bootstrap interval −0.99 to +10.60) and +1.20 points in time (−17.05 to +19.68). The later cohort has only 11 shows in the low comparison class. The best-looking in-fold rule also selects on how long a person stayed around to watch, so it can still overstate the meaning of returning.

On the separate task of predicting another sustained season, the two-mature-seasons model improved ordering from **49.83% to 61.39%** on 49 eligible later shows, while its star ordering worsened. These are different outcomes. Neither the improvement in future engagement nor the earlier animation ranking warrants using the proposed proxy in the card percentage. Pure viewing depth and unfiltered date counts did worse in several tests.

The forward replay cut both the observations and available episode supply at 2020-10-06 02:00 UTC. Current metadata and release dates stand in for the historical catalogue. Historical library availability, past catalogue revisions and exposure to recommendations are unknown. A stricter ratings mask also removed the single five-star show with no consumption, choice or other opinion and erased all child-rating fields. That changed the training work count in four folds and **none of the 429** held show outcomes. [Temporal evaluation study](https://arxiv.org/abs/2010.11060) · [Exposure and missing-not-at-random feedback](https://arxiv.org/abs/1909.03601)

Keep the proven duplicate correction. For the next behaviour experiment, separate continuing a title, rewatching it, explicitly dropping it and falling behind after reaching the then-current finale. Evaluate each against its own observable outcome first. Use sustained returns to raise confidence in an affinity only when the resulting taste prediction also improves on held-out ratings across time and across accounts. Absence from the history affords especially weak evidence on titles Coast cannot establish were meaningfully offered.

## Reproduction

Run the read-only Bun extractor on the local copy, specifying a username and a new private file path. Run the Python replay with that private file, the existing frozen movie/show capture, frozen per-show work-fold controls and chronological controls, in that order. It prints only aggregate scores. No personal viewing records are included here. [Evidence and timestamp audit](implicit-evidence.ts) · [Cold-title and chronological replay](implicit-returns.py)
