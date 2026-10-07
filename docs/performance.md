# Performance methods

This is the current implementation and review guide for performance work. Start here before changing queries, caches, scheduling or rendering. Dated [implementation evidence](audits/2026-10-03-performance-implementation.md) and [raw measurements](audits/2026-10-03-performance-measurements.json) describe controlled fixtures, not production latency guarantees or proof that every CPU/memory spike is resolved.

## Reuse the existing patterns

| Area | Method to preserve | Implementation reference |
| --- | --- | --- |
| Collection and Library | Apply membership, privacy and availability filters before counts and pagination. Hydrate bounded pages of 60; preserve direct, inherited and member-derived reasons. | `src/lib/collection/query.server.ts` |
| Query planning | Separate independently indexed existence predicates; compute repeated visibility decisions once. Check actual plans and complete returned results before changing SQL. | Collection query; performance harness |
| Content invalidation | Use scoped durable content revisions rather than hashing whole histories or refetching on every session heartbeat. Keep clock-dependent availability expiry in the freshness calculation. | `src/lib/server/content-revision.server.ts`, `src/lib/ui/content-revision.svelte.ts` |
| Concurrent mutations | Revision writes are deferred and ordered consistently. Preserve transaction boundaries, monotonic revisions and bulk-owner deduplication. | Revision migrations and database fixtures |
| Client requests | Reuse the abortable resource loader. Only the current request can publish results; cancellation and stale responses must not replace current data. Clear withdrawn/private data when permission changes. | `src/lib/ui/resource.svelte.ts` |
| Shelf layout | Reuse observer-driven layout with animation-frame coalescing and teardown. Avoid per-card global listeners and repeated synchronous layout reads. Honour reduced motion. | `src/lib/ui/shelves/layout.svelte.ts` |
| Social badges | Fetch only unresolved IDs, including remembering empty results; batch at most 60 with at most two requests in flight. Invalidate on relevant revisions and cancel stale work. | `src/lib/ui/components/Shelf.svelte` |
| Journals | Use membership sets for finite visible ranges; skip filtering when the full journal is requested. | `src/lib/ui/shelves/journal.svelte.ts` |
| Provider requests | Use approved, pinned, bounded provider fetches and the per-origin priority lane. Retain pacing, cooldowns, cancellation and starvation prevention. | `src/lib/server/security/provider-fetch.ts`, `request-priority.ts` |
| Background jobs | Extend the existing durable outbox and scheduler. Preserve deduplication, lease checks, connection ordering and service serialization. Paginate traversals and yield only after committed replay-safe checkpoints. Retain a bounded durable census or staging records when complete evidence is required for sorting or removals; never treat a partial scan as authoritative absence. | `src/lib/server/queue/` |
| Caches | Use existing bounded provider/artwork caches and paged cleanup. Scope personal data to account, permissions and sources; caching must not bypass authorization. | `src/lib/server/utils/provider-cache.ts`, `src/lib/server/storage/image-cache.server.ts` |
| Taste ranking | Refresh ten stale users per outbox run; cap evidence at 300 root works and candidates at 500 per medium. Use the GIN feature index, batched metadata reads and revision-checked writes. Page loads read scores rather than recalculating profiles or calling providers. | `src/lib/social/taste-cache.server.ts`, [taste behavior](experimental-features.md#taste-profiles-and-verified-game-variants) |
| Charts | Lazy-load the gallery and selected renderer. Keep preview thumbnails static, one live gallery specimen, bounded exact-data pages and stable derived geometry. | [Chart preview](chart-preview.md) |

Request priorities are initial imports, interactive delivery, live observations, then background maintenance. The lane chooses between requests; it cannot interrupt an in-flight call or bypass provider rate limits and `Retry-After`. Its oldest-waiting fallback prevents repeated urgent requests from starving maintenance. Task serialization and request pacing solve different problems; keep both.

Use stable IDs and primitive revision keys for cache identity. Derive expensive geometry only from its actual inputs. Keep immutable payloads in raw state where appropriate; avoid deep reactive wrapping of large datasets. Local caches need an explicit lifetime or finite key space. Unmounting or changing context must release observers, timers, listeners and pending requests.

Route invalidation normally targets affected dependencies. SvelteKit’s `invalidate` resets shallow page state: while a shallow panel is open, `refreshRouteDependencies` uses the supported state-preserving `refreshAll` instead. That refresh reruns active route loads, so keep those loads bounded and lazy; content revision keys still prevent unchanged shelf refetches.

Keep provider logic in its existing adapter/service boundary. Public API and browser routes should reuse domain operations and bounded read models rather than create parallel tracking or availability implementations. Performance work must retain account-generation checks, privacy, history and delivery semantics.

## Administrator benchmark

Open **Settings → Benchmarks** and select **Run benchmark**. Runs use `benchmark.run` in the existing outbox; an execution advisory lock prevents overlapping benchmark execution. History is retained for comparisons.

The workload uses a read-only transaction for local probes, with one untimed warm-up and five timed samples per probe; database round trips use ten samples. It measures Collection membership/page reads, availability assessment and a fixed journal workload. SQL statements have a five-second timeout. A thirty-second workload deadline is checked between operations; it is not a strict end-to-end termination timer.

Results include individual samples, median, nearest-rank p95, row counts, process CPU, RSS, heap and external memory. Memory is sampled every 50 ms, so observed peaks can miss shorter spikes. CPU/memory are process-wide and can include unrelated traffic. Five samples are useful for repeatable checks, not a reliable estimate of production tail latency.

Comparisons require compatible workload and environment evidence. Catalogue-dependent comparisons also require matching dataset evidence. Observed background jobs or changing data make a run unsuitable for a clean baseline. The UI’s compatibility checks do not eliminate unobserved load, filesystem cache effects or thermal variation. Preserve raw samples and repeat under comparable conditions before treating a difference as a regression.

This benchmark does not exercise browser rendering, network transport, live provider rate limits, audio/video decoding, cold caches or all application routes. It deliberately avoids provider calls and domain mutations; recording the run itself writes benchmark/outbox records. Implementation and regression checks live in `src/lib/benchmarks/`, `tests/benchmarks.test.ts` and `tests/benchmarks-db.test.ts`.

## Controlled before/after verification

Use the existing harness for reproducible Collection query and revision tests:

```sh
export TEST_DATABASE_URL='postgresql://postgres:password@localhost:5432/postgres'
export COAST_PERFORMANCE_BASELINE_REF='c771fb92f46ccbc173994b39b6885a96bf6a6dec'
bun scripts/performance-verification.ts /tmp/coast-performance-verification.json
```

The account must be allowed to create/drop databases. The harness creates its own database and temporary data, migrates it, seeds synthetic users/media and cleans up afterward. It does not benchmark against the database named in `TEST_DATABASE_URL`. Do not substitute a direct production fixture invocation.

The baseline is an immutable Git ref. The harness extracts the baseline Collection query implementation; it does not rebuild or compare the entire historical application. Its fixture/import contract must be compatible with that implementation. Changing the baseline requires checking compatibility rather than assuming any commit is valid.

The fixture contains 22,400 works and 12,400 tracking rows. It alternates five warm before/after query rounds, compares complete normalized results and reasons across privacy cases, captures `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, exercises concurrent pages, checks revision reads/expiry indexing and tests opposite-order concurrent imports. It also runs the administrator benchmark. See the [implementation report](audits/2026-10-03-performance-implementation.md) for exact scope and results.

For new workloads, record:

- Commit/build, Bun/PostgreSQL versions, hardware, container limits and database settings.
- Dataset shape and counts, permission/source context, cache state and concurrent traffic.
- Warm-up, sample count, execution order, raw samples and measurement boundaries.
- Exact result equivalence, errors, query plans and relevant resource observations.

Compare like with like. Separate database execution, hydration, response transfer and browser rendering. A faster query with different privacy, counts, ordering or availability is a failed optimisation. Do not claim pool starvation, leaks or OOM from elapsed time or RSS alone; reproduce and capture the relevant evidence first.

## Checks and browser acceptance

Run the ordinary verification gates after code changes:

```sh
bun run code:inventory
bun run ui:inventory:check
bun run check
bun run test
bun run test:db
bun run build
```

`test:db` requires the create-database-capable `TEST_DATABASE_URL` described above and isolates each suite. Database tests and lifecycle hooks have a bounded 30-second default so bulk import fixtures and FK cleanup can complete on slower CI runners; this is a correctness-test allowance, not a production latency target. Unit tests and benchmark deadlines retain their own limits. Choose focused tests while iterating, including resource cancellation, content revisions, request priority, journals and benchmark fixtures. Add tests for meaningful regression behavior, not timing thresholds that vary with the host. See [verification platform](verification-platform.md).

For rendering changes, exercise a production build as well as development mode. Record desktop/mobile viewport, browser and device; developer tooling and hot reload affect measurements. Check:

- Initial routes fetch only needed rows; scrolling loads bounded pages on demand.
- Unchanged session polls do not refetch content, empty results are remembered and stale requests cannot repopulate a changed context.
- Navigation/filter changes release resources; repeated open/close and scroll cycles do not accumulate listeners, timers or requests.
- Skeletons match the loaded structure, empty rows disappear after settling and partial provider results stay usable.
- Charts load their renderer on demand, retain one specimen, paginate exact data and leave no renderer mounted after changing sections.
- Playback keeps buffered media usable through transient network failures; seeking, subtitles, crop, audio navigation and party synchronization retain their behavior.

Use network request counts, browser performance traces and repeated lifecycle observations to support findings. Fixture playback tests cannot establish live codec, autoplay, mobile or multi-account party acceptance. Report that evidence separately; see [readiness](readiness.md).

## CPU, memory and shutdown investigation

Inspect application timings, provider/job activity, browser work and container resources together. RSS includes more than JavaScript heap; cgroup memory can include filesystem cache and PostgreSQL. Compare idle and active workloads over time before attributing growth to a leak. Increasing concurrency, pool size or memory limits without a measured bottleneck can worsen the problem.

The shared Bun SQL pool stays bounded at ten connections, with a ten-second connection timeout and idle retirement disabled. Workers hold session advisory locks while waiting on providers; Bun's idle timer also closes reserved sessions, releasing those locks and producing `ERR_POSTGRES_IDLE_TIMEOUT`. Do not reinstate idle retirement without verifying reserved-session behavior. `database-pool-db.test.ts` checks lock ownership across a wait longer than the former thirty-second timeout and release afterward. Explicit pool cleanup uses `closeDb`; this setting does not suppress query failures or replace durable job retries.

The production image sets `IDLE_TIMEOUT=60`. A timed-out request is distinct from a stopped process, and a handler log with status 200 does not prove successful delivery to the browser. Capture proxy/client failures and timings before assigning cause.

Unexpected exits retain `/data/runtime/child-exits.jsonl` and rotated evidence. Application stderr survives restart in `/data/runtime/application-stderr.log` and `.1`, bounded to 256 KiB each. These raw operator logs can contain sensitive details; do not include them unredacted in reports or public fixtures. Safe structured exports follow [diagnostic logging](diagnostic-logging.md).

Inspect exit status, signals, build identity, logs around the event and host/container memory evidence from that same period. Counters observed only after recreation cannot establish what happened to an earlier container. A larger timeout or persistent logging improves diagnosis; it does not prove an unexplained process-exit cause has been fixed.

Horizontal Shelf artwork uses the shared `lazyImage` observer and a separate left-to-right request queue per rail. Only intersecting artwork is queued; horizontal off-screen cards remain deferred. One request runs per rail, while different rails remain independent. Load, error and component teardown release the slot. Grid artwork keeps its existing independent loading. Do not add a page-wide image queue or eager artwork preloads.

Fallbacks and artwork source changes reacquire that same rail slot; assigning an unchanged URL is a no-op. Shared progress sources refresh activated shelves only when the content revision or supplied initial payload changes. Metadata readiness and artwork readiness remain independent, and card avatars wait for their artwork to settle.

For You's initial route returns only its hero and next action. Continue uses the shared lazy progress source; section grids skip the home hero query. Hero selection reuses Continue's lightweight page plan and retains saved-history and permitted-Library bounds, then hydrates only the chosen hero. On a disposable PostgreSQL 17.11/Bun 1.4.2 fixture with 1,000 tracked screen works and 100 Library works, one warm-up and five alternating samples measured a `homeData` median of 50.05 ms before and 16.79 ms after. Hero/next-action payloads matched across six priority, permission and history-bound scenarios. These samples exclude HTTP, parent route loads, browser rendering and provider calls, and are not production latency guarantees. Durable cases live in `tests/home-data-db.test.ts`.


### Provider jobs and request scheduling

Use `task-timing.ts` for eligibility and due decisions, `job-policy.ts` for work identity and purpose, and the existing durable outbox for claims and recovery. Never add an adapter-private FIFO that hides requests from the common priority transport. An explicit foreground operation can promote an exact shared resource through `providerSingleFlight`; this must not promote unrelated work or duplicate the fetch. Current HTTP arbitration is process-local and retains one request per origin, provider spacing, cooldowns and aging.

Queued traversals use `jobCheckpoint()` only after committing their cursor and effects together, or after an idempotent persisted stage. Workers yield after five committed boundaries or ten seconds at a safe boundary. This is cooperative scheduling, not interruption of an in-flight request or transaction. `JobYield` is control flow: do not catch it as a provider failure or consume retry attempts. Persist large stable responses outside the bounded action payload; Steam uses job-scoped snapshots and Trakt uses staged records. Recommendation jobs retain only their bounded seed selection and completed-set cursor; do not reselect seeds on resume as saving a set changes freshness. Personal publication must check the active job lease inside its guarded transaction, after account locks.

Measure synthetic fixtures separately from live-provider latency. Test resumption without repeated committed effects, changed account generations, local edits, incomplete pages, cooldown preservation and final-negative publication. Raising priority must not bypass authentication, permissions, rate limits or retry backoff. The Queue waiting reason and order should reflect these same execution rules.
