# Independent provider, scheduler, imports and cache performance audit

Date: 2026-10-15. Read-only audit of `ea01908` / fresh `codex/performance-criteria` checkout. No production edits, DB tests, containers, provider calls, credential reads, installs, full builds/checks, commits or pushes. Read current performance/architecture/job-scheduling docs, October 3 server implementation/evidence, current scheduling/request transport, Jellyfin inventory/companion/live imports, Steam and Trakt staging, artwork/cache and webhook paths.

## Confirmed findings, ordered by practical impact

### PJI-1 — P2: unchanged music imports rebuild all selected-album membership repeatedly

Paths: `src/lib/music/persistence.server.ts:58-65`; caller `src/lib/sync/jellyfin.server.ts:565`; normal shared catalogue persistence also calls `persistMusic`.

Every observed track updates its edition and selects both its current and old album. Under the album lock, it reads the exact selected-release members, DELETEs all `contains` relationships, then INSERTs every distinct child again. This occurs even when edition/membership is unchanged. For a 20-track album, a normal unchanged 20-track refresh produces 400 relationship deletions + 400 insertions. Initial incremental builds similarly rewrite an increasing membership prefix. Metadata `updatedAt` and artist-name writes are also unconditional, but identity/freshness fields must not be indiscriminately skipped.

Reproduction: `/private/tmp/coast-perf-jobs-probe.test.ts` runs the **actual `persistMusic` implementation** with a deterministic transaction adapter and selected-release membership fixture; no source-string assertions. Exact recorded counts: 20 invocations, 220 mocked awaited statements, 400 relationship row deletions + 400 insertions. This establishes call/write amplification, not actual PostgreSQL elapsed time or WAL bytes. The DB mock does not certify trigger/transaction behavior.

Smallest justified improvement: while retaining the same album row lock, compare existing `contains` child/position pairs against the exact selected-release projection and skip relationship writes when identical. Better, delete only removed children and upsert changed/new positions (bounded batches). Reuse this at the persistence owner so manual detail hydration, shared scans and companion deltas benefit, rather than optimizing only onboarding. Preserve first occurrence position deduplication, repeated edition occurrences, old/new album reprojection, artists, canonical identity checks and `lastSeenAt`.

Required acceptance: disposable DB fixture with unchanged 20-track album has **zero changed relationship rows** after refresh, identical complete ordered memberships/Collection output, and no relationship-trigger revision churn. Add move-to-another-album, selected-vs-unselected-edition, duplicate-recording occurrence and changed track/disc position cases. Root coordinates real DB verification.

### PJI-2 — P2: Steam achievement refresh uses one DB write per unchanged achievement and quadratic matching

Path: `src/lib/providers/steam/sync.server.ts:157-170`.

Each progress record calls `definitions.find(...)` then upserts a row with a fresh `updatedAt`, even if unlocked/date state has not changed. A 1,000-achievement title performs up to 500,500 identifier comparisons plus 1,000 progress statements; a schema refresh additionally writes each definition individually. Twenty eligible titles are bounded by the job but the per-title achievement cardinality is not a small constant. This is source-confirmed operation growth, not measured live bottleneck. Existing exact-AppID/account-generation safeguards are good and must stay.

Smallest improvement: build a Map by exact definition external ID once; submit bounded multi-row upserts of progress and schema (e.g. 100/500 rows), and use an `IS DISTINCT FROM` value guard to avoid unchanged progress writes while keeping the account's successful `achievementsAt`/attempt marker. Keep schema freshness semantics: simply not updating an unchanged definition timestamp would make `existing.some(stale)` fetch the schema every pass; either refresh successful schema evidence deliberately or retain existing timestamp refresh. Do not introduce an unnecessary second schema cache.

Acceptance: actual disposable fixture with N=100/1,000 counts progress round trips scaling by batches, compares all final states/dates, handles unknown definitions and duplicates safely, retains last-known progress on failed/private reads, preserves opt-out/generation fencing and checkpoint/yield semantics. Pure operation counting for Map matching can supplement but does not replace DB semantics.

