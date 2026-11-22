# Rating influence in personal Taste

The background worker builds the saved affinities from observed opinions and behaviour. Three stars has neutral sentiment and 15% evidence weight. One and five stars have equal and opposite influence. Saved affinities range from 1% to 99%. One confidence adjustment applies to the final title match. A title with enough strong supporting evidence can still reach 100%.

The majority bonus uses the share of decisive feedback in each affinity. Ratings of four or higher and endorsements on unrated titles count as positive. Ratings of 2.5 or lower count as negative. A bonus applies when the decisive majority points the same way as the strength-weighted evidence. Its size depends on the margin, sample size and room remaining in the affinity. Balanced and conflicting votes receive no bonus. Completion and unusually strong positive feedback can also corroborate a preference once their rates separate from the owner's rate on other works with known metadata in that dimension. Cast needs evidence from at least three distinct titles to qualify as an affinity for title matching.

## Cold-profile fixture

Each watched work and the candidate have Sci-Fi as their only feature. All histories start empty and have no independent endorsements, deliberate returns, audience adjustment or learned coefficients.

| Ratings | Sci-Fi affinity | Title match | Confidence |
| --- | ---: | ---: | ---: |
| 5, 5 | 99% | 77% | 33% |
| 5, 5, 3 | 96% | 76% | 35% |
| 5, 5, 3, 3, 3 | 90% | 75% | 38% |
| 5, 5, and twenty 3s | 70% | 67% | 49% |
| 5, 5, 2 | 85% | 71% | 38% |
| 5, 5, 1 | 67% | 60% | 34% |
| 5, 4.5, 1 | 61% | 56% | 31% |
| 5, 5, 1, 1 | 50% | 50% | 31% |
| 5, 5, 1, 1, 1 | 40% | 43% | 37% |
| 1, 1, 5 | 33% | 40% | 34% |

## Historical replay

This replay used the earlier 5% weight for three-star ratings. The cold-profile fixture above was rerun at 15%.

Five deterministic holdouts on one account used 444 rated movies and 429 rated shows. Whole held-out titles were excluded from training. Positive labels were 4 stars or more, negative labels 3 or less, and the comparison used the confidence-weighted score and return tie-breaker. The same tests were repeated with training ratings removed, retaining behavioural and endorsement evidence. Values below are pairwise ranking accuracy (AUC) on those item candidates. The replay covers neither provider shortlist construction nor results across other accounts.

| Cohort | Merged baseline | Tested calibration before majority bonus | Final |
| --- | ---: | ---: | ---: |
| Movies with ratings | 0.7977 | 0.7902 | 0.7945 |
| Movies without ratings | 0.6497 | 0.7159 | 0.7159 |
| Shows with ratings | 0.7845 | 0.7817 | 0.7846 |
| Shows without ratings | 0.5674 | 0.5990 | 0.5996 |

The final rated models found 18 liked Sci-Fi movies and 16 liked Sci-Fi shows in their respective genre top 20s, compared with 16 and 17 immediately before the bonus (16 and 14 at the merged baseline). For Animation the final counts were 16 liked movies and 17 liked shows, compared with 16 and 16 immediately before the bonus (16 and 16 at the merged baseline). Genres outside both groups changed from 0.7069 to 0.7000 for rated movies and from 0.7809 to 0.7894 for rated shows. The unrated movie model placed 14 liked titles in the overall top 20, down one from the merged baseline. Other overall counts were 18 to 18 for rated movies, 14 to 17 for rated shows and 16 to 16 for unrated shows. One final rated movie score reached 100%. Trials that removed the final confidence adjustment reduced overall pairwise ranking accuracy in all four cohorts relative to keeping it under the same early calibration.

## Affinity priorities

Genres, tags and other descriptive matches receive the highest base weights. At comparable evidence the selected screen features follow with cast, networks and studios, release decade, country, language and composer. Every feature uses distinct-title support. A decisive positive or negative feedback pattern can raise its reliability when the direction agrees with the affinity. Small majorities carry little weight, and strong completion and return patterns can support relevant affinities without ratings. The worker uses the strongest corroborating measure for each feature.

Secondary features are individually capped at 85% of the lowest matched descriptive weight. Context collectively stays below the primary weight. Composers have the smallest score coefficient among the listed features. A verified credit can still inform how much of the title's metadata the profile covers. The separate learned rating adjustment emits descriptive terms and their combinations. Cast and other non-descriptive training inputs help estimate those terms and contribute to a title through the bounded affinity blend.

In a synthetic candidate with matched genre and tag affinities, increasing unrated viewing across distinct titles featuring the same actor from three to forty raised cast's share from 16.8% to 29.4%. Genre and tags retained 36.0% and 34.6%, respectively. In a separate candidate with the same genre evidence, networks with 24 liked and 2 disliked titles, or 2 liked and 24 disliked titles, each had 21.5% of the blend. The score was 79% for the liked network and 63% for the disliked network. A network with 13 liked and 13 disliked titles had 5.3% of the blend and scored 75%.

The same five-fold item replay used the previous local scorer with the 15% neutral rating weight as its baseline. Movies with ratings moved from 0.7959 to 0.7849 AUC. Without ratings they moved from 0.7159 to 0.7074. Shows moved from 0.7891 to 0.7864 with ratings and from 0.5996 to 0.5970 without them. Overall liked-title counts in the top 20 stayed at 18, 17 and 16 for rated movies, rated shows and unrated shows, respectively. Unrated movies rose from 14 to 15. The rated Sci-Fi movie subset fell from 18 liked titles in its top 20 to 15, while the rated Animation movie subset stayed at 16. Both rated show subsets stayed at 17. Treating composer context as ineligible for metadata coverage had a larger unrated movie loss, from 0.7159 to 0.6814. The final version retains coverage for verified credits and their bounded score contribution.

