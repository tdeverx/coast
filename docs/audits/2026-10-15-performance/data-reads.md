# Independent data/read-path performance audit

2026-10-15. Read-only production review. Scope: catalogue/collection hydration, profile/progress, social/taste reads, local search and public read APIs. Read current performance/architecture guidance, the 3 October implementation evidence and PostgreSQL performance skill (N+1, pagination, plans). No dev/live/provider calls, database starts, migrations or production edits were performed by this auditor.

## Findings, in implementation priority order

### DR-01 — Wide provider snapshots are loaded for every shared card page (high; statically proven cost, fixture supplied)

`src/lib/collection/query.server.ts:251-272`: `workCards` selects `{ item: providerItems, connection }` for **all requested IDs**, joining every viewer connection on the instance. Only the music branch consumes this result, and consumes only media ID, external ID, primary-image presence and connection ID. A screen page therefore downloads all connected Jellyfin item snapshots a second time, including unrelated provider metadata JSON. `mediaViews` already uses a narrow artwork projection at `src/lib/server/queries/media.ts:262-272`.

Smallest repair: after the existing music row read, run no mapping query when there are no music IDs; for music select only `mediaId`, `externalId`, `snapshot->>'primaryImageTag'` and connection ID. Keep viewer/connected/enabled predicates, current first-source selection and item ordering. Do not replace authoritative access checks or introduce a cache. This is a global shared card fix, not a For You workaround.

Required proof: controlled snapshots with 32–64 KiB unused metadata; exact card outputs remain equal after removing unused fields; compare returned projected JSON bytes (explicitly not physical protocol/network bytes), row count, SQL and actual `workCards` timings. Include one denied/disconnected account and more than one provider item mapping.

### DR-02 — Collection card progress performs serial per-card recursive reads (high; statically proven N+1)

`src/lib/server/queries/media.ts:453-454`: for each collection card, calls `sequenceEntries`; that service does a separate collection validation SELECT followed by recursive event/state expansion (`src/lib/core/lists/sequence.server.ts:21-117`). One 60-card collection page can issue 120 extra serial queries, and return every expanded entry merely to compute five aggregate values. Existing hydration page bounds do not bound recursive fan-out.

`src/lib/server/queries/continuations.ts:150-152` independently repeats the same pattern for all relevant collections and every started private playlist; this also runs on home hero/Continue planning via `progress.ts:157-175`. `src/lib/server/queries/lists.ts:161-164` expands a complete playlist even for a 60-entry display page.

Smallest first repair: add a focused batched sequence read/aggregate method inside the existing sequence module, sharing one SQL recursive/event/rewatch semantics definition rather than duplicating it. Use a `root_id`/source key and grouped aggregation for card summaries; callers requiring only the next entry should get that result from SQL rather than materializing every entry. Selected playlist pages should restrict expansion to selected entry roots. Retain unbounded *explicit full-sequence playback operations* where their existing contract actually needs the whole sequence. Do not parallelize all per-card calls; that changes serial latency into pool pressure without fixing work volume.

Required proof: 1, 12 and 60 collections; nested show/season membership, repeated playlist entries, duplicate leaves via two paths, cycles, dropped ancestors, watched/unwatched/progress, rewatch boundaries and dated-event ties. Exact normalized outputs versus existing `sequenceEntries`; query count should stay bounded by batch count, and transfer should contain summaries/next entries for summary callers. A runnable initial query-count probe is supplied separately.

### DR-03 — Parent-title captions trigger a second full screen-card hydration (medium; statically proven)

`src/lib/server/queries/progress.ts:99-107` and `src/lib/server/queries/profile.ts:247-250` call a full `mediaViewsForIds`/`mediaViews` pass only to obtain parent show titles. That reruns queue/state/rating, availability, artwork, metadata and configuration queries. `mediaViews` already resolves parent artwork metadata in the first pass (`media.ts:188-205,286-321`). Profile activity backgrounds also rehydrate a work even if it is already present in `cards` (`profile.ts:260-267`).

Smallest repair: expose resolved parent titles from the same screen hydration result (or a narrowly projected shared metadata-title helper with existing precedence), consume that in caption callers; reuse an existing by-ID card for activity backgrounds before a separate one-item hydration. Preserve metadata override/lock/original-title policies, owner-vs-viewer semantics and privacy masking. Do not use raw `media.title` alone as a replacement: it would change display precedence.

Required proof: 60 episodes from 60 parent shows, custom overrides/original titles, public/private progress, existing activity background in favourites. Same captions and hidden fields, fewer hydration queries and lower transferred rows; compare full normalised result objects.

### DR-04 — Hydration contract accepts >60 IDs but truncates screen results (medium correctness/performance; already roadmap, do not duplicate)

`workCards` passes all IDs to `mediaViews(...limit:60)` while the Activity feed can request 60 display IDs plus 60 roots (`social/queries.server.ts:55`), and reading cards have their own independent 60-row progress cap. Existing roadmap explicitly records this. The caller is not intentionally capped to 60 IDs: a page of 60 one-off episode watches across 60 distinct shows emits 60 episode display IDs plus 60 show roots, all deduplicated but still 120 unique IDs; the loop then needs each episode card to keep its event. Fix globally in bounded, ordered batches; do not increase one global limit to hide it. Deduplicate fetch identities while preserving requested order/repeated entry identity. Regression: 60 distinct episode activities with 60 distinct roots must retain every event/card and correct parent captions. This is prerequisite to changing feed pagination.

### DR-05 — Legacy all-lists read hydrates all list contents in one response (low / dead-code opportunity until a production caller is confirmed)

