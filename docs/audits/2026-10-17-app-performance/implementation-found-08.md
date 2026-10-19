# Item-scoped Collection evidence — shared root repair

**Applied in the existing `collectionCTE` owner:** explicit work-ID requests now admit direct reasons and four screen/music parent inputs through their complete existing hierarchy closure. Full inventory and personal-shelf SQL and bindings are exactly unchanged. This advances DATA-14; global graph materialization, other broad helpers and missing natural cohorts remain partial. The whole known-work queue is unfinished, and unchecked areas stay deferred.

## Why the restriction is safe

Explicit-ID roots come from the requested canonical works and their ancestors; descendants include those roots and all their members. Every direct/inherited/member-derived reason needed by a scoped assessment therefore references a work in that closure. Joining direct evidence to `scoped_works` removes unrelated user evidence before preference/drop evaluation without truncating the requested hierarchy or reason payload.

Observed show/album inputs and next episode/track parent candidates now use the same scoped parent predicate. Each admitted parent still checks all children needed by the existing completion/next rules, preserving specials, release dates, gaps, order, availability, privacy and source freshness. This restriction is emitted only for array scopes. Personal roots depend on direct evidence, so narrowing that path would create a cycle; its original SQL is retained. There is no new cache, cap, API/DTO, index, dependency, UI design or command behavior.

## Actual-data verification and staged source epochs

Two independent read-only acceptance stages each preserve **96 complete ordered assessment-row outcomes, including exact reason arrays**, across all four existing owners and all nine existing kinds: album, Collection, comic, episode, game, movie, season, show and track. Each stage includes eight actual60-item batches, eight existing-source-filter cases, self/other viewers and44cases with positive reason rows. Books are absent; comic personal-history and other missing policy/topology cohorts are not fabricated. The statements sort by assessment ID for comparison; existing callers consume assessment identities via maps/sets, not a new promised SQL result order.

The [direct-reason receipt](evidence/implementation-found-08-direct-actual.json) compares the original owner with the intermediate direct admission. The [parent-evidence receipt](evidence/implementation-found-08-parent-actual.json) compares that intermediate owner with the final four-parent restriction. These are staged equivalence proofs on the actual clone, not192independent populations or a combined original-to-final endpoint benchmark. Source snapshots pin all three bodies. Both reserved transactions verify repeatable-read READ ONLY, JIT disabled, the existing local recursive estimate,30-second statement/one-second lock bounds, then rollback/release/close. Complete objects remain private; no fabricated catalogue or provider response is inserted.

The maintained probes also require exact full/personal compiled SQL and parameter identity. Those controls avoid changing a broader path; they are not newly executed full-inventory acceptance. No top-level mutation/provider lifecycle or active recommendation/queue cohort is invented.

## Read work, including adverse observations

Each stage has16actual self/item plan pairs and three alternating warm SQL sample pairs per case. All16plans in each stage use fewer shared hit+read visits. Direct admission has lower warm medians in14cases, with two album regressions. Parent admission has lower medians in15cases, with one album regression. Individual EXPLAIN elapsed samples can also be slower. Retain these observations; this is read-work reduction, not a universal latency, CPU/RSS, physical I/O, wire, DOM, heap, write or WAL claim. Stage timings come from separate captures and must not be summed into an endpoint speedup.

### Direct reasons: original → intermediate

| Actual owner ordinal / kind / viewer | Buffer visits | Warm SQL median ms |
| --- | --- | --- |
| 0:album:self | 44,920 → 41,527 | 376.83 → 429.64 |
| 0:game:self | 38,598 → 35,205 | 361.55 → 346.21 |
| 0:movie:self | 39,531 → 36,138 | 403.38 → 365.56 |
| 0:show:self | 46,040 → 42,647 | 358.25 → 332.29 |
| 1:album:self | 120,351 → 66,656 | 509.05 → 350.87 |
| 1:game:self | 114,037 → 60,342 | 536.50 → 434.66 |
| 1:movie:self | 114,969 → 62,360 | 600.52 → 401.35 |
| 1:show:self | 121,471 → 69,912 | 493.29 → 379.46 |
| 2:album:self | 61,233 → 45,332 | 405.52 → 432.06 |
| 2:game:self | 54,712 → 38,811 | 726.68 → 593.87 |
| 2:movie:self | 55,851 → 41,447 | 372.70 → 345.89 |
| 2:show:self | 62,353 → 48,246 | 407.70 → 385.05 |
| 3:album:self | 102,668 → 87,803 | 475.20 → 463.53 |
| 3:game:self | 96,063 → 81,198 | 376.91 → 345.14 |
| 3:movie:self | 97,274 → 82,409 | 414.10 → 360.32 |
| 3:show:self | 103,781 → 90,603 | 747.95 → 461.45 |