### PJI-3 — P2 at larger retained histories: recurring scheduler aggregates all permanent history every minute

Path: `src/lib/providers/maintenance.server.ts:180-196`; outbox index `src/lib/server/db/schema.ts:712-716`; retention contract `src/lib/server/storage/retention.server.ts:4` and `docs/job-scheduling.md`.

The group query reads all matching account/kind rows, computing `bool_or` active and `max(updated_at)` successful with current-generation filtering. `outbox_maintenance_idx(connection_id,kind,state,updated_at)` can locate the matching history, but does **not** bound aggregate input. The outbox is intentionally retained permanently, so retention does not cap this cost. For every one-minute live task, success rows grow by up to 1,440/account/day, independent of how few tasks are due. Repeated in-memory `.filter/.some/.find` at lines 218-239 adds avoidable account/task cross-product work, but likely secondary to SQL and unmeasured.

Recommendation is **measurement-gated**: root should seed an isolated 1/10/100-account history fixture (30 and 365 days, representative kinds), capture EXPLAIN ANALYZE BUFFERS and exact complete evidence. Replace the full aggregate with bounded per-(connection,kind) active `EXISTS` and latest-success `ORDER BY updated_at DESC LIMIT 1` probes, likely using the existing index and a matching current-generation predicate; preserve null-generation behavior. A narrow partial successful-index including account generation may be justified only after plans. Do not delete permanent job history or introduce a separate scheduler to solve it. Convert presence/group lookups to Maps as local no-behavior-change cleanup only if fixture proves material costs.

Regression criteria: identical due candidates, counts, manual promotion, old-generation nonblocking, permanent failures, service-wide vs account scope, oldest due rotation and developer-mode gates with retained history expanded by 10x. Target bounded rows visited per account/kind rather than elapsed-only thresholds.

### PJI-4 — P3 confirmed lifetime bug: completed paced-origin lanes never expire while idle

Path: `src/lib/server/security/request-priority.ts:67-69`.

After every paced operation, `lane.next` is set to a future timestamp. The final deletion checks `lane.next <= Date.now()` immediately, so cannot delete. No later cleanup exists for an origin never revisited. Distinct webhook hosts or removed/reconfigured services can leave origin lane objects indefinitely. This is small metadata retention, **not retained response bodies or an OOM claim**.

Actual-module probe creates 50 different origins with 5-ms pacing, waits past pacing, and confirms all 50 idle lanes remain in the global state. Artifact `/private/tmp/coast-perf-jobs-probe.test.ts`; 3 total probe tests pass with six assertions on Bun 1.4.3. Do not delete immediately after completion, because that bypasses pacing/Retry-After on the next call. Smallest improvement: prune idle/empty lanes only after their deadline, via one owned unref'd shared sweep or expiry scheduling with reuse protection; test with controlled clock/timers and avoid one permanent recurring timer per origin.

Acceptance: idle origin entries disappear; calls queued during cooldown retain interval/defer semantics, same-origin serialization, promotions/ALS context, abort removal and fairness; one lane's expiry must not delete its active replacement.

## Demonstrated overload surface; do not blindly change semantics

### PJI-5 — P2 under overload: provider waiting queues have no admission/deadline bound

`request-priority.ts:49` appends unbounded entries; `provider-fetch.ts:providerFetch` starts its timeout **after** queue selection. Actual blocked-operation probe admits 2,000 waiting requests before releasing the operation. Aborting every queued caller clears all 2,000 and none executes (existing cancellation is correct). Source defaults include Comic Vine 18.1-second pacing and up to 24-hour durable cooldown; legitimate long waits must not be casually turned into provider failures.

Potential improvement: common per-origin admission bound with a distinct retryable local-saturation error, request-aware queue deadlines, and production diagnostics for pending/oldest wait. Existing jobs remain durable and can retry; browser callers receive an explicit transient failure. But this changes load shedding behavior and caps need meaningful owner/priority policy, so treat as an explicit implementation choice, not a free micro-optimization. Never silently drop, duplicate, bypass cooldown, add adapter-private FIFOs or fail urgent work behind arbitrary background occupancy. Need stress fixture establishing pending bound, exact call counts, queued abort cleanup, starvation prevention and recovery.

