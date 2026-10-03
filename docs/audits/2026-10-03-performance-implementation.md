# Performance implementation and verification

3 October 2026. Baseline: `c771fb92f46ccbc173994b39b6885a96bf6a6dec`; implementation: the `codex/performance-benchmarks` working tree. Runtime: Bun 1.4.2, macOS ARM 64, Apple M4. PostgreSQL fixtures ran in the existing test container, using separately created databases and temporary data directories. The existing dev server and data were preserved. No live provider requests, production configuration changes, commits, pushes or deployments were performed by this implementation; the parent agent will separately review and publish the authorized change.

The evidenced repairs and administrator benchmark are implemented. Collection result equivalence, privacy, ordering, provider pacing, playback/account checks, and the independent Music/Gaming/Parties gates remain required behavior. The earlier plan remains at [performance plan](2026-10-03-performance-plan.md); focused evidence is in [frontend implementation](2026-10-03-frontend-performance-implementation.md), [server implementation](2026-10-03-server-performance-implementation.md), and [raw controlled measurements](2026-10-03-performance-measurements.json).

## Transport and lifecycle

`Dockerfile` explicitly sets production `IDLE_TIMEOUT=60`. The adapter's default was ten seconds, with no override in the captured live build. Nginx closed Collection upstream requests around ten seconds while diagnostics recorded handlers finishing after 18.674/25.578 seconds. A handler recording status 200 is not proof that its client received the response. A local Bun 1.4.2 long-idle handler reset with timeout 10 while the server remained healthy; timeout 60 delivered the response. Timer granularity means this is not an exact ten-second stopwatch guarantee. The [Bun idle-timeout contract](https://bun.sh/docs/runtime/http/server#idletimeout) includes in-flight requests that send no response bytes.

`scripts/container-entrypoint.sh` and `container-wait.sh` retain the completed child's identity and exit status. Interrupted waits record termination/unknown rather than attributing the wait to an application failure. `container-child-exit.ts` writes bounded independent JSONL at `/data/runtime/child-exits.jsonl` (one rotated file after 64 KiB, mode 0600). Fields are timestamp, child/PID, exit status, conventional signal number, trapped TERM/INT, and safe configured build ID or a hash of the executable server tree/bootstrap. It never persists child output, URLs or environment contents; diagnostic write failure cannot change shutdown status.

Real Bash 5 shell fixtures exercised application exit 7, bundled database exit 9, external-database application exit 11 and TERM 143 with no falsely attributed child. Writer fixtures cover rotation, permissions, signals and write failure. Build identity fixtures verify that changing an application chunk changes its hash while source maps/browser assets do not.

The separate captured process exit 1 remains unexplained: stdout had been replaced and the image was updated near the incident. Idle timeout does not establish that process-exit cause. Current memory.events showed no OOM/oom_kill, which cannot prove that no earlier OOM occurred. Captured container usage around 1.25 GiB of 2 GiB included roughly 900 MiB file cache and 350 MiB anonymous memory; file cache is not JavaScript heap. No claim is made that these changes resolve an unproven leak or OOM.

## Collection query and privacy

`src/lib/collection/query.server.ts` materializes the five visibility decisions once per category and separates direct dropped-work and parent-show dropped-work existence predicates so their indexes can be used independently. Membership, inherited/member-derived reasons, activity, availability, source filtering, privacy and the 60-card hydration boundary are retained. No privacy predicate was removed. Debug query timings now label assessment/card-hydration stages and collection/library/progress operations using closed diagnostic vocabulary. Redaction tests retain only stage/operation/duration and discard SQL/parameters.

One disposable catalogue contained 400 shows, 20,000 episodes and 2,000 movies: 22,400 works, 12,400 tracking rows and 22,400 availability observations. Five alternating before/after rounds ran on the same warm fixture. Complete normalized rows and reasons matched, rather than merely comparing totals. The raw JSON retains individual samples, concurrency results and plan summaries.

| Controlled measurement | Baseline | Implemented |
| --- | ---: | ---: |
| Full personal assessment, median | 2,713.91 ms | 193.59 ms |
| Root Collection page, median | 2,979.35 ms | 467.85 ms |
| Assessment EXPLAIN execution | 2,781.50 ms | 262.43 ms |
| Assessment shared buffer hits | 1,032,068 | 72,968 |
| Four concurrent root pages | 4,680–5,302 ms | 643–671 ms |

