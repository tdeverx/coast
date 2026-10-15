# Recommendations, taste, experiments and charts performance audit

Baseline: `ea01908`, `codex/performance-criteria`, 2026-10-15. Read-only audit; no production edits, DB/service starts, provider requests, browser calls, build or full check. Scope includes feed definitions/candidate reads/provider suggestion jobs, taste scoring, planning/detail-modal experiments and charts. Shared Shelf implementation itself is owned by the separate audit.

## Verification performed

- Read `docs/performance.md`, `docs/architecture.md` and the actual feature modules and existing focused tests.
- Bun 1.4.3: `bun test tests/dynamic-ranking.test.ts tests/taste-profile.test.ts tests/chart-standard-geometry.test.ts tests/chart-extended-geometry.test.ts tests/ui-preview-charts.test.ts tests/chart-presentation.test.ts`: **28 pass, 0 fail, 27,965 assertions**.
- Actual-module pure probes in `/private/tmp/coast-perf-recommendation-probes.ts` and `/private/tmp/coast-perf-feature-bounds.ts`. No duplicated production algorithms or provider/DB calls. Timings below are single local samples, not latency guarantees; deterministic operation counts are the useful evidence.

## Confirmed findings

### REC-1 — P2 / high confidence: repeatedly sorting the entire remaining feed pool creates avoidable superlinear CPU

References: `src/lib/recommendations/row-ranking.ts:9-18`; called before every slice at `src/lib/recommendations/feed.server.ts:45-46`.

`rankRows` recomputes the score multiplier and sorts the shrinking pool once for *every output definition*, even when the client asks for one row. Only the previously selected category and surface affect each multiplier. Personal evidence is capped at 300 root works, but every distinct subject/genre expands definitions; 600–1,000 definitions are possible without exceeding 300 evidence works.

Actual imported `rankRows` probe on deterministic mixed-category/surface definitions counted category-property reads: 100 definitions → 88,628; 300 → 1,041,526; 600 → 4,854,992; 1,000 → 14,172,304. Single-run elapsed samples were 2.15/11.38/38.60/137.45 ms, respectively. These accessor counters themselves add overhead; do not quote timings as ordinary production measurements.

Smallest fix: sort base ranks once into category+surface buckets; compare only each nonempty bucket's head using the current repetition multiplier/tie key. All members of a bucket have the same multiplier, so the remaining head is its minimum. Preserve *exact* current ordering, stable seed behavior and ties. Alternatively scan for a minimum each iteration (simpler, still O(n²)) if a measured small cap is deliberately adopted. Do not change loading concurrency or eager-load rows.

Acceptance: equivalence against the immutable current implementation for multiple seeds, empty/single rows, equal ranks/ties and multiple bucket combinations at 1/100/300/1,000 definitions; assert operation growth rather than a host-specific millisecond threshold.

### REC-2 — P2 / high confidence: affinity lookups are rebuilt for every scored candidate

References: `src/lib/social/taste-profile.ts:29-47`, especially line 35; `src/lib/social/taste-cache.server.ts:79-80`.

Each `scoreTaste(profile, features)` builds a new `Map` for every populated dimension. The job applies the same immutable profile to up to 500 candidates per medium. At 12 dimensions × 500 affinities × 500 candidates, an actual-module probe observes **3,000,000 affinity-ID reads** and 6,000 temporary lookup maps for one medium. These are allowed profile/candidate bounds; typical sparse data will cost less. Up to six medium profiles and ten users per run compound this allocation churn.

Smallest fix: compile one scorer/index per profile for the duration of that user's calculation, then reuse it for all candidates. Keep score/result/reasons exactly equal; retain the current convenient `scoreTaste` interface for individual calls if useful. Use calculation-local ownership, not a global personalized cache/WeakMap with unclear mutability.

