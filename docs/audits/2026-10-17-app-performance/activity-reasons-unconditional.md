# Activity materialization — complete equality, adverse filtered plans

The unconditional candidate remains **unadopted**. It preserves all 115 distinct actual request results, but the friend-filtered plan increases both shared-buffer visits and temporary reads. Watchlist reduces shared visits while increasing temporary reads. Those tradeoffs rule out claiming a universal gain or applying this fence everywhere.

The [immutable actual-data receipt](evidence/activity-reasons-unconditional-actual.json) contains 115 complete exported-feed DTO and ordered complete primary-row comparisons, 28 descriptive plans across 14 contexts, and zero timing-sample loops. The [exact probe](candidates/activity-reasons-unconditional/reasons-full-revised-candidate.ts), [reviewed plan](candidates/activity-reasons-unconditional/full-revised-verification-plan.json), source snapshots, protocol, preparation outputs and [independent result review](candidates/activity-reasons-unconditional/independent-results-review.json) are retained. No production helper changed.

## Per-family resource results

| Context | Root shared hit + read visits | Temporary read blocks | Temporary written blocks |
| --- | ---: | ---: | ---: |
| reaction-activity-ids | 233 → 233 | 0 → 0 | 0 → 0 |
| 0:observed-normal-movie | 525,477 → 6,085 | 2,696 → 2,696 | 4,412 → 4,412 |
| 0:largest-season | 525,513 → 6,121 | 5,488 → 5,488 | 4,412 → 4,412 |
| 0:largest-collection | 525,478 → 6,086 | 2,696 → 2,696 | 4,412 → 4,412 |
| 0:retained-active-show | 744,057 → 224,987 | 4,092 → 4,092 | 4,412 → 4,412 |
| 3:retained-active-show | 702,532 → 183,462 | 4,092 → 4,092 | 4,412 → 4,412 |
| unscoped-selected-initial | 914,398 → 914,398 | 0 → 0 | 0 → 0 |
| filtered-watchlist | 520,781 → 6,140 | 2,696 → 4,092 | 4,412 → 4,412 |
| 0:friend-other | 220,259 → 221,786 | 2,696 → 4,092 | 4,412 → 4,412 |
| 0:artist-relationship | 1,562,718 → 1,043,353 | 11,479 → 11,479 | 10,422 → 10,422 |
| 0:reading-group-relationship | 525,581 → 6,196 | 2,696 → 2,696 | 4,412 → 4,412 |
| 0:ancestor-episode | 525,477 → 6,085 | 4,092 → 4,092 | 4,412 → 4,412 |
| 0:collection-kind-member | 525,477 → 6,085 | 2,696 → 2,696 | 4,412 → 4,412 |
| mixed-roots | 1,564,231 → 1,045,192 | 11,479 → 11,479 | 10,422 → 10,422 |

The other 12 measured contexts have no increase in these root shared or temporary counters; all 14 temporary-write counts stay equal. Root counters describe the whole plan. They must not be summed with descendants, called physical disk I/O, or converted into CPU, heap, function-call or production latency claims. Single-plan elapsed fields are descriptive. The movie and show plans still scan 90,971 tracking rows on both sides and retain full-history grouping and spill work.

The friend baseline uses tracking index seeks (148 loops) and a bitmap path. Materialization instead admits a full 90,971-row tracking scan and a separate collected scan with 1,141 outputs and 89,830 filtered rows before applying the friend restriction. The watchlist baseline omits that separate collected branch; the candidate includes it. The retained plans support blocked selective pushdown and extra branch work as explanations. Rounded per-loop values are not exact row-work totals.

## Exact coverage and missing actual states

All 115 labels are unique executed input pairs; none reuses another comparison. The 69 helper-active calls change exactly one MATERIALIZED keyword with identical bindings. Twelve scoped helper-absent calls and 34 unscoped calls retain byte-identical SQL and bindings. Every DTO field and ordered primary row still executes and compares on both sides.

Four returned scoped cursor pages execute but return zero cards/events. Cursor presence is not a positive second-page result. Artist and reading-group contexts provide three and one events per viewer respectively, without relationship fallback cards. The progress filter supplies one fallback card and mixed roots supply four. Watchlist, lists and favourites controls are empty.

The saved data has 829 episode rows in the selected season, but the selected parents have zero tracking/collected states and all four episode child controls are empty. All 413 screen collection parents use 1,348 collection-kind links and zero contains links. Four collection-kind member controls are explicitly negative edge-path controls, not positive contains ancestry. All four saved audiences are friends, without section/category overrides or social-disabled preferences. Private/public audiences, policy withdrawal, dated multi-track and repeated dated-work listens remain absent. No state or event was fabricated to fill a missing cohort.

## Execution and provenance

The designated private clone is the only database target. One reserved repeatable-read READ ONLY snapshot holds the same backend and 30-second statement/one-second lock budgets, JIT off and 4 MB work memory. Exact policy function bodies/security/volatility and ordinary no-RLS relation metadata are verified. All 31 source/runtime pins match before and after. Rollback, pool closure, zero provider transport attempts and no task credential-key creation pass; the exclusive test lease is released. Current toast source versus the older clone schema is checked only as separate metadata; no notification or schema work occurs.

The [first failed broader run](activity-reasons-broader-verification.md) remains failed after 64 equal historical pairs and zero plans. Its separate counts diagnostic established the missing contains cohort. This revised run has a distinct probe, protocol and receipt, with the entire delta retained. Its repeated 64 comparisons add verification cost, not new coverage. The original pilot and failed artifacts remain immutable.

The normal-selected work exists in this clone, but normal owner/settings parity is unestablished. These results do not attribute normal UI latency, panel Back behavior, authenticated HTTP status or concurrent policy behavior.

## Narrower option

The next candidate materializes only relationship=all requests without friendId. It preserves the existing filtered and friend SQL byte-for-byte, and requires its own 115 comparisons and adverse-cost review. The unconditional result cannot substitute for that proof. Filtered-path optimization remains a separate option: push cheap friend/relationship predicates into the producer only after preserving all ancestry, privacy and fallback rules. No new cache, schema, dependency or architecture is justified by this result alone.

## Later selective proof

The [separately executed selective candidate](activity-reasons-selective.md) now matches115 unique complete pairs and28plans while preserving filtered/friend SQL and their resource counters. The unconditional candidate remains unadopted, and its adverse results are unchanged.