These are fixture measurements, not promised live timings. Across the final repeat and prior controlled runs, medians varied with the host, but the same large reduction and exact results held. Independent SELECT 1 probes remained responsive during both concurrent workloads; pool starvation was not established. Self/public visibility returned 7,400 assessments; hidden activity/progress returned 2,400; dropped movie plus parent show returned 7,374; disabled owner returned 0. All five scenarios matched every returned field/reason.

## Durable content revisions and client work

Migration 0039 introduces indexed global/per-owner counters and transaction-local pending changes. Statement triggers deduplicate owners for bulk imports. A deferred commit trigger merges changes in stable scope/domain order and increments counters monotonically. It does not use transaction IDs as revision values: out-of-order commits cannot regress a revision. Pending rows disappear at commit. A reproduced opposite-order metadata/tracking deadlock in the initial immediate-counter design was eliminated by committing counter writes only after domain mutations; the final parallel fixture commits successfully.

Reads in `content-revision.server.ts` touch the viewer, optionally viewed profile owner, accepted peers and their active sources. They do not hash the shared catalogue or tracking history on each session poll. User deletion, list ownership transfer, reorder, provider/public API updates and privacy changes invalidate the relevant owner; ordinary private Steam observations stay local. Provider token/cursor/progress bookkeeping and timestamp-only no-op metadata updates are excluded. Public non-friend reactions require global social invalidation when their content/public privacy changes, because the existing badge query admits publicly visible reactions without friendship. Privacy withdrawal and reaction deletion are covered.

Presence contributes the effective status, not raw heartbeat timestamps. Stable online heartbeats retain keys; five-minute activity expiry, 90-second heartbeat expiry, away/offline/invisible and privacy transitions change the key. Active check-in/live-state expiry is retained. Profile owner tracking/privacy changes refresh a viewed public profile independently of friendship. The viewed-owner revision is included only when a relevant tracking section is visible to that viewer; privacy withdrawal changes it to zero, and subsequent unrelated private writes keep it stable.

Migration 0040 adds one partial availability index on user/connection/verified_at for available or authoritative-unavailable evidence. `collection/freshness.server.ts` contributes a checkpoint freshness boolean and the newest expired relevant observation per source. A predecessor index seek changes at individual evidence expiry without scanning all availability rows on each poll. This same signature participates in Collection benchmark cohort identity. Real no-write clock-boundary fixtures cover checkpoint fresh→stale, positive availability fresh→stale, and authoritative unavailable→unknown when the checkpoint was already expired. Three alternating 100-read index trials measured median 2.849–3.360 ms without the expiry index versus 0.327–0.388 ms with it. EXPLAIN used the partial index and touched five shared buffers; it did not scan the 22,400 observations.

The 22,400-work fixture measured 100 revision reads at median 0.351 ms (maximum 3.94 ms). Counters are not free: five alternating 12,400-row updates measured median 42.48 ms with triggers disabled versus 57.40 ms enabled, about 14.92 ms additional write cost. Five paired independent 1,000-title imports in opposite metadata/tracking order completed in 14.5–18.5 ms, with no failures and zero pending staging rows afterward. These explicit costs are preferable to full catalogue hashing per viewer/poll; very large live concurrent imports still warrant observation.

Frontend changes preserve the existing markup/styles and controls. Shelf social enrichment requests only IDs not already queried, including remembered empty results; at most two 60-ID batches run concurrently. Previous badges stay present during append. Relevant revisions/filter/viewer changes reset results; cancelled/stale work cannot publish. Journal date filtering uses a Set; unlimited history bypasses filtering. Gesture scroll cancellation listens only during a pending hold. Content keys replace broad session/page-data subscriptions while provider-driven changes, explicit refresh, filters and Dynamic Feed pagination continue to work.

