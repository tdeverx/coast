# Fresh criteria follow-up: discovery, recommendations, taste, experiments and statistics

Audited 15 October 2026 against working tree on baseline `ea01908654db7c0b4cf591028c7f9b321c6896dd`. Read `docs/performance.md`, audit README, original recommendation report and feature owners. Initial discovery was read-only; coordinator then explicitly authorized the three narrow repairs below. No services, DB operations, real providers, credentials, builds/full checks, dependencies, schema, commits or visual changes were performed by this worker.

## Confirmed findings and repairs

### DCF-01 / PERF-26 extension — P2, high confidence: a retained numeric offset still drifts over regenerated definitions

Discovery locations: `src/lib/recommendations/feed.server.ts:15,45-46` and `src/lib/recommendations/DynamicFeed.svelte:18-24,28-35` before this repair. Current owners: `feed.server.ts:10-49`; `DynamicFeed.svelte:15-40,59-63`.

The earlier fix correctly removed offset reset on content revision. However, every next-definition request still regenerated and ranked definitions using *current* interest evidence. A stable seed and offset do not freeze a changing ordered census. This is a demonstrated residual of PERF-26, not a repeat of its fixed reset bug.

Actual-owner probes replaced only config/evidence/SQL boundaries. With 20 synthetic liked movies (one distinct genre each), `dynamicFeed` generated 62 definitions. After consuming 30 definitions:

- Dropping one existing work regenerated 59 definitions. The retained offset 30 permanently skipped still-eligible, previously unconsumed `screen:Genre 19:show`.
- Adding one liked work regenerated 65 definitions. The retained offset replayed three consumed keys (`screen:Genre 16:movie`, `screen:Genre 1:movie`, and seed work 8), which would each cost one request and produce no new row. Three newly inserted definitions were above the offset and omitted for the visit.

The probe used one medium and zero synthetic adjacency results, so each redundant request additionally caused one evidence-boundary read, one adjacency query and ranking. This is operation amplification and identity/cursor evidence, not a PostgreSQL latency measurement. Probes: `/private/tmp/coast-feed-cursor-probe.ts` and `/private/tmp/coast-feed-cursor-weight-probe.ts` retain the discovery-time invocation shape; that obsolete offset contract was intentionally removed by the repair.

Coordinator-approved smallest repair: return one complete **definition-only census** per visit, retain it in the component, reveal one row at a time through the existing bottom/settlement gate, and continue fetching each row's cards lazily through Shelf. The server explicitly rejects more than 10,000 definitions with HTTP 413 / `feed_definition_limit` instead of silently truncating. No table, server cache, growing request cursor or compatibility shim. Same seed ranking/titles are preserved. User and medium-gate changes discard the census and abort obsolete work; content revisions refresh existing Shelf contents without changing definitions.

Evidence after repair: compiled actual component reveals all 62 original identities exactly once despite replacement/reversal of subsequent server evidence; **one census request** serves all reveals, including after 30 consumed rows. One call of the actual server owner performs one evidence read and one adjacency read for this fixture and returns all 62 definitions without card fields or weights. Actual server construction accepts exactly 10,000 definitions and rejects overflow before ranking the oversized list.

Tests: `tests/dynamic-feed-client.test.ts` covers one-row gate, revisions, full ordered identity retention, scope cancellation, late delivery, disposal, failure retry and empty completion. `tests/dynamic-feed.test.ts` executes actual server construction with synthetic boundaries, exact census and explicit cap. Existing `tests/invites-experiments-db.test.ts` was updated from offset paging to complete census semantics; coordinator must execute it in the serial disposable DB gate.

Tradeoff: the first feed-definition response now carries all bounded definitions rather than 1–3, while cards/renderers remain lazy. It removes repeated full preparation per row. This count bound does not claim physical-byte transfer or production heap measurements.

### DCF-02 — P2, high confidence: For You retained withdrawn/previous-viewer cards during replacement and after failure

Discovery location: `src/lib/ui/shelves/for-you.svelte.ts:35-41` before repair. Current owner: `for-you.svelte.ts:18-22,33-35,42-59`.

The refresh effect started new work for viewer or experimental-gate changes without clearing settled data. A synthetic held request through the compiled actual source confirmed the old viewer music item stayed visible during replacement. A failed replacement retained it indefinitely. Disabling music had the same effect. Keeping settled items on an ordinary transient same-owner refresh is useful; that policy must not carry withdrawn context across ownership/gate changes.

Probe: `/private/tmp/coast-criteria-discovery-probe.ts` observed two total GET calls (initial plus replacement), old item retained while pending and after synthetic failure for both viewer and music withdrawal. The repaired disabled-source path does not issue the second GET at all.

Repair: use a primitive scope separate from content revision. Changed viewer, feature gates or fixed row inputs clear settled items before refresh and abort previous work; disabled category/subtype/Planning selections remain empty without a request. Re-enabling resumes activated sources. Fixed row category changes update the actual selected category. 403/404 clears settled data, while transient same-owner failures preserve it. Never-activated rows remain lazy; equivalent context wrappers do not trigger requests.

