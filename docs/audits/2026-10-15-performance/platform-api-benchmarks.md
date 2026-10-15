# Platform, public API and benchmark performance audit

Baseline: `ea01908`, branch `codex/performance-criteria`, 2026-10-15. Independent read-only phase. No production files, databases, services, provider calls or containers were changed/started. Source evidence is distinguished from measured runtime evidence below.

## Executed evidence

- Read `docs/performance.md`, `docs/architecture.md`, diagnostic/public API documentation; platform hooks/startup/readiness/pool/auth/config/retention, public API boundary/read models/mutations/token/webhook handlers, benchmark workload/model/history UI and their focused tests.
- Ran Bun 1.4.3: `bun test tests/benchmarks.test.ts tests/readiness.test.ts tests/runtime-evidence.test.ts tests/diagnostic-logging.test.ts`.
- Result: **21 pass, 0 fail, 117 assertions, 4 files, 281 ms runner-reported**. These are correctness fixtures, not application latency measurements. No database or browser acceptance was run by this agent.

## Findings to implement

### P-PERF-01 — Deduplicate configuration reads within a request, not across requests

**Severity:** P2. **Confidence:** High for redundant work; production latency impact not measured.

References:
- `src/hooks.server.ts:103–106`: every non-health request awaits `refreshDiagnosticConfig()` before request timing starts.
- `src/lib/server/config.ts:68–84`: each `getConfig()` performs SQL and parses the full settings schema; refresh calls it.
- `src/lib/server/auth/index.ts:145–148`: a syntactically valid session cookie causes a second configuration read for lifetime policy.
- `src/hooks.server.ts:55–56,73–74`: setup query, third configuration read for site policy, and a fourth read on gated music/game/party paths.
- Domain methods then obtain further snapshots as needed.

An ordinary signed-in request performs at least three serial settings reads before its handler; experimental paths perform four. This affects every lazy artwork, shelf, presence and player request, rather than just page navigation. The request-completion duration currently excludes the first settings wait at line 105, so that diagnostic is not total request latency.

**Smallest safe fix:** introduce a request-local configuration snapshot/single-flight (for example one existing async-context scope) or explicitly pass the same configuration through hook/auth policy checks. Keep explicit `getConfig(transaction)` reads separate and current on their transaction. Keep jobs outside an HTTP scope fresh. Move the timing start before request prework. Do not add cross-request TTL caches of authorization, setup existence, onboarding, account disabled/role status or tokens. In particular, the fresh setup check fixed by the previous audit must not be reverted.

**Acceptance:** concurrent calls inside one request share one default settings query; a later request sees settings changed by another request/process; explicit transaction reads use the supplied connection and observe its writes; failed reads cannot poison future scopes; requests/Jobs retain revocation, onboarding and disabled-account checks. Record SQL counts as well as wall latency on a representative multi-artwork request fixture.

### P-PERF-02 — Index the previous-session-token lookup

**Severity:** P2 scaling candidate. **Confidence:** High missing-index/source fact; EXPLAIN confirmation required before publishing performance claims.

References:
- `src/lib/server/auth/index.ts:149–150`: `token_hash = $hash OR (previous_token_hash = $hash AND previous_valid_until > NOW()) FOR UPDATE` runs for every authenticated browser request.
- `src/lib/server/db/schema.ts:89–104`: token hash is unique/indexed; only user and expiry auxiliary indexes exist. `previous_token_hash` is not indexed.
- `tests/platform-db.test.ts:110–125`: current rotation/grace/expiry regression to preserve.
- `src/lib/server/storage/retention.server.ts:10`: session expiry cleanup is already bounded; do not report sessions as entirely unretained.

An OR branch without an index cannot use the ordinary token-hash index alone to satisfy the full predicate; at a sufficiently large session population the plan must inspect rows beyond the exact current-token match. This multiplies catalogue-wide work by artwork/shelf request fanout. No live plan or latency was captured here.

**Smallest fix:** add a non-null partial B-tree index on `sessions(previous_token_hash)` to Drizzle schema and an additive migration. Preserve the existing rotation transaction and fresh user lookup. A two-phase unlocked authentication redesign is unnecessary for this finding.

**Acceptance:** disposable fixture with thousands of current/expired/rotated sessions; capture actual EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) before/after for both current and previous hashes (valid + invalid). Show indexed lookup/bitmap OR rather than scanning the population, with complete result equivalence. Retain rotation grace, expiry, logout, disabled-user and concurrent rotation cases. Do not force planner settings as proof of normal production behavior.

### P-PERF-03 — Benchmark Collection workload excludes enabled books/comics

**Severity:** P2 measurement correctness. **Confidence:** High, confirmed source mismatch.