`src/lib/server/api/lists.server.ts:14` calls `userLists`, which reads every list item and hydrates the entire union (`queries/lists.ts:199-232`). Per-batch hydration does not bound total response, SQL or retained memory. Production UI already appears to use summaries and selected paged list loading; repository search found this legacy endpoint's direct function consumer only in `tests/domain-application-db.test.ts:779`.

Smallest repair decision: use existing list summaries and selected paginated list projection for ordinary reads; retire unused full expansion if truly unused, or explicitly turn it into bounded list-detail paging. Do not silently truncate its output while claiming equivalent behavior. Verify caller/API docs before changing a response contract. This is an internal browser route, distinct from versioned public API contracts.

## Investigation candidates (not established regressions; measure before edits)

- `progress.ts:157-175` loads the owner's entire screen tracking state before planning a 60-card page. Existing exact continuation logic explains some full-owner evidence, but dropped/zero-state candidates can potentially be filtered in SQL. A large owner fixture is needed before altering it. Never LIMIT before eligibility: would lose future eligible entries.
- `social/queries.server.ts:13-54` groups/deduplicates whole accepted-friend histories before final cursor/period/61-row limit. Indexing/output pagination alone cannot bound the window/aggregation cost. Arbitrarily pushing the cursor into raw events changes episode-run and album grouping, listen numbering, unknown-date ordering and group identity. This was explicitly parked previously. Measure 100k events/20 friends, then design durable grouped activity projection or exact boundary-preserving page selection; do not casually rewrite during generic batching.
- `social/taste-cache.server.ts:9-14,45,52` computes recommendation-set max freshness per candidate user. `connection_id is null OR c.user_id=u.id` can rewalk shared recommendations for each user, even though profile output is capped to ten refreshes. Candidate ranking also caps outputs after scanning matched catalogue. Capture plans with many users/sets/features, then hoist truly global aggregate once per statement if evidence shows repeated work. Preserve account and shared/personal revision semantics.
- Public catalogue/library uses bounded page hydration, but numbered deep OFFSET repeats scans/counts. Keep numbered-page contract unless intentionally introducing cursor API; measure page 1 and deep page with actual plans. Do not turn every bounded offset into speculative migration work.
- `collectionCTE` scopes work trees, but visibility categories, edges, music completion and next-episode/track CTEs can involve unrelated catalogue rows. PostgreSQL may push predicates/inlining effectively; do not assert full scans without EXPLAIN ANALYZE BUFFERS.

## Good existing methods to preserve

- Collection membership/privacy/access precedes pagination; scoped durable revisions and clock-dependent freshness avoid history hashing.
- Screen search branches use indexed native documents, bounded direct/prefix queries and owner-scoped private aliases; local search ranks before limits. Reading uses matching full-text candidate bounds and streams provider results separately.
- API read operations remain local projections; token scope and experimental category checks precede returned data.
- Shared SQL pool remains ten connections; read optimizations must not change reserved-session idle lifetime or hold transaction locks during provider I/O.
- Existing metadata snapshot screen hydration already excludes raw JSON and projects only artwork; do not undo it while fixing music/shared projections.

## Proposed improved performance criteria

1. State both **output bound and work bound** for each read. A 60-card output is insufficient if it expands every playlist or downloads provider snapshots/history first.
2. Record SQL count, rows and projected payload bytes for representative shared primitives, not just total wall time. Distinguish driver result bytes/JSON estimates from wire bytes and process RSS from per-operation allocation.
3. A shared page's SQL count must not grow one or two queries per card/root. Batch within the owning domain; avoid unbounded Promise.all as an N+1 repair.
4. Add fan-out dimensions to fixtures: roots, children/root, provider mappings/work, metadata JSON size, accepted peers, owner history size, source count and deep page. Test small and growth cases.
5. Preserve exact normalized IDs/order/counts/reasons/privacy, metadata precedence, unknown dates, group identity, repeated playlist entry identity and rewatch semantics. Query-count assertions may protect a demonstrated meaningful batch contract; don't use brittle source-text tests or elapsed-time limits.
6. Prefer no global caches for config/permissions until lifecycle/invalidation evidence exists. Request-local reuse or a narrower existing projection is simpler and privacy-safe.
7. Profile SQL with plans before adding indexes or planner settings. Preserve the existing controlled pre/post fixture method, alternate runs, warm-up, raw samples, PostgreSQL/Bun/build and dataset identity.
8. Separate heavy DB tests/benchmarks globally. Run one coordinated fixture at a time; do not let independent agents compete for the ten-connection test pool or host CPU and then call noisy timings regressions.

## Evidence limits

All findings above are source-proven structural costs or contract defects. No timing or memory improvement is claimed yet. The parent will run disposable probes centrally and compare exact results before accepting fixes. No live-provider/device certification is implied.

## Runnable bounded probe

`/private/tmp/coast-perf-data-probe.ts` creates/drops a generated `coast_data_perf_*` database using the existing TEST_DATABASE_URL only for creation/deletion, runs the existing migration entrypoint, then executes its guarded worker. The worker seeds 60 movies, 12 albums, 12 two-movie collections, one synthetic provider/account and 72 mappings with 32 KiB unused JSON per snapshot. It makes zero provider calls, checks unchanged real workCards output after dropping unused snapshot fields, reports legacy vs narrow-projection row counts and serialized result bytes, and records actual collection hydration ORM query count for one versus twelve roots. Raw Bun-SQL config reads are excluded from ORM counts and identified as such. This probe is for reproducible evidence; durable semantic/scale regression tests should be added beside the owning suites after implementation.

Run centrally from repo with pinned Bun: `bun --tsconfig-override tsconfig.json /private/tmp/coast-perf-data-probe.ts /private/tmp/coast-data-read-baseline.json`. The auditor has not run it or started any database. No guessed runtime measurements are reported.
