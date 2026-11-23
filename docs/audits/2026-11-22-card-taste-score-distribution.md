# Taste scores across the screen catalogue

The copied viewer's movie scores have a median of 79%, with half between 76% and 82%. Show scores have a median of 81%, with half between 75% and 85%. The same concentration appears among titles with no personal observation. It begins in the shared genre and keyword affinities, before selecting or rendering any cards.

## Catalogue and profile

The census scored every canonical movie and show in the 22 November development copy through the production `titleTastes` batch reader, in batches of at most 72. Each work counted once. The account had catalogue access, including titles outside its connected library. Source availability uses the normal viewer-specific permission query, including episode access inherited by a series. The census includes future and undated titles because discovery cards can show them. Restricting the comparison to released titles gave identical movie and show medians.

The working tree was based on `614bbcd284e87b1b064aaa5c15efcade889a3774` with the fit-3 scoring changes described in the [title validation](2026-11-22-taste-title-validation.md). The saved taste-v13/fit-3 reference was published on the copy at 23:13:33 UTC. It used 765 movie and 566 show history roots, both above the 40-work maturity threshold. The development settings hash subsequently changed. A read-only refit against the current copy produced identical scores and abstentions for all 4,892 movie and 3,558 show opportunity controls. Independent calculation with current metadata also matched the published card reader on 11,803 of the 11,804 catalogue roots. The single difference was *Oblivion*. Its card score of 85% was published at 23:13. A TMDB refresh at 23:25 added matching credits, studio, language and country evidence, yielding 86% in the breakdown.

| Population | Movie scores / titles | Movie median | Show scores / titles | Show median |
| --- | ---: | ---: | ---: | ---: |
| Entire catalogue | 7,954 / 8,049 | 79% | 3,714 / 3,755 | 81% |
| Confirmed released by the audit date | 7,637 / 7,718 | 79% | 3,524 / 3,558 | 81% |
| Accessible through a connected library | 1,770 / 1,770 | 81% | 942 / 942 | 85% |
| Discovery only | 6,184 / 6,279 | 79% | 2,772 / 2,813 | 79% |
| No personal observation on the root | 7,189 / 7,284 | 79% | 3,150 / 3,189 | 80% |
| Personal observation present, no rating | 321 / 321 | 82% | 136 / 137 | 85% |
| Rated five stars | 66 / 66 | 89% | 59 / 59 | 91% |
| Rated three stars | 17 / 17 | 79% | 33 / 33 | 78% |
| Rated 2½ stars or lower | 7 / 7 | 77% | 32 / 33 | 75% |

The in-history figures describe the live display with all personal evidence available. The separate title-withholding experiment removed each target's entire history and still found high low-rated predictions. This account had zero dropped movie or show roots in its taste history, so it cannot validate the dropped cohort. Of the 136 titles that received no percentage, 129 had only contextual or missing evidence and seven fell below the evidence threshold. Neither group enters the percentile denominator.

| Displayed score | Movie count | Show count |
| --- | ---: | ---: |
| Below 50% | 281 | 117 |
| 50–59% | 13 | 89 |
| 60–69% | 81 | 213 |
| 70–79% | 3,758 | 1,189 |
| 80–89% | 3,775 | 1,965 |
| 90% or higher | 46 | 141 |

Animation had a median match of 82 across 1,301 movies and 78 across 727 shows. Sci-Fi had medians of 82 across 1,163 movies and 85 across 1,007 shows. Documentary ranked lower, with medians of 72 across 71 movies and 66 across 184 shows, yet only four documentary movies and zero documentary shows fell below 50. Reality shows had a median of 56, with 28 of 82 below 50. A title can appear in several genre counts.

Animation medians were 82% for movies (1,301) and 78% for shows (727). Science Fiction movies and Sci-Fi & Fantasy shows had medians of 82% (1,163) and 85% (1,007). Documentary ranked lower at 72% for movies (71) and 66% for shows (184), yet only four of those movies and zero of those shows fell below 50%. The 82 Reality shows had a median of 56%, with 28 below 50%. A title can belong to several of these groups.

## Scores during browsing