Real Chromium fixtures measured 20 appended pages dropping from 210 requests/12,600 IDs to 20 requests/1,200 IDs. Two unchanged 60-second session polls dropped 26 content requests to 0; two loaded Dynamic Feed rows remained two instead of resetting to one. A 30,000-event/seven-date synthetic journal median fell 187.157→0.640 ms. Gesture instrumentation measured 0 idle listeners→1 pending hold→0 released, while right-click/keyboard/touch/scroll behavior remained intact. These are rendering/request fixtures, not physical-phone frame-time or playback measurements.

## Provider, catalogue and cache work

- Jellyfin final canonical reconciliation uses keyset pages of 100 grouped titles. It preserves aggregation/order, every account-generation/connected check, opt-outs and complete-scan gating. A 101-title fixture with duplicate editions and two syncs produces 101 unique history events; nine reconciliation DB tests pass.
- Trakt retains only consumed event/identity fields, uses a bounded 10,000-title interning map and preserves full oldest-first stable sorting, timestamp fallback, source IDs, suppression, retry idempotence and conflict/account checks. At 100,000 events/1,000 titles, retained heap after GC fell 32.524→11.366 MiB, but parse/staging CPU increased 58.184→116.438 ms. At 100,000 unique titles it fell 34.465→31.445 MiB while staging increased 66.275→108.028 ms. All consumed-field ordered digests matched across three alternating repeats. The complete history array remains retained; this is a measured memory/CPU tradeoff, not a strict total-history bound.
- Jellyfin discovery batch-checks already resolved instance-specific movie/show roots and downloads only unresolved roots. A real scanner with synthetic transport, 1,000 roots/950 resolved/10 pages, reduced root reads and save checks 1,000→50, plus ten batch checks. All 50 added identities match. Synthetic elapsed 9.884→7.424 ms excludes real network/database latency. Existing refresh remains responsible for full metadata; no unmeasured episode/write-skip policy was added.
- TMDB catalogue requests carry the existing `provider:'tmdb'` scheduler tag, activating established pacing. No scheduling limits or provider concurrency contract were weakened.
- Provider cache lookup sweeps all expired entries, including failed-refresh paths; capacity 100/coalescing and incomplete-result behavior remain. There is no idle cleanup timer: expired entries remain until the next lookup. A byte budget was not invented without evidence.
- Image cache maintains its byte total on restore/write/changed-size read/deletion/eviction and returns from trim before copying/sorting a Map when both budgets already admit the allocation. Seven alternating 200-call rounds at 10,000 entries measured actual trim-body 1.012841→0.000147 ms per call. This excludes filesystem I/O. Serial admission, free-space checks, LRU/budgets and temporary cleanup are covered.

No speculative HLS buffer limit, virtualization, relay buffering or broad queue admission rewrite was introduced. The original playback/account ordering contracts and independent feature gates are preserved. Playback, device frame-rate and long-running production heap behavior remain evidence limits.

## Administrator benchmark and comparisons

Settings → Administration → Benchmarking uses existing Heading/Button/list/EmptyState/Pagination patterns, one Run benchmark button and durable 20-row paginated history. The workload is versioned `coast-local-v1`. Existing outbox execution is reused. Atomic advisory admission plus a database partial unique index permits one queued/running run across workers. A separate execution lock prevents duplicate deliveries from running probes twice. Administrator role/disabled state are checked on reads, admission and execution, not only from the saved session. Cancellation, missing/failed jobs, process restart, stale leases and five-minute abandonment produce understandable history. Failed benchmark Jobs controls direct the administrator to a new run, preserving the old result rather than pretending a retry succeeded.

Each workload opens a database read-only transaction, disables interactive-query JIT and uses the existing local recursive estimate. It invokes no provider adapter/fetch or domain write. A malicious called SQL function attempting a personal write was rejected by the transaction; tracking data stayed exactly unchanged. Twelve concurrent admissions produced one run/job. Actual worker probes retained history across database connection close/reopen and made zero fetch calls.

One explicit untimed warm-up precedes ten database round trips and five rounds each of actual Collection membership/page, 60-ID Collection assessment, and a fixed 6,000-event journal filtering workload. Each statement has a five-second timeout; no new probe starts after the 30-second deadline, and an in-flight statement may finish later. It is not a strict 30-second total wall-clock promise. Partial failed metrics/error codes are retained.

