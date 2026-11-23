# Private friend taste comparison

The movie and show comparison builds from activity and opinions visible to the requesting viewer. Shared viewing counts canonical works. Rating agreement requires both people to rate the same actual item and caps the contribution at one pair per show. Independent preference similarity uses the new personal affinity trainer on visible works that only one side has evidence for. Shared titles therefore enter the direct agreement measurement once. The headline combines qualifying agreement and trait evidence. Viewing the same titles alone cannot manufacture taste agreement.

A genre or credit must have evidence across two independent works or franchises on both sides. Similarity needs two comparable traits, weights signed agreement by the weaker confidence, and limits the contribution of a whole feature family. Works invisible to either side stay out of that side’s projection. The implementation checks current friendship, feature permissions, insights and screen visibility, then gates activity, progress, ratings and favourites individually. It only fetches metadata for permitted independent works. Caches of personal models do not cross the friendship boundary.

## Evidence from the dev copy

The copied account had three accepted friends with screen insights and ratings sharing enabled. The maximum number of jointly rated **direct root** movies or shows was zero across all three friends and both media. The viewer still had shared viewing with every friend. On the initial read, independent visible activity supported a trait comparison for three movie pairs and two show pairs. Hidden titles and people are omitted from this report.

These data can exercise the interface, its abstentions, and the permitted evidence path. They cannot validate whether one friend’s opinion predicts the viewer’s eventual rating. No peer study was enabled on the copy. The ordinary personal card score receives zero peer contribution.

## Separate item experiment

The private inspector supports optional, locally stored prospective studies for a consenting pair. Seal the viewer’s candidate predictions first with the replay runner. Then capture the friend’s visible opinion or watch before any viewer outcome. Use an owner-only folder and new filenames for each step.

```sh
bun docs/audits/2026-11-23-taste-v2/friend-study.ts seal --consented VIEWER_UUID FRIEND_UUID private/personal-ledger.json private/pair-seal.json
bun docs/audits/2026-11-23-taste-v2/friend-study.ts label private/pair-seal.json private/verified-viewer-ratings.json private/pair-study.json
```

The seal command reads the designated local dev database. Supply that viewer’s own paired v2 ledger from this exact model. Run the label command when verified original rating times are available. It accepts the same canonical ID, medium, UTC timestamp and star value used by the personal prospective evaluator. Existing viewing evidence, feedback from before sealing, contradictory first outcomes, and targets with a withheld personal prediction are excluded. Files are created with mode 0600 and exclusive creation. Set `COAST_TASTE_V2_PEER_STUDY` to the resulting study path on the private dev preview. Unset it or remove the study when consent is withdrawn. Raw files contain private work and participant IDs and belong outside source control.

A preregistered candidate blends 15% of a friend’s explicit rating with the independent personal fit on Coast’s signed star scale. A separately tested watch-only candidate adds 4% of the distance to the upper end. Those coefficients are hypotheses. The server admits neither result by default. Each comparison excludes the target from the peer’s validation works, disallows duplicate and future labels, and rechecks that historical and current opinions remain visible and current. File-backed forecasts require a matching model source digest.

Admission requires an earlier block of at least 12 works and a later block of at least eight, each with at least two weak and two liked titles three distinct rating days, and three independent works or franchises. Keep rating batches together. In both blocks the candidate must reduce mean absolute personal-fit error, also improve error when each rating day gets one vote, improve more works than it harms, preserve green genuine favourites and liked titles, and avoid additional weak greens. These are conservative rules for an experimental inspector. They do not establish transportability to another friend, medium, or self-hosted server. The explicit rating must also beat substituting the friend’s usual star rating, so a uniformly enthusiastic friend cannot qualify just because this viewer generally enjoyed the titles. Where several peers qualify, use the one backed by the most independent titles. Use a reported watch only where that signal passed its own tests. Where a target shares at least half the combined genre IDs with enough past examples, a single prespecified genre cohort may validate or veto the broader medium decision. Choosing this cohort upfront avoids searching individual tags for a favourable result.

## Verification