A 1,440 × 900 browser journey on a second copy scrolled both the page and the rows. Each of the 60 unique visible Library movie cards showed its exact catalogue score. Their median was 80% with a range of 35–92%, and 33 reached 80%. The For You journey reached 20 unique visible Recently added cards, five movies and 15 shows. Their median was 83%, their range was 73–90%, and 14 reached 80%. All 20 matched the catalogue census. The Requests and Activity rows rendered their own event cards and supplied zero taste scores.

The For You shelf in this comparison orders by addition date. It provides an independent view of the scores exposed while browsing. Personal recommendation shelves could have a different distribution and were outside this route sample. [Browser timing protocol](2026-11-22-card-taste-preview.md)

## Where the scores come from

Across numeric scores, the median raw affinity fit was 89 for movies and 90 for shows. The confidence adjustment reduced those medians to 81 and 82.5. The median rating-model corrections were −1 and zero points. The raw affinity value measures the direction of matching features before confidence, while the final score also incorporates learned selection patterns.

- A movie genre dimension matched on 7,932 titles and its aggregate fit fell below 50 on zero of them. Movie keywords fell below 50 on just two of 7,008 matches. For shows, genre fell below 50 on 41 of 3,707 matches and keywords on four of 3,008. These are within-title aggregates across recognized features. Single uncommon features can have lower affinities.
- Among titles scoring at least 80, genres and keywords together carried an average 73.5% of the affinity weight for movies and 79.4% for shows, counting an absent dimension as zero. Their median dimension fits were 82 and 81 for movies, 83 and 82 for shows. Even for movies rated 2½ or lower, the median confidence-adjusted base was 80 and the median rating correction was −4. The corresponding show figures were 80.5 and −7.
- Every sub-50 movie used one of two learned avoidance patterns, anime on 143 movies or TV Movie on 138. Those titles still had a median raw fit of 90 and median base of 80. Of the 117 sub-50 shows, 89 used a negative anime adjustment. Twenty-eight reached a low score from their underlying affinities and fitted correction. This split accounts for the relative scarcity of movies around 50–69.

This audit measures a single, positively skewed account on its actual catalogue. It establishes the location of the compression and the size of the selection effect. A double-digit difference in these numbers has no established interpretation as a difference in probability of liking a title. Assess any new calibration against blind low-rated titles alongside favourites, including other accounts with more negative and dropped observations.

## Does a higher band predict enjoyment?

Five fixed work-level folds withheld each rated title and its tracking evidence from the training profile. This measures the integer displayed by the personal scorer. A like means the account eventually gave the title at least four stars. Confidence percentages in the table would suggest a literal probability, so the comparison uses observed counts alongside each mean. It applies only to works this viewer chose to rate. [Replay implementation](../../scripts/taste-replay.ts)

| Blind prediction | Movies liked / scored | Mean movie match | Shows liked / scored | Mean show match |
| --- | ---: | ---: | ---: | ---: |
| Below 70 | 1 / 1 | 67.0% | 6 / 26 | 64.7% |
| 70–79 | 66 / 107 (62%) | 76.7% | 56 / 112 (50%) | 75.6% |
| 80–89 | 246 / 322 (76%) | 84.0% | 202 / 259 (78%) | 84.7% |
| 90–100 | 13 / 14 (93%) | 90.8% | 23 / 31 (74%) | 90.8% |

The 80s identified more likes than the 70s in both media. The most reliable movie bin contained only 14 examples. On shows the small 90+ slice did no better than the 80s in this replay. As probability forecasts, the displayed scores had mean squared error of 0.2000 for movies and 0.2231 for shows. A constant forecast using each training fold’s four-star rate scored 0.1959 and 0.2226 respectively. Lower error is better. Coast can order titles usefully while the absolute percentages overstate the distinction. Hiding training ratings entirely moved every held-out movie below 70, along with 426 of 428 scored shows. The concentration in the 70s and 80s depends strongly on the rating evidence in this account.

### Two false highs and a control


The first experiment worth testing is to measure how well a genre or tag distinguishes this viewer’s favourites from their weaker titles, alongside its absolute affinity. For example, Comedy can remain a liked genre while providing less support for predicting a new favourite. Learn the correction on training data alone, preserve the current fit for sparse profiles, then check its effect on low-rated holdouts, five-star favourites and Animation/Sci-Fi in the same folds. Stretching the display alone could turn an already incorrect ordering into a more emphatic one.