References:
- `src/lib/benchmarks/service.server.ts:182–186`: hardcoded enabled SQL permits only `screen`, enabled `music`, enabled `game`.
- `src/lib/server/experimental.ts:23–25`: shared `enabledCategories()` correctly includes `book`/`comic` flags.
- `src/lib/benchmarks/model.ts:1`: workload remains `coast-local-v1`.
- `src/lib/benchmarks/service.server.ts:187–189`: assessment selects tracking IDs without the same enabled-medium filter, making the two Collection probes inconsistent when reading is enabled/disabled.

The production Collection handles reading but its advertised benchmark silently omits those members. An installation with only reading Collection entries can receive a zero-row membership probe and apparently valid timing. This is a coverage/semantic defect, not evidence that the application Collection itself is slow.

**Smallest fix:** use shared `enabledCategories` for the membership query and make the assessment cohort explicitly follow the same enabled-medium contract. Extract a small SQL builder if necessary to test the actual executed workload. Bump the workload version when changing selected-cohort semantics so historical v1 and updated runs cannot compare as identical work.

**Acceptance:** disposable benchmark fixtures with screen/book/comic Collection rows and independent feature flags prove enabled reading is counted/selected and disabled reading excluded; actual page IDs or stable result signatures must match the corresponding production read contract, not only `rows <= 60`. Preserve raw timing samples and existing read-only/deadline/advisory-lock behavior. Unit comparison test rejects old/new workload versions. Update performance docs to state the benchmark's finite probe/medium coverage precisely.

### P-PERF-04 — Benchmark polling can overwrite a newer page and cannot abort on teardown

**Severity:** P2 UI consistency/resource lifecycle. **Confidence:** High race in source; rendered browser reproduction still required.

References:
- `src/lib/benchmarks/BenchmarkSettings.svelte:11–12`: local `current` replaced from navigation props.
- `src/lib/benchmarks/BenchmarkSettings.svelte:22–30`: page-bound polling only checks `stopped`, without an AbortController or request generation/page identity.
- `src/lib/benchmarks/BenchmarkSettings.svelte:68`: page changes navigate the same benchmark component.
- Shared method: `src/lib/ui/resource.svelte.ts`, `createResource` latest-request-only publishing/cancellation.

Repro: begin a slow page-1 poll, navigate to page 2 while it is in flight, let page-2 props publish, then resolve page-1 poll. Because `stopped` is still false, it overwrites page 2. Unmount prevents publication but leaves the network/server work running. `run()` also performs a history request without page-generation checks. This duplicates the client loading method explicitly covered by current performance docs.

**Smallest fix:** reuse the shared abortable resource/client request pattern; cancel/reconcile when history/page context changes and on teardown. Preserve the current UI and polling interval. A separate polling framework is unnecessary.

**Acceptance:** delayed-response fixture and browser check: old page/start responses cannot overwrite current context; repeated enter/leave/page-change leaves zero pending poll requests/timers; hidden tabs do not poll and a terminal active run stops polling. Keep one in-flight poll and no artificial result loss.

### P-PERF-05 — Webhook listing is unbounded across disabled subscription history

**Severity:** P2 bounded-response consistency. **Confidence:** High, confirmed source reachability.

References:
- `src/lib/server/public-api/webhooks.server.ts:25–26`: only enabled subscriptions count toward the ten-subscription admission cap.
- `src/lib/server/public-api/webhooks.server.ts:37–42`: delete disables a subscription; list selects every historical subscription without order/limit/page.
- `src/lib/server/public-api/handler.server.ts:34`: GET `/webhooks` rejects all query parameters and serializes the entire list.
- Existing analogous bounded account list: `src/lib/server/public-api/tokens.server.ts:13–16` active-first, newest-first limit 50.

Repeated legitimate create/delete cycles accumulate records; every listing transfers them all even though only ten may be active. Secret/delivery history should remain durable, but that need not make an interactive list unbounded.

**Smallest fix:** adopt an explicit bounded read contract consistent with existing token management (active-first, deterministic newest order, e.g. 50), or the existing standard paginated public list model if complete disabled history is required. Retain tombstones and outbox references rather than deleting them as a performance shortcut. Document the chosen contract. No new storage mechanism/dependency is needed.

**Acceptance:** fixture with >50 disabled +10 active subscriptions proves finite deterministic response, all enabled subscriptions remain inspectable, owner isolation and secret exclusion, and revoked/disabled subscriptions cannot deliver. If paginated, use existing parameter validation/publicPage, not a new pagination style.

## Additional improvement candidates (lower priority; do not claim measured regressions)