`tests/ui-for-you-source.test.ts` runs the actual compiled owner and covers prior-viewer clearing, failed replacement, stale response cancellation, medium/subtype/Planning withdrawal and re-enable, never-activated state, unchanged object replacement, same-owner transient errors, denied results and fixed category replacement. Four tests / 29 assertions pass. This is source/runtime acceptance, not rendered authenticated-navigation certification.

### DCF-03 — P3, high confidence: sparse annual activity iterated every quiet day

Shared owner `src/lib/profile/activity.ts:2-18` before repair; optimized branch currently `activity.ts:17-40`. Consumers: `src/lib/ui/charts/activity.ts:14`, profile/media insight adapters; not the preview geometry renderers.

For all-time periods beyond 730 days, output already consists of calendar-year buckets. The old implementation still allocated/formatted one date for every elapsed day. Actual imported `activityBuckets`, fixed today `2026-10-15`, two known rows and five warm timed samples:

| Earliest input | Output year buckets | ISO conversions before | After |
| --- | ---: | ---: | ---: |
| 2016-10-15 | 11 | 3,653 | 24 |
| 1976-10-15 | 51 | 18,263 | 104 |
| 1926-10-15 | 101 | 36,526 | 204 |

The 30-day sample stays at 30 conversions. All results retain total 10, exact partial first-year and final-year boundaries and quiet years. Approximate local warm medians before/after: 0.516/0.0067 ms (10 years), 2.539/0.0277 ms (50 years), 4.844/0.0499 ms (100 years). These were separate before/after process samples, not alternating controlled production measurements; operation counts are the robust evidence. Raw probe `/private/tmp/coast-activity-buckets-probe.ts`.

Repair: for the existing annual mode only, iterate year boundaries and aggregate recorded dates by year. Preserve duplicate-day last-write semantics, exact date validation, future exclusion, leap boundaries, zero years and the existing 730-day transition. No mark truncation, altered dates, arbitrary new aggregation or chart appearance changes. Cost is proportional to input dates plus output years rather than elapsed days (the existing initial date sort remains).

`tests/profile.test.ts` adds exact daily-oracle parity across sparse long intervals/leap dates/duplicate dates/out-of-window and invalid dates, cutoff checks, plus a structural conversion budget (`<= 2 * year buckets + input rows`) over a century. Existing month/year/weekly tests remain unchanged and pass.

## Healthy coverage retained

- Ranking bucket optimization and compile-once taste scoring have exact seeded-order/equivalence and operation-growth tests. No new defect reported for these repaired owners.
- Taste refresh freezes <=10 users, fences publication by active attempt in its transaction, commits checkpoint with user publication, and yields at committed user boundaries (`social/taste-cache.server.ts:51-119`). Existing personal revision recheck remains authoritative. No DB cancellation/resume certification claimed by this worker.
- Provider recommendations freeze <=6 seeds, preserve account generation checks and active lease at save, checkpoint/yield and canonical ingestion. Freshness timestamps on unchanged successful sets are deliberate; not flagged as blanket no-op writes.
- Recommendation card reads remain provider-free, use current account generation, privacy and feature constraints, <=2,000 preselected candidates and shared 60-card hydration. No SQL rewrite/index justified without plans.
- Discover source retains <=20 cached selections, cancels stale work, clears caches on revisions and withdrawn mediums/subtypes, and leaves never-activated rows lazy. Existing four compiled-owner tests pass. Reading provider pages retain their explicit limit; shared screen/game/music presentations are reused.
- Planning scheduled census is capped at 100 and pages at 60; friends capped at 20; reminders revalidate friendship. No timers or provider work introduced by planning reads.
- Chart preview retains a finite fixture/medium model key space, one selected renderer, static thumbnails, 24 exact-data rows/page, geometry derived from stable model/style and model-local label cache. Exact semantic/geometry tests pass. No arbitrary live-chart truncation or renderer architecture change is proposed.
- Production statistics use the dedicated BarChart/BreakdownChart presentations. The preview's packed bubbles/isotypes are not a basis for claiming a production mark explosion. DCF-03 concerns actual shared statistics preprocessing only.
- Media modal request abort/current-ID publication and enhancement deferral remain healthy. No speculative prefetch/cache introduced.

## Verification and remaining evidence gaps

Bundled `.tools/bun-1.4.3/bun-darwin-aarch64/bun`, focused 13-file run: **59 passed, 0 failed, 28,836 assertions**. Files: dynamic feed server/client/ranking; ForYou/Discover sources; taste profile/social; profile buckets; experimental features; chart standard/extended geometry, preview semantics and presentation. Scoped `git diff --check` passes.

Coordinator owns full type/build/inventory, serial disposable DB suite and rendered browser acceptance. No live latency/CPU/heap/leak claims. Still measurement-gated: pre-limit history aggregation in `interestWorks`, candidate SQL scans/window ranking, large-catalogue Discover music popularity and real provider/pool contention. A bounded response alone does not certify those query costs. Existing bounded preview fixtures do not certify arbitrary live chart datasets. Rendered census sentinel/open-close behavior and actual first-response transfer should be checked by the coordinator's existing browser fixture, without redesigning the accepted UI.
