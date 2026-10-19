# Shared Profile genre-history reuse and rejected Collection candidates

**One production repair applied:** the existing shared Profile summary now evaluates dated history and genre membership once inside each genre-filtered history query. Full page, section refresh and insight totals use the same owner. This advances PLAN-08; it does not mark Profile, the whole audit or all known work complete. Unchecked areas remain deferred.

## Applied repair and actual-data proof

The previous Other filter expanded the same genre input twice, alongside the filtered event stream. The canonical summary now materializes permission-filtered period events and their distinct genre membership only when a genre is selected. Named genres and Other retain their original ranking, membership, metadata precedence and downstream query/kind/repeat/date filters. Unfiltered SQL and its parameters are exactly unchanged. Existing recorded-History count/page reuse, clamping and event-ID order remain in place. No cross-request cache or API/DTO change was introduced.

The [actual read-only clone receipt](evidence/implementation-found-07-profile-actual.json) records **108 complete equal outcomes across all four existing owners**: full Profile pages with natural top/Other/no genre, first/far pages, all/month/year, repeat/episode/date selections; other-viewer/guest section outcomes; and self insight totals. It runs exact baseline/candidate bodies with import paths relocated privately. No catalogue rows or provider responses are fabricated. Natural absent/privacy cohorts remain absent; no universal policy coverage is claimed. The reserved transaction was repeatable-read READ ONLY, JIT off, 30-second statement/one-second lock budgets, zero external fetches, then rollback/release/close. Production source is exactly the tested candidate.

All eight selected-genre plans visit fewer read buffers, with no temp writes observed. Four alternating warm local SQL pairs per case have the following medians. These are descriptive SQL samples, not endpoint/browser latency, CPU/RSS or production tails. Cache residency changes across samples; shared hit + read visits are shown together.

| Actual owner ordinal | Filter | Buffer visits before → after | Local median ms before → after |
| --- | --- | --- | --- |
| 1 | Top genre | 20,361 → 11,079 | 31.39 → 18.71 |
| 1 | Other | 31,440 → 11,079 | 44.97 → 16.53 |
| 2 | Top genre | 47,716 → 38,434 | 69.41 → 54.58 |
| 2 | Other | 86,150 → 38,434 | 119.34 → 57.56 |
| 3 | Top genre | 25,266 → 15,589 | 35.96 → 21.75 |
| 3 | Other | 44,511 → 15,589 | 62.38 → 28.34 |
| 4 | Top genre | 63,880 → 54,598 | 82.45 → 77.31 |
| 4 | Other | 118,478 → 54,598 | 154.54 → 87.87 |

One top-genre EXPLAIN execution on owner3 is slower despite fewer buffers; the receipt retains it. Unfiltered controls have unchanged SQL and buffer totals, with ordinary timing variation including one slower median. The materialized relations consume statement-local resources; no heap/peak-memory budget or write/WAL reduction is asserted. Shared activity's separate day/genre/previous-period statements remain broader PLAN-08 work.

## Normal development and checks

Signed-in [normal development rendering](evidence/implementation-found-07-profile-normal.json) at localhost:5173 shows Other genres / Last 365 days, ten date groups containing 28 actual entries, no error overlay and zero warnings/errors. This uses the final production source and the chart's observed destination. An attempted pointer interaction with the chart's selected link changed the selected mark rather than establishing navigation, so the exact observed URL was loaded directly. This is rendered smoke, not acceptance of that chart interaction or a full before/after normal-database DTO comparison. No domain, settings or playback command was submitted.

Final [checks](evidence/implementation-found-07-gates.json): **839 passed, 715 guarded skips, 0 failures, 34,218 assertions**; Svelte/type 0 errors / 0 warnings; build/navigation drift, code/UI inventory and style all pass. Guarded skips do not represent actual-data acceptance. The two maintained actual-data probes and pinned source snapshots preserve direct reproduction. No new unit test mirrors the SQL implementation.

## Collection continuation: three candidates remain unadopted

DATA-05 production source is unchanged. The actual catalogue has 413 Collections, 1,348 collection/franchise edges, four owners and no saved rewatches, started playlists or dropped states. The alternatives preserve episode expansion/fallback in their reviewed designs, but missing cohorts are not manufactured.

1. [Reverse from all user progress](candidates/found-implementation-07/continuations.reverse-from-all-progress.actual.json): all 188 complete continuation/planner/hero/hydrated Progress comparisons match, including ordered sequence Maps and far-page clamps. It expands unrelated large histories; warm medians for three owners regress from roughly 5 ms to 10–45 ms and buffer work grows. Rejected.
2. [Reverse only from relationship targets](candidates/found-implementation-07/continuations.reverse-from-targets.actual.json): four complete continuation comparisons match and all four query plans use fewer buffers. Three warm medians are slower. No full 188 schedule was repeated for this different candidate. Unadopted.
3. [Shared Collection descendant reachability](candidates/found-implementation-07/continuations.shared-descendants.actual.json): four complete continuation comparisons match and all four plans use fewer buffers; warm medians are mixed. The SQL deduplicates root/descendant pairs and excludes recursive return to the root, preserving the original self-edge exception. This topology argument is not a positive actual cycle cohort. No full 188 schedule or causal CPU/heap proof establishes overall adoption. Unadopted.

The exact [applied one-owner patch](candidates/found-implementation-07/runtime-owner-changes.patch) and [source manifest](evidence/implementation-found-07-source.json) distinguish adopted source from those experiments. The user-selected Tasks query/index hold is unchanged. The [known queue](implementation-queue.md) still contains open/partial findings; the [unchecked roadmap](follow-up-roadmap.md) is separate. Current counts remain 24 open and 36 partial canonical findings; they are overlapping work records, not completion percentages.

[Actual Other-genre Profile history (private verification image)](publication.md#private-verification-images)