1. **Administrator broadcast performs N per-user reads and inserts, fetching all users into memory.** `src/lib/server/notifications/index.ts:89–96` selects all enabled IDs, then `notify()` rereads global configuration and per-user settings and inserts once for each (`:20–38`). For large installations this is one synchronous HTTP request doing roughly 3N queries and no yield/checkpoint. Prefer a set-based/bounded domain operation that preserves user silence/config/locked-level semantics, or the existing durable queue when delivery is meant to be asynchronous. A normal small home instance may not notice; choose targeted synthetic query-count/result-equivalence validation rather than asserting production overload. Root should deduplicate against any social/notifications agent finding.
2. **Benchmark active polling reruns history joins and reconciliation.** `listBenchmarks` performs two reconcile updates, count, 20-row lateral comparison hydration and active lookup on every two-second poll (`service.server.ts:32–80`). This work and authentication can contaminate process-wide CPU observations during the benchmark itself. Current docs correctly disclose process-wide/other-traffic limits. First fix request duplication/cancellation and measure before introducing another endpoint. If improved, poll a minimal active status then refresh history once at a terminal state using existing resource patterns.
3. **Diagnostic hot write filesystem amplification.** `DiagnosticStore.write` (`diagnostics/index.ts:93–121`) does mkdir, chmod, stat and append per event, plus bounded periodic pruning. Queue length/storage are already bounded; this is not a memory leak. Consider one initialized directory/segment size counter per store with recovery after filesystem errors only if an isolated high-event-rate probe demonstrates useful CPU/I/O reduction. Preserve owner-only permissions, rotation, saturation counts, best-effort semantics and cross-generation behavior. Do not optimize by dropping failure visibility or disabling diagnostics.
4. `systemHealth` labels combined DB roundtrip + action counts + connection counts as `database.latencyMs` (`notifications/index.ts:104–114`). If surfaced as latency evidence, time the intended boundary explicitly; do not compare it with benchmark `select 1` as equivalent work.

## Nonissues / existing safeguards to preserve

- Health/readiness bypasses unbounded settings work, coalesces one cancellable DB probe per process, stays unavailable until cancelled work settles, and refuses readiness during shutdown. The 3 focused readiness tests passed.
- Runtime sampler has constant storage, one non-overlapping unreferenced minute timer and bounded event budgets. Diagnostic writes have 128 pending/4 MiB segmented limits. Nine runtime and six diagnostic fixtures passed. No leak/OOM claim is justified from this inspection.
- `getSql` retains one HMR-safe ten-connection pool, no reserved-session idle retirement, and explicit bounded shutdown; do not raise pool/concurrency or enable idle retirement without evidence.
- Public lists generally count/filter before bounded 60-card hydration and reuse domain read models; public mutations validate 64 KiB JSON and retain account/credential/idempotency/domain/webhook writes in one transaction. Do not introduce parallel projection logic to optimize them.
- Token quota writes are intentionally atomic/durable across processes. Avoid replacing them with process-local counters or cross-request auth caches.
- Non-stream provider HTTP responses are already bounded and consumed before releasing the per-origin lane (`provider-fetch.ts:323–329`), including webhooks. An unused webhook `Response` does **not** leave a live upstream body open; no leak finding here.
- API replay keys deliberately persist until token deletion (`docs/public-api.md`) and benchmark history is deliberately retained for comparisons. Do not silently TTL-prune either to reduce storage.
- Benchmark history is paged at 20; previous comparison lookups have dedicated indexes. Exact count/offset/history retention alone is not a demonstrated bug. Existing sample statistics correctly describe five warm samples and nearest-rank p95, not production tails.

## Proposed additions to docs/performance.md criteria

- Scope each audit to feature ownership + the shared primitives it uses; independent reports must mark **observed defect**, **measured bottleneck**, **hypothesis**, **acceptance gap**, or **nonissue**, with exact code/evidence and smallest reusable fix.
- Set operation-count and bounded-work budgets as well as latency: config/SQL queries per request, hydrated page cardinality, active listeners/timers/pending requests, queue depth, finite response size/history-window sizes. Use repository-specific contracts rather than universal millisecond assertions.
- Caches/single-flight must state identity, lifetime, invalidation and permission policy. Default request-local snapshots can reduce repeated work without weakening next-request authorization; explicit transaction/connection reads must never escape to another connection or stale cached result.
- Prove result equivalence for every currently enabled medium and gate combination; benchmark workload definitions must reuse shared category/candidate rules. Change workload version if selected work/measurement semantics changes; executable build changes alone are comparison subjects, not automatic incompatible versions.
- Treat polling/loaders as cancellable component resources: key each request to page/filter/account, publish only its current generation, abort on replacement/unmount, avoid background-tab work and retain one in-flight operation.
- Define timing boundaries explicitly. End-to-end request timing starts before policy/config/auth work; DB probe, pool wait, domain query, serialization and browser rendering are separate measurements.
- Reproduce hot SQL plans at realistic cardinalities on disposable DBs (including cold/invalid/rotated credentials); report selected IDs, row counts, index/buffer evidence and measured concurrency behavior. Do not add index/raise pool solely on guessed production timing.
- CPU/RSS/logging observations need idle/active deltas, event counts, retention/backpressure and build/runtime context. Preserve diagnostic visibility and existing safety limits while optimizing.