## Runtime scope

The saved profile revision advances to v13. The current job continues to read full owner history in 300-title batches. The added completion evidence uses the existing owner tracking state and an indexed, local TMDB snapshot lookup for eligible shows. No providers are called on that path. Added counters live in profile construction. Per-card scoring uses the existing prepared reference and feature batch.

In an alternating read-only PostgreSQL plan comparison, the history query returned the same 1,329 canonical rows and existing fields, with 960 known completions and 235 eligible unfinished observations added. Four instrumented execution samples were 3,546, 2,331, 2,318 and 2,052 ms at the merged baseline, and 2,788, 2,482, 2,188 and 2,204 ms with completion evidence. Medians were 2,324 and 2,343 ms. The candidate adds 558 indexed metadata lookups and approximately 18,070 inclusive shared-buffer accesses on this history. This comparison measures the instrumented background history SQL only. The foreground scoring path has no new database reads or provider calls.

## Friend evidence and medium parity

The explicit admin calculation reads eligible friends in one cancellable PostgreSQL query for the batch. It uses accepted relationships and current category, insights, ratings and activity visibility. Books and comics use visible reading progress for completed reads. It excludes the requested titles from agreement. The comparison uses up to 120 recent viewer ratings per kind, admits at least eight shared ratings and 80% agreement, and uses up to 24 qualifying friends per title. Watching without a rating is a weak positive signal, a neutral rating contributes zero direction, and equally supported opposing ratings cancel. The signed adjustment is bounded to six points and requires an existing personal score. It stays out of persisted scores and recommendation feeds. Anonymous community input was left outside this trial.

The native matrix checks current privacy and friendship withdrawal, unqualified and unrelated friends, unpublished friend adjustments, title exclusion, mixed opinions and native activity records for movies, shows, music, games, books and comics. The synthetic score matrix varies the rating split on each of the 20 affinity dimensions and round-trips the prepared reference. Sparse, balanced and strong evidence is covered. For contextual affinities, observed rating patterns take precedence over routine viewing as decisive ratings accumulate. Game and reading completion is recorded as distinct-title evidence. Music continues to distinguish ordinary exposure from repeated listens.

Both Taste views share the per-medium signal list and labels. The score dialog uses the same labels and identifies added friend points. A desktop browser check on a migrated dummy-account database switched the personal view from Movies to Games, opened the friend comparison, and opened the admin score dialog from a movie menu. The fixture displayed a 75% final score with +2 friend points. The reshaped fields are also filtered in the server projection.

Provider fixtures check metadata from request shape through validation, persistence and score features. IGDB supplies collections and supported languages within existing full projections. Open Library supplies indexed publishers in its existing exact work lookup and adds place, person and time subjects from its work response. Comic Vine adds concepts and character, team and location subjects on its existing issue detail request, and accepts a publisher when the volume metadata includes it. Jellyfin rich music reads add tags, studios and verified writer and composer credits. The lean music state sync does not request those fields. No new provider endpoint call is introduced. Normal rich sync and detail paths populate existing works as they refresh.

Primary API references. [IGDB API](https://api-docs.igdb.com/), [Steam owned games](https://partner.steamgames.com/doc/webapi/IPlayerService), [Jellyfin item data](https://typescript-sdk.jellyfin.org/interfaces/generated-client.BaseItemDto.html), [Open Library search](https://openlibrary.org/dev/docs/api/search), [Open Library work and edition fields](https://openlibrary.org/dev/docs/api/books). Comic Vine fields were checked in local contract fixtures. Anonymous community scoring and a separate direct MusicBrainz connector are outside the current scope.

For 24 candidate movies, 30 qualifying synthetic friends and 120 shared ratings, the exact friend query returned 576 bounded candidate rows. An initial run during other local checks measured 839.89, 846.01, 882.55, 1091.32 and 53.23 ms. The same fixture size later measured 55.78, 48.93, 51.16, 48.52 and 48.13 ms with a warm client. The repeat instrumented query spent 47.14 ms in PostgreSQL and accessed 13,903 shared buffers. These are local admin diagnostic measurements. The normal card path runs no friend query.

### Final screen replay

The current personal-affinity scorer was compared with merged main using the same five folds and 444 rated movies and 429 rated shows. Friend scores were excluded because this history lacks a time-fenced peer replay. The account's live ratings were all screen ratings. Non-screen coverage comes from deterministic and provider persistence fixtures.

| Cohort | Main AUC | Current AUC | Main / current liked titles in top 20 |
| --- | ---: | ---: | ---: |
| Movies with ratings | 0.7977 | 0.7847 | 18 / 18 |
| Movies without ratings | 0.6497 | 0.7055 | 15 / 15 |
| Shows with ratings | 0.7845 | 0.7863 | 14 / 17 |
| Shows without ratings | 0.5674 | 0.5970 | 16 / 16 |

The rated movie Sci-Fi subset lost one liked title in its top 20 relative to main. The rated show Sci-Fi subset gained three. The rated movie Animation top 20 stayed at 16 liked titles, and rated show Animation rose from 16 to 17. This is a one-account check of scoring among held-out titles, with catalogue admission and cross-account generalization outside the measurement.