Acceptance: existing negative-evidence/cast/sparse-confidence tests plus scorer-versus-current equivalence and deterministic counting that each affinity is indexed once per compiled profile rather than per candidate. Bound model lifetime to the user/job iteration.

### REC-3 — P2 / high confidence: taste refresh does not use the queue's cancellation/publication/yield contracts

References: `src/lib/social/taste-cache.server.ts:50-92`; registration `src/lib/providers/actions.server.ts:33`; required contract `src/lib/server/queue/execution.ts:17-54`. Correct adjacent example: `src/lib/recommendations/providers.server.ts:75-90,143-147`.

`refreshTasteCaches` calculates and publishes up to ten users in one worker execution. It neither calls `jobCheckpoint()` after a user commit nor checks `assertJobLease(tx,true)` inside the score/profile publication transaction. The personal revision check at lines 83-84 protects concurrent personal edits but does not detect an operator cancellation or recovered/replaced queue attempt. A cancelled worker can still replace scores, and expensive multi-user runs retain a worker beyond the queue's advertised five-boundary/ten-second cooperative scheduling policy.

Smallest fix: freeze the bounded ten-user census and progress/outcome counts in the existing outbox checkpoint (ten IDs, cursor, counters; no new storage abstraction), assert the active job lease inside the committing transaction after the user lock, save committed cursor/counters, then call `jobCheckpoint`. Direct invocations outside job execution should retain current behavior. If a user changes during calculation, record deferred and advance the frozen census instead of retrying indefinitely inside the same run. Do not treat `JobYield` as a provider failure.

Acceptance coordinated by root with DB fixtures: cancel/recover while calculation is pending → old worker cannot publish; resume after a committed user → no repeat publication and no new census; ten-user total bound survives yielding; concurrent personal edits still defer; normal pure scoring remains unchanged. These DB cases were **not run by this audit**.

### REC-4 — P2 / high confidence: personal revision changes replay all consumed definition pages

References: `src/lib/recommendations/DynamicFeed.svelte:20-25,29-35`; `src/lib/recommendations/feed.server.ts:15,34-46`; `src/lib/recommendations/interests.server.ts:6-23`.

The refresh effect keeps already-appended rows but resets `nextOffset` to zero. At the existing visible bottom, `load()` fetches one definition, deduplicates it, creates no `pendingKey` when the definition already exists, and immediately makes the next end sentinel eligible. If 30 definitions were already consumed and remain in the new order, a single tracking/social revision can cause **30 definition requests with zero new rows**, rather than waiting for one new row to settle. Each replay performs one evidence query (which aggregates complete personal histories before its final 300-root limit), up to four serial catalogue-adjacency queries, and the full rank operation above. This is a feature-specific duplicate request path, not an argument against one-row-at-bottom loading.

Smallest fix: preserve the feed's definition order/cursor for the existing visit while allowing existing shelves to refresh their content revisions; invalidate/reset a feed only on a genuine identity/experiment-scope change and make that reset explicit. If product semantics require immediate reconsideration of definitions after every personal edit, design one bounded reconciliation operation rather than walking every old offset. Retain append-only vertical order and the one-new-row/settlement/bottom gate. Do not introduce cross-request personal feed caching without a user + permissions + revision + configuration identity and bounded eviction.

Acceptance: load 30 rows, update tracking revision, keep bottom visible; unchanged definitions must not produce 30 definition requests, new rows still append individually after prior settlement, experiment disable removes its withdrawn surfaces, user changes clear personal state, and prior rows never reorder. Renderer/browser acceptance is **not claimed** here; root should test through the existing fixture harness.

## Cost hypotheses requiring root's fixture/plans before invasive SQL changes