### Parent evidence: intermediate → final

| Actual owner ordinal / kind / viewer | Buffer visits | Warm SQL median ms |
| --- | --- | --- |
| 0:album:self | 41,518 → 41,096 | 361.39 → 329.56 |
| 0:game:self | 35,197 → 34,758 | 319.38 → 290.68 |
| 0:movie:self | 36,129 → 35,690 | 333.58 → 308.59 |
| 0:show:self | 42,638 → 42,199 | 367.60 → 331.94 |
| 1:album:self | 66,647 → 38,748 | 349.92 → 353.64 |
| 1:game:self | 60,334 → 32,435 | 317.77 → 281.24 |
| 1:movie:self | 62,349 → 34,450 | 334.74 → 298.38 |
| 1:show:self | 69,901 → 42,627 | 358.08 → 298.64 |
| 2:album:self | 45,323 → 40,050 | 326.84 → 280.88 |
| 2:game:self | 38,803 → 33,530 | 293.50 → 262.85 |
| 2:movie:self | 41,436 → 36,163 | 369.14 → 312.85 |
| 2:show:self | 48,235 → 43,124 | 325.74 → 320.90 |
| 3:album:self | 87,794 → 41,918 | 345.25 → 301.12 |
| 3:game:self | 81,190 → 35,297 | 311.49 → 268.94 |
| 3:movie:self | 82,400 → 36,507 | 337.04 → 301.18 |
| 3:show:self | 90,592 → 44,717 | 423.59 → 328.90 |

The [edge-inlining alternative](candidates/collection-item-edges/actual.json) matches 16 complete actual outcomes but is slower in all 16 warm median cases and increases read work. It is rejected and was never applied. The initial direct-candidate cohort selector also hit its 30-second statement bound because the probe used a correlated catalogue count. That was a probe defect, not an app failure; the [failed receipt](candidates/collection-item-direct/failed-cohort-selector.json) and source remain intact. One grouped count fixes selection before the successful pilot/acceptance runs. No timed-out comparison is marked passed.

## Normal development and common checks

The final production source passes a native authenticated **GET `/api/v1/notifications` at localhost:5173**, returning 12 real notices, nine with media assessment, expected JSON shape and no warnings/errors. The existing `requireUser` and inbox hydrator reach this shared owner. No seen/read/dismiss/toast/domain/playback command was submitted. The [normal receipt](evidence/implementation-found-08-normal.json) is functional consumer smoke; full row comparison remains on the actual clone. Routine application read telemetry may still occur. The browser was restored to the actual Profile history page.

Final [gates](evidence/implementation-found-08-gates.json): **839 passed, 715 guarded skips, 0 failures, 34,218 assertions**; Svelte/type 0 errors / 0 warnings; production build/navigation drift, source/UI inventory and style pass. The guarded skips are not actual-data acceptance. Earlier direct-only checks remain archived separately from final-source checks.

## Drift and unresolved work

[performance.md](../../performance.md#admit-collection-evidence-through-its-existing-hierarchy-closure) records scope independence, complete-parent evaluation, shared consumers and reproduction. The [source manifest](evidence/implementation-found-08-source.json) and exact [one-owner patch](candidates/found-implementation-08/runtime-owner-changes.patch) preserve the initial/intermediate/final source epochs and rollback boundary without overwriting earlier working-tree changes. The maintained [direct probe](probes/collection-item-direct-real.ts) and [parent probe](probes/collection-item-parent-evidence-real.ts) fail on incompatible source drift; historical snapshots remain evidence, not automatically current-source acceptance.

DATA-14 remains partial: global edges, remaining whole-owner helpers, large reading history, absent guest/privacy/topology/source-withdrawal cases, whole-consumer concurrency and native resource distributions remain unresolved. Related inbox/recommendation/music consumers receive the same owner change, not independent additive savings or universal consumer acceptance. Tasks retains its explicitly selected query/index pair. [Known open/partial work](implementation-queue.md) is separate from the [unchecked roadmap](follow-up-roadmap.md); current counts remain 24 open and 36 partial canonical records.