### PJI-6 — P2 under artwork burst: private server artwork lacks TMDB's aggregate download bound

`src/lib/providers/server-artwork.server.ts:5,22-33` has same-key deduplication when caching is enabled, but no pending cardinality bound; disabled caching removes deduplication too. TMDB at `src/lib/providers/tmdb/artwork.server.ts:59-60` already caps four misses with safe CDN redirects. Provider transport serialization means this does **not** automatically imply all private images download concurrently from one origin; it increases waiting closures/callers and can create parallel bytes across configured origins. Each item is bounded by the authorized relay's 10-MiB transport cap. No live burst/memory finding claimed.

Private authorization must be revalidated before every cache lookup/join. Cannot copy TMDB's redirect fallback because it exposes private server destinations/credentials. If common provider admission is implemented, this may be covered without another queue. Otherwise a small bounded private-download admission with explicit transient retry and cancellation needs browser artwork fallback acceptance; avoid returning permanent 404 on saturation. Not proposing a speculative second semaphore until policy chosen.

## Existing behavior deliberately retained / false positives eliminated

- Trakt fetch/application is durable and bounded per page/batch; oldest-first applying index and observed identity indexes exist. Complete census and account activity fences remain before negative publication.
- Steam raw snapshot is one bounded upstream response and journaled per chunk. **Successful/cancelled snapshot retention is not a bug:** migrations 0045/0046 have terminal/reset triggers deleting stages/snapshots; 30-day retention is only recovery fallback. Root must retain these triggers and avoid claiming records survive every completed import.
- Jellyfin companion native polling suppression is source/generation/health-aware, with periodic reconciliation retained; positive cache inventory does not waive per-account permissions. Music user scans reuse metadata mappings, unlike unconditional shared persistence noted above.
- Batched presence queries replaced October 3's N+1 presence queries. Do not re-flag the old issue as current.
- Provider cache expiry is swept on lookup; capacity is entry-count not bytes. People payload bytes merit profiling, but existing cap/sweep prevents unbounded success values and no new proof justifies another cache implementation.
- Disk artwork totals/early eviction return are fixed; disk reads still serialize with writes. No measured disk head-of-line issue in this pass, so not recommending speculative concurrency changes.
- Webhooks have a 10-active-subscription bound, 64-KiB bounded reply, ten-second provider timeout, eight automatic delivery attempts and queue-independent execution. History retention is intentional. No demonstrated webhook-specific bug beyond distinct-origin lane lifetime and common queue overload surfaces.

## Performance criteria additions for the consolidated guide

1. Measure repeated **unchanged** imports as well as first import; state equality alone does not prove low write/WAL/revision cost.
2. Bound service work by records/bytes/statements, not just top-level titles/accounts/jobs. Include large-album and achievement-cardinality distributions.
3. Include permanent-history growth in scheduler benchmarks; active queue size is not retained outbox size. Check actual plans and visited rows at 10x history.
4. Document every map/queue's keyspace, admission, eviction and release ownership, including idle expiry/cooldown and all abort paths. A bounded response does not bound queued responses.
5. Preserve provider schema/metadata freshness separately from user progress changes; no-op write optimizations cannot create endless schema refetches.
6. Treat load shedding as an explicit behavior contract. Keep durable retries, cancellation, urgency/fairness and no provider call on rejected/aborted admission.
7. Separate operation-count fixtures from DB plans/WAL and browser/live-provider acceptance. Never turn synthetic closure counts or RSS into a production leak/OOM diagnosis.

## Validation performed

`PATH="$PWD/.tools/bun-1.4.3/bun-darwin-aarch64:$PATH" bun test /private/tmp/coast-perf-jobs-probe.test.ts` — **3 pass, 0 fail, 6 assertions**. Actual imported music persistence and provider queue code; transaction/membership adapters are controlled mocks, no DB/provider traffic. Report and probe are temporary files only.