The five pure tests check disjoint histories, support breadth, opposing opinions, future-label exclusion, duplicates, same-day batches, target exclusion, genre-specific agreement and separate watch/rating admission. Five disposable PostgreSQL tests exercise real canonicalisation and permission checks, an improving paired study, duplicated provider watches, pre-outcome snapshot selection, hidden sections, hidden categories, deletion of earlier ratings, and unfriending after a previous successful inspection. The private screen page uses the existing shelf, progress labels, context filters and stable pagination. A narrow query loads the selected visible list at the original episode/season/movie granularity; the comparison is returned in the initial HTML. Tests cover shared, only-you and only-friend membership, clamped pages and hidden progress. Other media and ordinary live requests retain the incumbent comparison.

### Performance

On the local copy, nine post-warm-up calls per medium used three accepted friend pairs and three alternating repetitions per pair, one request at a time. The incumbent includes all supported media, its existing aggregated statistics, and its selected overlap page. The candidate measurement is the explicit per-medium comparison before adding the separately paged shelf; the two functions return different payloads. Concurrent unrelated development workloads were present.

| Inspector operation | Movies, median [range] | Shows, median [range] |
| --- | --- | --- |
| Incumbent friend insights | 32,376 ms [23,142–52,317] | 26,286 ms [21,033–64,681] |
| Candidate personal-trait comparison | 390 ms [294–971] | 608 ms [342–1,375] |

A separate PostgreSQL plan explained a 40.3-second incumbent query. A nested self-join scanned the materialised labelled history 22,755 times; that scan consumed 38.9 seconds. The new private screen entry avoids that full query. It computes visible membership directly by title ID, paginates in SQL before work-card hydration and calculates the independent comparison concurrently. The stable scorer was left in place.

The completed private profile loader, including its header, affinity comparison and hydrated grid, took 1.67 seconds for a shared movie page (13 items), 1.04 seconds for a shared show page (21 items), 1.06 seconds for a viewer-only movie page (60 of 13 pages), and 0.91 seconds for a friend-only movie page (six items) in one sequential copied-account check. These are different workloads from the function timings above.

An isolated, signed-in Chromium run at 1200×820 confirmed the comparison and both-watched figure are in the initial HTML. The same friend page reached visible metrics after 3.97 seconds with the private entry; before the change, it took 38.25 seconds while waiting for the incumbent query. These are single dev runs, not a production percentile. Switching Movies to Shows updated the pressed segment and the existing media shelf. A friend-only deep link worked. The initial render made zero duplicate comparison API requests. At 390×844 the page fitted the viewport. The test observed no runtime overlay, page errors, or relevant console errors. Privacy revocation and missing shared ratings are covered separately by the database fixtures.

The signed-in browser then opened the viewer-only list and clicked its Next link. Page two displayed different media cards and retained its selection in Coast’s nested profile detail URL. The overlap context menu switched from that page back to Shared items and reset pagination. Both interactions completed without a runtime or console error.

## Normal profile and API verification

The profile Taste segment and the signed-in social insights API share one comparison for movies, shows, games, music, books and comics. Coast checks both accounts’ feature access, friendship, medium and section permissions before aggregating evidence and again before returning the result. Private personal profiles are never used in the comparison.

Ratings contribute one paired opinion per movie, show, album or other root, and both people must have rated the same underlying work. The agreement and rating-order metrics include the entire shared rating history. A histogram of paired stars keeps the response bounded even for large histories. Progress and overlap retain individual episodes and tracks and paginate in groups of 60. Only independent titles contribute to trait similarity. Coast loads at most 300 per person per medium, in batches of 128, and skips catalogue hydration where either side has fewer than two independent works. The full-media summary and a medium-specific request use the same evidence.

On the copied development account, after the database test suites finished, a comparison with the accepted friend who had the largest watched history took 1.07 seconds across all media, 1.20 seconds for a movie-filtered shelf and 1.58 seconds for a show-filtered shelf. The full profile loaded in 1.13 seconds. Running the same comparison alongside fresh database migrations and type checks increased the first all-media time to 7.09 seconds. These are individual development observations.

The authenticated browser received an HTTP 200 with the comparison already in the initial HTML. Shared preferences were visible after 1.33 seconds. Switching from Movies to Shows matched the score returned by the normal API for each medium. The friend-only Shows deep link worked, the 390-pixel viewport fit, and the page made zero duplicate comparison requests. The database tests cover denied categories, section revocation, removal of a friend, ratings on different episodes, 321 shared ratings, and All-media parity for an enabled game catalogue.