History records build/source identity, workload, Bun/platform/architecture/OS/CPU model/count, host memory, readable cgroup CPU/memory limits, PostgreSQL/settings, catalogue/personal counts, dataset fingerprint, and observed background activity. Measurements include per-probe raw latency/median/p 95, elapsed time, whole-process CPU and before/after/observed-peak RSS/heap. Fifty-millisecond sampling can miss short spikes. CPU/RSS include unrelated app/queue traffic; they are not attributed exclusively to the benchmark or exact peaks.

Comparison matching is per probe. All require matching workload/runtime/hardware/limits/database context and successful runs without other background jobs observed. Collection additionally requires matching account/policy/catalogue/counters/date/effective freshness and no dataset change during the run. Fixed journal/roundtrip probes retain comparisons across catalogue/date changes; changed datasets do not masquerade as matching Collection. Each percentage names its actual prior run/date; two noisy runs do not establish a trend. Build identity is recorded while software versions can be compared to find drift. Unknown resource limits are explicitly unavailable.

Two representative catalogue runs completed around 2.26/2.38 seconds and stored all four comparable probe results. In the real browser, two administrator clicks recorded two completed runs, reload retained both, all four matching comparisons appeared, and 375 px layout had no horizontal overflow. The page and both `/api/v1/admin/benchmarks` methods returned 403 for a member. The final administrator reload had zero errors/warnings. Desktop/mobile captures are `/tmp/coast-benchmark-desktop.png` and `/tmp/coast-benchmark-mobile.png`. The disposable 5294 browser/server/database/data directory were removed afterward; main 5173 remained running.

## Verification and reproduction

- Full unit suite: 261 passed, 369 DB-gated skipped, 0 failed, 1,527 assertions across 113 files. DB skips are covered by separately run disposable suites below, not counted as unit passes.
- Benchmark/revision DB suite: 19 passed/113 assertions, including atomic admission, demotion/disable, read-only protection, recovery, duplicate delivery, monotonic out-of-order commits, opposing import locks, owner transfer, metadata overrides/user cascades, presence, freshness, public reactions/profile privacy and private Steam observations.
- Independent Collection/projection/social DB suites: 43 passed. Jellyfin reconciliation: 9 passed/33 assertions. Server-specific migrated fixture suites: 10 passed/58 assertions; original HEAD Trakt importer also passed the same nine history assertions.
- Focused server unit fixtures: 13 passed/71 assertions; frontend fixtures: 40 passed/324 assertions. Lifecycle/build/model fixtures: 6 passed/27 assertions. These focused counts overlap the full unit suite.
- Svelte check: 0 errors/0 warnings. Production build passed (exit 0). UI inventory regenerated 62 components; code inventory reports no unused modules. `git diff --check` passes.

Durable controlled harness: `scripts/performance-verification.ts`. It reads the immutable baseline from Git, creates a generated disposable database, migrates it, seeds only synthetic records, runs repeated queries/equivalence/concurrency/revision/index comparisons and the actual benchmark, then drops its database and temporary data/modules in finally. Its worker rejects any database path outside the generated fixture prefix. Set `TEST_DATABASE_URL` securely in the environment; it is used only for fixture creation/deletion. It never prints the URL.

```sh
bun scripts/performance-verification.ts /tmp/coast-performance-verification.json
bun scripts/test-database.ts benchmarks-db.test.ts collection-db.test.ts collection-projection-db.test.ts social-db.test.ts
bun scripts/test-container-lifecycle.ts coast-new-test-db
bun test tests
bun run check
bun run build
bun run ui:inventory:check
bun run code:inventory
```

Use an available Bash 5 test container for the shell fixture; it starts/kills only its own short-lived processes. Run timing harnesses serially with other heavy local work idle. The first isolated helper trial attempted to drop an already absent index during alternating phases; cleanup completed, the harness was corrected to `DROP INDEX IF EXISTS`, and its final completed run is the reported reproduction. This was a fixture setup issue, not an application failure.

Migration 0039/0040 and the reviewed function/trigger corrections were applied to existing dev data by the parent agent. Nothing was applied to production. Temporary database fixtures, provider-free UI data and task-owned browsers/servers were removed. Logs/raw reports remain as evidence. No dependency or licensing changes were made.