1. Feed definitions are generated afresh on every offset. The final `rows.slice` does not bound *preparation* work. `interestWorks` aggregates every relevant historical signal before `limit 300`; global recommendation seeds use `interestWorks(null)` and consequently aggregate all enabled users' signals. That is real source-level work, but full aggregation preserves negative evidence and root collapsing; blindly limiting raw events would corrupt semantics. First remove REC-4 and REC-1, then measure repeated evidence/adjacency plans on large histories before deciding on revision-scoped reuse/projections.
2. `recommendationRows` (`query.server.ts:30-60`) filters broadly joined catalogue candidates, sorts by provider/taste-only score and caps 2,000 before full weighted scoring. The bound limits hydration/scoring but not necessarily candidate scans; the approximate preselection can exclude a high-overlap genre candidate when early provider/taste scores tie. No DB EXPLAIN or 2,000+ catalogue fixture was run, so treat planner and ranking impacts as hypotheses to validate, not established latency regressions.
3. Taste candidates (`taste-cache.server.ts:65-78`) use a GIN feature join and per-medium 500 result bound; the window function ranks the complete eligible catalogue. Inspect representative plans/cardinalities before replacing this with per-medium limits or new indexes. Avoid a parallel second ranking engine.

## Verified healthy patterns / do not redesign

- Provider recommendation refresh: ≤6 frozen seeds, ≤20 TMDB or ≤40 Trakt suggestions per seed, canonical item ingestion, save-set account generation validation, active lease check, persisted seed cursor and cooperative `jobCheckpoint`. No page-time provider calls (`providers.server.ts`).
- Feed cards are fetched separately through shared Shelf sources and `pendingKey` gating; first request is observer-triggered at a zero-margin bottom sentinel. Preserve that architecture.
- Charts: 256 fixtures, **858 finite fixture+medium cache keys**; actual-module enumeration max 365 data rows, 10 bubbles, 9 flow edges and 30 isotype symbols. The model cache is finite, not an unbounded live-user cache. One gallery specimen; static thumbnails; 24-row exact-data pages; selected standard/extended renderer imported only on demand. Standard/extended derived geometry depends on model/style rather than selected index; extended label-wrap cache resets per model. Existing tests cover precise values/geometry and all fixtures. No confirmed chart performance defect in current bounded preview.
- Packed bubble geometry has high-order work at arbitrary input cardinalities and isotype symbols scale with value/unit, but current private fixture consumers constrain these. Add **explicit aggregation/max-mark contracts before reusing these renderers on live unbounded datasets**, rather than inventing caps that would silently falsify today's exact data.
- Media-modal fetch uses AbortController cleanup, only publishes current-ID results, opens once base details load and defers enhancement. Layout imports it only after enabled + selected ID. Reading and screen presentations reuse existing details components. No supported need for new caching or speculative prefetching.
- Planning reads/counts bounded pages of 60 and scheduled plans capped at 100 per user; no timers/render loops or page-triggered provider calls. No confirmed performance fix in this feature.

## Criteria to add to performance.md

- A bounded result is not a bounded query or preparation cost: report pre-limit scan/aggregation size and per-page repeated work. Count query/HTTP amplification under content revisions, not only first-load latency.
- Pagination cursors and personalized ordering have a defined lifetime: keep the visit stable; invalidation must not replay consumed pages or move appended rows above scroll. Distinguish feed definition invalidation from existing row content invalidation.
- Compile reusable indexes/geometry once per immutable input and scope them to a finite calculation/component. Avoid reconstructing affinity lookups for each candidate and repeated full sorting for a one-item page.
- Every background publication has active-attempt lease fencing inside its commit and every multi-entity task has replay-safe committed checkpoints, bounded census, cancellation, yielding and resume tests.
- Report per-feature input cardinalities, expanded definitions, dimension/affinity/candidate counts, SVG mark counts and retained model keys. Synthetic tests should guard operation growth/equivalence instead of flaky millisecond thresholds.
- Preview-only bounded chart fixtures do not certify arbitrary live data. Live consumers need aggregation/mark bounds, unknown/zero semantics and exact-data access before adopting an expensive geometry family.

No local or live secrets were read. No tracked files changed.
