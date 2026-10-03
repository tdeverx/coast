# Coast performance investigation and repair plan

Date: 3 October 2026. Inspected commit: `4322f5c907401f21dafc379b4f87d5f5fcb7bf1c`.

This is a plan with isolated trials, not an implementation in the main checkout. The source snapshot is `/tmp/coast-performance-snapshot`, made with `git archive HEAD`; the parent's uncommitted material changes were excluded. Its existing dependency directory was reused read-only. No production dependencies, commits, branches, live configuration, live provider data, or existing database data were changed.

## Recommended order

1. **P0: Make the production Bun idle timeout explicit and retain child-exit evidence.** The current 10-second adapter default closes connections before slow handlers finish. This explains an observed class of failed requests; it does not explain the separate process exit.
2. **P1: Fix Collection's correlated dropped-state scan, then reuse privacy checks by category.** These are the strongest measured server improvements. Both trial changes preserved full results across privacy/disabled-user/dropped-state cases; the existing Collection suite passed.
3. **P1: Stop refetching all social badges on every appended page.** This removes measured triangular request growth. Define invalidation before implementing the retained results.
4. **P1: Apply the small journal and gesture fixes, then verify session-only polling does not refresh all content.** Preserve the approved UI and interactions.
5. **P2: Bound retained import/cache work.** Start with paged Jellyfin final reconciliation and cache expiry cleanup. Trakt history requires preserving chronological rewatches, so investigate its ordering contract before changing traversal.
6. **P2: Add the missing TMDB provider tag and skip already resolved metadata downloads.** This is pacing and avoidable work, not a promise of higher raw throughput.
7. **P3: Profile browser media buffers, large mounted collections, queue admission, disk cache ordering, and retained outbox queries.** Source evidence identifies candidates; live attribution or a full browser soak has not been measured.

Do not raise the SQL pool size, worker count, container memory limit, or provider concurrency as the first response. The measurements support reducing work first, with no new dependencies or UI redesign.

## Evidence and its limits

### Live incident evidence supplied and rechecked from captured files

- At approximately 16:00 BST, Nginx reported prematurely closed/reset upstream connections for Collection. Captured application diagnostics contain successful handler completions at **18,674.21 ms** and **25,577.97 ms**. A handler-level `200` means a Response was produced; it does not prove delivery after the socket closed.
- The live build was reported checked by the parent: `/app/build/index.js` uses `env("IDLE_TIMEOUT", "10")`, with no environment override. The installed adapter source independently matches this at `node_modules/svelte-adapter-bun/dist/files/index.js:13-16`. `svelte.config.js` provides no alternative timeout option.
- Captured proxy errors in the 16:00 minute include six Collection failures and failures across social enrichment, artwork, playback, diagnostics, and page data. A failing Collection request can coexist with a healthy process; the recorded failures alone do not identify CPU, SQL wait, or provider wait as the cause of every request.
- The later Coast process exit at **16:13:15 BST**, status 1, remains unexplained. Stdio was overwritten around an image/container update at 16:13-16:14. Do not combine this with the earlier idle-connection failure and claim one proven cause.
- The supplied current 2 GiB container sample used roughly 1.25 GiB, dominated by approximately **900 MiB file cache** and **350 MiB anonymous memory**. Current `memory.events` did not show OOM/oom_kill. File cache is not JavaScript heap. Current counters, particularly after a container update, cannot conclusively diagnose the prior process lifetime.

Files: `/tmp/coast-live-proxy-error.log`, `/tmp/coast-live-proxy-access.log`, `/tmp/coast-live-diagnostics.log`, `/tmp/coast-outage-latest-host.jsonl`. Do not copy full request query strings or credentials from these files into a report.

### Independent isolated timeout trial

Bun 1.4.2, macOS ARM64, temporary loopback listeners on OS-assigned ports:

| Handler idle duration | Bun idleTimeout | Result | Observed request duration | Health afterwards |
| --- | ---: | --- | ---: | --- |
| 30 seconds | 10 seconds | ECONNRESET | 12,003 ms | 200 |
| 30 seconds | 60 seconds | 200, body received | 30,017 ms | 200 |

Short 12-second trials were timer-sensitive: the parent observed a reset, but both my serial trial and repeat of its exact parallel script sometimes returned 200. Therefore use a handler comfortably longer than the timeout for an acceptance test; do not assert an exact 10.000-second cutoff. The longer test independently confirms the connection-close mechanism while the process stays alive.

[Bun's primary documentation](https://bun.sh/docs/runtime/http/server#idletimeout) states that idle connections include in-flight handlers that have not written response bytes. Results: `/tmp/coast-perf-idle-long.json`; harness: `scripts/performance-idle-long.ts` in the snapshot. The short trial is `/tmp/coast-perf-idle-timeout.json`.

## P0: Production transport and exit diagnosis

**Locations:** `Dockerfile:14`, `compose.yaml`, `scripts/container-entrypoint.sh:63-71`, adapter runtime source above, `docs/diagnostic-logging.md`, `src/hooks.server.ts:115-190`.

**Smallest deployment fix:** set an explicit production `IDLE_TIMEOUT=60` in the image runtime environment and document the supported override for other deployment methods. Respect an operator's explicit value. Do not edit generated build output. A 60-second guard allows the observed 18-26-second handlers to return while query fixes are developed; it is not a substitute for those fixes. It also exceeds the existing 20/30-second provider header/body idle guards. No live deployment was changed by this investigation.

**Exit evidence:** persist a small, bounded child-exit record outside replaceable stdout: timestamp, application/database child identity, PID, exit code or signal, and release identifier when available. The entrypoint currently exits with `wait -n`'s status without identifying which child won. Debian's Bash supports `wait -n -p` for that identity. Preserve existing signal propagation and clean shutdown behavior. Add safe lifecycle/query-phase diagnostic fields rather than logging arbitrary exception text, SQL parameters, tokens, or full URLs. Collection is currently classified as `operation: other`; give its timings a stable operation/stage so future incidents can separate SQL assessment, card hydration, provider queue wait, and response production.

**Acceptance:** inspect a newly built image's effective timeout; a 30-second synthetic handler returns through the production adapter and a representative reverse proxy at the chosen timeout; `/health` stays responsive during and after the request; explicit timeout overrides work; a disposable bundled-DB container records whether the application or PostgreSQL exited first for separate injected exits; rotation survives restart. A diagnostic `request.complete` must not be described as proof of socket delivery.

## P1: Collection query work

**Locations at inspected HEAD:** `src/lib/collection/query.server.ts:32-179`, especially dropped exclusion at **85**, repeated privacy checks at **81, 162-166**, page filter at **221**; current JIT/worktable settings at **29**; pool limit at `src/lib/server/db/index.ts:24`.

The synthetic fixture contains 400 shows, 20,000 episodes, 2,000 movies, 12,400 tracking rows, and corresponding provider/access data. It yields 7,400 Collection assessment rows and 2,400 root rows; each page returns 60 cards. There is no live catalogue copy. PostgreSQL ran in the existing test database service, in a newly named disposable database, with its own data directory. Consequently the absolute timings include host/test-service variability and do not predict production p95.

| Isolated source | Assessment median, 3 runs | Root page median, 3 runs | EXPLAIN execution | Shared buffer hits |
| --- | ---: | ---: | ---: | ---: |
| Original HEAD | 3,472 ms | 3,702 ms | 5,298 ms | 1,032,123 |
| Split dropped predicates | 907 ms | 1,219 ms | 1,414 ms | 170,031 |
| Also reuse privacy by category | 276 ms | 718 ms | 672 ms | 73,023 |

The original EXPLAIN attributes approximately **3,746 ms** to a correlated tracking-state sequential scan: **5,600 loops**, each rejecting all **12,400 rows**, approximately **862,400 shared buffer hits**. The problematic condition combines a direct work ID with an episode-to-show subquery inside an OR. It defeats the cheap user/media primary-key probes. Recursive traversal and availability also have costs, but this specific repeated scan dominates the measured baseline.

**First smallest fix:** replace that single existence predicate with two existence checks, preserving its OR semantics:

```sql
exists(select 1 from tracking_state t
       where t.user_id=owner and t.dropped and t.media_id=d.id)
or exists(select 1 from episodes e join tracking_state t
          on t.media_id=e.show_id and t.user_id=owner and t.dropped
          where e.media_id=d.id)
```

The existing indexes suffice; no index migration was needed for the trial.

**Second fix:** materialize visibility flags once per existing work category for collection/activity/progress/favourites/ratings, and join those few flags in direct membership and assessments. Retain `social_visible` itself and its disabled-user behavior. Replacing self-view checks with unconditional true would require an additional disabled-user proof; the tested per-category approach keeps that rule intact. The admin demand query uses SQL expressions for owner/viewer IDs, so preserve that supported input shape.

**Contention:** four simultaneous root pages took **7,575-8,727 ms** on original source and **1,293-1,357 ms** with both trial changes. A separate `SELECT 1` remained responsive (baseline samples 0.4-84 ms), so this test does not show complete pool exhaustion. The max-10 pool and up to three background reserved connections can still constrain larger card fan-outs; do not increase them before measuring.

**Semantic validation:** complete normalized Collection row results matched between baseline and each trial for self view, public visitor, private activity/progress, directly dropped movie plus dropped parent show, and disabled owner: **10 full comparisons**, including reasons, membership, availability, next IDs and privacy-dependent fields. The existing `tests/collection-db.test.ts` passed **21 tests / 79 assertions**, covering pagination, source freshness, inherited/direct reasons, music/game completion, privacy and demand. It ran only in the disposable fixture. This is strong evidence for these two changes, not exhaustive evidence for every category/provider combination.

**Acceptance:** preserve all existing Collection, projection and demand behavior; run Collection DB tests plus relevant social privacy/projection suites; compare normalized full results with baseline across same source/owner/viewer/category filters, specials, cycles and empty scopes; retain JIT-off/worktable settings during the first change. On the same fixture, eliminate the per-reason full tracking scan and keep four-request latency well below baseline without more connections. Add only a meaningful regression fixture that asserts dropped direct work and dropped episode parent remain excluded; use recorded EXPLAIN/benchmark for performance rather than timing-sensitive CI assertions.

**Artifacts:** `/tmp/coast-perf-baseline-self.json`, `/tmp/coast-perf-split-dropped-self.json`, `/tmp/coast-perf-visibility-self.json`, `/tmp/coast-perf-contention-{baseline,visibility}.json`, `/tmp/coast-perf-equivalence.json`; snapshot files `src/lib/collection/query-baseline.server.ts`, `query-split-trial.server.ts`, and the isolated modified `query.server.ts`; harnesses `scripts/performance-run.ts`, `performance-contention.ts`, `performance-equivalence.ts`.

## P1: Frontend work without design changes

### Social enrichment

`src/lib/ui/components/Shelf.svelte:98-108` clears social results, then refetches all accumulated IDs in concurrent 60-ID batches whenever cards change. Ten appended 60-card pages produced **55 requests / 3,300 queried IDs**; twenty produced **210 / 12,600**. A missing-ID-only prototype produced **10 / 600** and **20 / 1,200** respectively. These are counts from the actual extracted effect with a fake API, not live request statistics.

Keep per-shelf results on append and fetch missing IDs, including a remembered empty result. Clear/refetch on the relevant social revision, user/filter change and explicit refresh; define that invalidation before implementation. Preserve retry after failures and stale-response protection. Bound batch concurrency if a large list arrives together. Acceptance: linear append requests, existing badges remain visible during fetch, social/privacy changes refresh older cards, and aborted responses cannot publish into a changed selection. Do not add an indefinite global personal-data cache.

### Journal filtering

`src/lib/ui/shelves/journal.svelte.ts:43-44` performs `days.indexOf(...)` for each event, including when maxDays is Infinity. Use the unfiltered items for the unlimited case, and a Set of allowed dates for finite limits. Preserve event ordering, unknown dates, grouping and selected history.

Final synthetic pure-JS measurements: 6,000 events, seven dates allowed, **13.568 → 0.380 ms**; 30,000 events, **335.682 → 1.728 ms**. Unlimited filtering **13.509 / 327.618 ms → effectively zero** for a bypass. Edge cases preserve event IDs for negative/zero/one/fractional/twelve/NaN/unlimited limits and unknown dates. These stress sizes were not observed in real user data and exclude grouping/DOM work.

### Gesture listeners

`src/lib/ui/context-gesture.ts:64` registers a capturing window scroll listener for every card; line 9 clears a timer on every callback even without a hold. Register the global cancellation listener only while a qualifying touch hold is pending, and remove it whenever the hold ends/cancels/destroys. This changes no appearance.

600 cards × 2,000 fake scroll events: **1,200,000 callbacks / 7.120 ms total median → zero callbacks / 0.069 ms dispatch overhead**. 3,000 cards: **6,000,000 / 34.165 ms → zero / 0.070 ms**. The time is spread over 2,000 fake events; these are not browser frame-time claims. Both functions passed eight modeled interaction/cleanup checks. Browser acceptance must preserve native context click, stationary touch opening once, scroll/movement cancellation, nested rail scrolling, click suppression, keyboard context opening/focus and teardown.

### Session refresh fan-out

The visible root layout invalidates `coast:session` every minute (`src/routes/+layout.svelte:70-80`). Progress shelves (`src/lib/ui/shelves/progress.svelte.ts:85-103`), experimental shelves (`experimental.svelte.ts:21`) and DynamicFeed (`src/lib/experiments/DynamicFeed.svelte:19`) depend broadly on page data; the feed resets accumulated rows. This is a code-supported periodic burst candidate, not a captured browser trace.

Narrow content refresh to relevant tracking/social/server revisions while retaining initial-data replacement and provider-driven updates. Do not remove session refresh or replace the subscription with a mutation-only client counter that misses remote changes. Acceptance: two controlled session-only polls do not fetch all activated shelves or erase feed rows; real relevant changes still refresh correctly and keep filters/scroll behavior. Record a browser network/performance trace before and after.

Frontend audit with reviewable patches, harnesses and full acceptance details: `/tmp/coast-client-performance-audit.md`. Raw trial results are in snapshot `scripts/client-lifecycle-benchmark-results.json` and `scripts/journal-filter-benchmark-results.json`.

## P2: Server memory and background work

### Import retention

- **Trakt:** `src/lib/sync/trakt-import.ts:151-161` retains and sorts all history before applying; a 10,000-page traversal guard allows roughly a million events, not a useful heap cap. Real-adapter synthetic parsing retained **3.90 MiB heap / 41.06 MiB RSS** for 10k events and **34.78 MiB heap / 90.91 MiB RSS** for 100k (baseline about 0.31 MiB heap / 16.4 MiB RSS). These are allocations, not live account sizes. First compact descriptors and share repeated-title metadata if useful. Strict bounded import requires verified chronological pagination or ordered staging. **Preserve oldest-first rewatches, stable source event IDs, same-date ordering, suppression and retry idempotence.** Simply streaming the present page order can change tracking state. `TraktAdapter.readPages`, `adapter.server.ts:80-89`, similarly concatenates whole lists/collection shows; expose page iteration only where full-order reconciliation is unnecessary.
- **Jellyfin:** main traversal already clears per-page maps. Final grouped playback observations at `src/lib/sync/jellyfin.ts:432-450` are unpaged, then validate the connection per row. Keyset-page observations, initially retaining those checks. Only fold validation into existing reconciliation transactions after matching all status/generation/user/provider/importPlayback semantics; do not relax opt-out or account-switch guarantees for performance. Test large multi-edition fixtures, cancellation/account generation, immediate importPlayback opt-out, retries and incomplete-scan removal protection. Measure retained batch rows and query count.

### Public metadata caches

`src/lib/server/utils/provider-cache.ts:7-18` holds up to 100 values, but expired values stay resident until successful replacement/displacement. Insights/people caches in `src/lib/server/media-details.ts:12-13` have variable-weight credits payloads. A deliberately large fixture, 100 entries × 1,000 rows with 512-character overviews, retained **60.51 MiB heap / 171.52 MiB RSS** after TTL expiry and GC. Refreshing one key released only that entry. This is **bounded retention, not an unbounded leak**.

Delete an expired value before replacement, sweep other expired values on lookup, and choose an idle expiry sweep only if idle release is required. Measure representative payloads before choosing a smaller people-cache capacity or byte budget. Preserve same-key single-flight, retry after failure, uncached incomplete insights and separation from private tracking/access state. Do not sum RSS, heap and external counters: their accounting overlaps.

### Provider pacing and repeated hydration

`src/lib/catalogue/service.ts:33-37` omits `provider: 'tmdb'`, so `provider-fetch.ts:302` chooses interval 0 instead of the intended 250 ms. Add the tag; test diagnostics, origin lane fairness and cooldown. This can intentionally slow a healthy bulk scan while avoiding bursts.

Known Jellyfin catalogue roots are downloaded before `persistMissingTmdb` checks canonical identity (`src/lib/catalogue/maintenance.server.ts:32-43,128-139`). Batch known-identity lookup before requests and skip already resolved roots. Shared metadata refresh selects 100 roots but can hydrate all show seasons/episodes (`src/lib/catalogue/service.ts:298-307,383`); measure actual episode/write counts and skip unchanged snapshots while preserving new episodes and advancing refresh timestamps. Existing identity conflict handling and per-user access separation must remain intact.

Full server audit, exact locations and acceptance constraints: `/tmp/coast-server-performance-audit.md`; results `/tmp/coast-server-performance-results.json`; harness `/tmp/coast-server-performance-harness.ts`.

## P3: Measure before broad changes

- **Browser playback:** `PersistentPlayer.svelte:377` creates HLS.js with no back-buffer option; the locked 1.7.3 implementation defaults to Infinity. Teardown already destroys HLS and clears/reloads the media source at 405-414. A finite 60-90-second historical buffer is a trial candidate, with older seeks refetching segments. It is not a fixed byte cap and applies only to HLS.js, not native HLS. Compare a 20-30-minute disposable high-bitrate fixture, buffered time ranges, browser/GPU memory, stalls, backward seeks, edition/source changes and synced playback. Browser media buffers do not explain server container heap.
- **Mounted collections:** Shelf retains/mounts accumulated cards; hover-activated actions and one-second age labels may amplify work. Count DOM/listeners/heap at 1, 5 and 20 pages and after route teardown/GC, then profile scrolling and idle separately. Apply the small fixes above first. Windowing adds focus/scroll complexity; propose it only if measured residual DOM/layout cost demands it, while preserving the approved design.
- **Image disk cache:** `image-cache.server.ts:29-35` sums and sorts every entry before learning no eviction is needed. Its 10k-entry sort path measured **2.19 ms median / 8.23 ms p95**, excluding I/O. Track total bytes and return before sorting when there is room; preserve admission, temporary-file/free-space accounting and deletion handling. Measure serialized cache-read head-of-line delay before allowing concurrent disk operations.
- **Provider response allocation:** actual transport buffers an 8 MiB-bounded body, then decodes/parses it. A 7.30 MiB fixture took 18.38 ms; heap peaked 15.72→52.38 MiB before GC, with the baseline already including fixture text/bytes. Preserve size bounds and lane ownership through complete body consumption. Consolidate decode only if representative allocation profiling warrants it.
- **Queue/pool:** three workers, including one urgent-only, reserve a connection while an action runs; pool max is 10. Reserved locks/heartbeats have finally cleanup. `mediaViewsForIds` launches all 500-ID batches concurrently (`media.ts:498-503`), each with many DB reads. Bound batch fan-out using the existing concurrency helper if a large-ID fixture proves pool starvation; preserve complete membership and output order. Do not cache personal availability to hide queries.
- **Provider admission:** origin lane queues have no backlog limit and provider timeout starts after dequeue. Stress cooling-down origins with aborted callers; add a modest admission/deadline bound only if backlog grows. Preserve priority fairness, cancellation and streaming bypass.
- **Maintenance/outbox:** minute scheduling aggregates retained success history and probes presence per connection. Benchmark 10/100/1,000 connections and growing completed actions with EXPLAIN before batching presence/latest-success probes. Use a single-flight maintenance tick if overlapping runs are measured; preserve advisory locks/deduplication and retention behavior.
- **Social recursive reads/admin demand:** workSocial traverses trees for each requested batch; adminDemand evaluates demand per eligible user before pagination. The existing admin-demand test took 4.53 seconds with the large synthetic catalogue alongside its test users. This is an additional workload signal, not an isolated production benchmark. After reducing repeated client enrichment and Collection cost, profile these with representative friend/user counts before restructuring privacy/pagination semantics.

## Reproduction and cleanup

Runtime: `/Users/admin/Documents/ChatGPT/coast-new/.tools/bun-darwin-aarch64/bun` (1.4.2). The snapshot's SvelteKit config was generated locally with `bun node_modules/@sveltejs/kit/svelte-kit.js sync`; no main generated files were written. Fixture scripts read existing local credentials without printing them and replace the database name before any write.

From the snapshot, with network permission for the isolated test DB, the completed sequence was:

```text
bun scripts/performance-fixture.ts
bun scripts/performance-run.ts seed
bun scripts/performance-run.ts measure
PERF_LABEL=split-dropped bun scripts/performance-run.ts measure   # split trial source
PERF_LABEL=visibility bun scripts/performance-run.ts measure      # second trial source
bun scripts/performance-equivalence.ts
bun scripts/performance-contention.ts baseline
bun scripts/performance-contention.ts visibility
bun scripts/performance-test.ts tests/collection-db.test.ts
bun scripts/performance-idle-long.ts
bun scripts/performance-cleanup.ts
```

For repeatable source selection, `query-baseline.server.ts` and `query-split-trial.server.ts` retain each version and the current isolated `query.server.ts` contains both changes. The `measure` harness imports the current trial; restore the appropriate isolated source before each labeled run. It never writes the main checkout.

**Cleanup completed:** only `coast_perf_20261003_d4b4eb4759c645bbab38b575203438e9` was created, migrated, seeded and dropped. Its task-created data directory and credential runtime JSON were removed. All temporary Bun listeners stopped. Existing dev/live databases and provider state were preserved. The snapshot, reviewable trials and sanitized result files remain for review; they are not merged code.

## Practical limits

There was no full browser/rendering/playback soak, live heap profile, live SQL execution plan, or test of real provider account import volume. Only synthetic fixtures and captured read-only incident files were used. Host load and the shared test PostgreSQL service affect wall-clock timings. Plan priorities reflect verified code/isolated costs and observed incident evidence; they do not claim a complete attribution of every CPU/RAM spike or the unknown status-1 exit. The next implementation should start with the smallest measured changes and preserve their equivalence constraints before considering larger architectural work.

## Benchmark history follow-up

Add a Settings benchmarking section with a single Run benchmark button. Record and retain run history, including build, environment, workload version, timings, CPU/RAM and failures. Use repeatable, isolated workloads so the history shows meaningful performance drift without mutating real tracking data or issuing unintended provider writes. This belongs to the larger performance pass, rather than the current materials/features update.
