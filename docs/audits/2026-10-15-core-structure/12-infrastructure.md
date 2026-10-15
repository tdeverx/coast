# Infrastructure review — 2026-10-15

## Scope and method

Reviewed the current working tree's database representation and migration bookkeeping, shared provider transport/priority/cache/body/credential helpers, disk artwork cache and transient retention, structured diagnostics, benchmark service/model/UI, container lifecycle, image workflow and verification scripts. Read the architecture, organisation, performance, deployment, diagnostic and verification guidance against implementation. Applied the Supabase Postgres best-practices skill to index/schema analysis; recommendations retain Coast's existing bounded pool, transactional locks, native driver and durable outbox.

This was a read-only application review. The only saved changes are this report and its JSON companion. No database connection, socket, provider, credential inspection, service startup, dependency change, check/build, commit or publication was performed. The focused security test uses generated fixture credentials in a private temporary directory and mocks fetch; it does not inspect installation credentials. Other reviewers own authentication, API handlers, queue execution and feature behavior. The root reviewer's confirmed transaction/pool contention finding is deliberately not duplicated here.

Verification performed:

- `PATH="$PWD/.tools/bun-darwin-aarch64:$PATH" bun test tests/request-priority.test.ts tests/platform-security.test.ts tests/request-body.test.ts tests/async-work.test.ts tests/image-cache.test.ts tests/diagnostic-logging.test.ts tests/benchmarks.test.ts tests/container-application.test.ts tests/container-child-exit.test.ts`: **41 passed, 0 failed, 230 assertions**.
- In-memory `drizzle-kit/api` snapshot generation and migration diff against the last saved snapshot: **69 statements**, including creation of ten tables already represented by applied migration files. No migration file was generated and no SQL was executed.
- Mocked buffered provider response: `timeoutMs:30`, a byte every 15 ms, nine bytes plus EOF: **HTTP 200 after 174 ms**. Diagnostic writes were disabled and fetch was replaced before the call; no networking occurred.
- Static source/caller/index/documentation inspection. Root's broader check/build/database results are separate evidence, not checks rerun by this reviewer.

## Coverage and healthy patterns

Substantively read every module in the assigned `server/db`, `server/security`, `server/storage`, `server/utils` and `server/diagnostics` directories, all three benchmark files, build identity/startup callers, Dockerfile, Compose, workflow, config files and the migration/test/recovery/container/performance/inventory scripts. Browser scripts were read as verification consumers; they were not executed. Read recent SQL migrations 0039–0051, relevant prior account/identity/retention migration excerpts and schema index/constraint definitions. Earlier generated migration/snapshot files were inventoried and scanned, not independently replayed. Exact path inventory is in `12-infrastructure.json`.

The infrastructure is generally cohesive:

- A lazy, globally retained ten-connection Bun SQL pool supports build independence and development module replacement; reserved-session idle retirement stays disabled for advisory-lock ownership.
- Credentials use AES-GCM and atomic hard-link installation of a private key. CSRF checks require an exact origin for browser mutations. The common JSON reader bounds decoded input while reading and rejects non-object/invalid UTF-8 payloads.
- Provider URLs enforce approval, port, reverse-proxy prefix and checked-address constraints; fetch pins a checked address, retains TLS hostname validation, strips cookies/proxy authorization and rejects redirects. Buffered responses retain their lane until consumption; streamed media uses the existing separate lifetime.
- Request lanes retain per-origin serialization, cancellation, promotion and aging; pure concurrent helpers settle in-flight workers before reporting failure. Provider caches have finite successful-value capacity/TTL and do not retain failures.
- Artwork admission/eviction is serialized, restores existing accounting, includes temporary allocation/free-space checks and handles missing files. Existing restart/LRU/concurrency tests pass.
- Retention uses a transaction-level advisory lock, bounded 500-row batches and `SKIP LOCKED`, deliberately preserving permanent histories and outbox evidence. Reading retains a newest edition/format bookmark.
- Diagnostics have a closed redacted schema, bounded pending writes, segmented private storage and best-effort failure behavior. Container stderr is independently bounded and child exit/status evidence survives application restarts.
- Benchmarks retain local read-only probes, statement timeouts, raw samples, workload/environment/dataset compatibility, bounded history pages and execution/admission locks. The UI explains measurement limits. No benchmark redesign is justified by this review.
- Disposable DB/recovery/performance scripts create distinct test databases; CI verifies the production build and both native image architectures before the public multi-platform tag is assembled.

## Prioritized findings

### INFRA-01 — P2: Buffered provider responses have an idle timeout but no completion deadline

**Confirmed by mocked execution.** `src/lib/server/security/provider-fetch.ts:182` starts the configured timer for DNS/headers, but `:250` clears it as soon as the wrapped response is returned. `limitedBody` creates and clears a fresh timer for every individual read at `:125` and `:161`. `secureProviderFetch` awaits the entire body at `:317` while holding the per-origin lane at `:324`.

A provider sending another small chunk before every idle timeout can therefore keep a JSON/metadata/account operation alive far beyond its configured timeout. The default eight-MiB byte bound still allows an extremely long slow-drip response. This delays all buffered requests for that origin and can occupy a durable worker/service lock beyond ordinary recovery times. The mocked 30-ms request above completed successfully after 174 ms; this is a completion-deadline gap, not the separate already-known queue-admission/backlog question.

**Minimal correction:** Retain an overall deadline through consumption of buffered responses and cancel the upstream body on expiry. Preserve the existing caller abort behavior, byte bounds, pacing/cooldown and long media stream idle-timeout semantics. Do not impose the metadata deadline on a multi-hour stream.

**Useful verification:** Mock a fetch whose body is tied to the supplied abort signal and emits chunks comfortably inside the idle limit for longer than the total deadline. Expect `TimeoutError`, upstream cancellation and progress of a waiting same-origin request; retain current slow-header, idle-body and caller-cancellation tests. Separately ensure an active media stream is not terminated by the short buffered deadline.

### INFRA-02 — P2: Migration snapshots lag applied SQL and regenerate existing schema

**Confirmed using the installed in-memory generator API.** `package.json:20` exposes `db:generate`, and `drizzle.config.ts:4` configures the normal schema/snapshot directory. `drizzle/meta/_journal.json:307` through `:366` register migrations 0043–0051, but the last snapshot is `drizzle/meta/0042_snapshot.json`. Later files create tables and columns, for example `drizzle/0047_reading_experiments.sql:1` and `drizzle/0051_shared_request_leases.sql:1`, while `schema.ts:1024` and `:1349` also declare them.

The installed Drizzle generator selects the latest sorted snapshot (`node_modules/drizzle-kit/bin.cjs:19862`), not the journal SQL, as its previous model. `generateMigration(0042, generateDrizzleJson(currentSchema))` produced **69 statements**, including `CREATE TABLE` for `provider_job_snapshots`, all four reading tables, both server-stream tables, `share_request_leases`, and both Trakt staging tables, plus already-applied playback/share/room columns.

The current checked-in migration chain can work; the defect is the next advertised generation step. Its output attempts to recreate existing objects and fails on migration unless manually recognized and repaired. Existing tests replay applied SQL, so they do not catch this generation baseline drift.

**Minimal correction:** Synchronize the latest generation snapshot with the schema already represented by migrations 0043–0051, retaining the existing applied SQL and custom trigger/function history. Do not apply the generated duplicate SQL or rewrite historical database contracts. Add a focused no-op generator check on the current model, with custom SQL differences documented explicitly.

**Useful verification:** A no-change generation diff should contain no SQL. Then add a temporary harmless schema field in an isolated disposable checkout and confirm generation emits only that intended change; replay the normal migration chain in a disposable database when implementing the correction.

### INFRA-03 — P2: An older successful workflow can overwrite a newer preview image

**Strong static evidence; no live publication was attempted.** `.github/workflows/verify-and-publish-preview.yml:125` makes publication wait for that run's image matrix. Only the publish job is serialized at `:129`; earlier verify/build stages from different pushes can overlap. Every publishing run adds the mutable `preview` tag at `:152`, and `:173` assigns all tags without checking whether the run still represents current main.

If an older run A takes longer to build than newer run B, B can publish first, followed by A. Serialization prevents simultaneous writes but still lets A move `preview` backwards. Rerunning an older successful workflow has the same path. Users following the documented Compose preview image can consequently pull older application/schema code after newer code was available. This is a possible CI execution order, not a claim that a production rollback occurred.

**Minimal correction:** Inside the serialized publishing step, update `preview` only for a still-current intended preview revision. Continue publishing immutable SHA/version references for completed builds as appropriate. Keep both-architecture verification; do not solve ordering by removing validation or cancelling an in-progress manifest write.

**Useful verification:** Exercise or simulate two runs where A starts first but reaches publication after B, and an old-run rerun. Confirm the immutable references remain available and preview never moves to an obsolete revision.

### INFRA-04 — P3: The promised taste-outbox unique index is attached to the unused runtime jobs table

**Confirmed schema/caller drift; duplicate execution is not established.** `schema.ts:709` retains a parallel `jobs` schema, and `:728` attaches `outbox_taste_one_active_idx` there. `drizzle/0042_superb_major_mapleleaf.sql:46` likewise creates it on `jobs`. Production taste admission checks/inserts **outbox_actions**, at `src/lib/social/taste-cache.server.ts:40` and `:47`; the only discovered `jobs` insert is the JSONB codec test (`tests/domain-jsonb-db.test.ts:120`). `docs/experimental-features.md:68` nevertheless attributes single-active-job admission to a partial unique index.

The existing manual and maintenance admission paths use the shared advisory lock, so this is not evidence of an ordinary duplicate-job bug. It is a real invariant/documentation mismatch: the named index does not constrain the rows it claims to protect, and the unused parallel table made that mistake easy to introduce.

**Minimal correction:** Put the intended partial unique constraint on the actual outbox table through a new migration and align the ORM declaration, or explicitly document advisory-lock-only admission and remove the misleading dead constraint. Review the remaining runtime-unused table and codec test together before deciding whether it needs to remain; do not introduce a second job runtime.

**Useful verification:** Inspect the index's actual relation/predicate in a disposable migrated database and test the intended active taste-job invariant against `outbox_actions`, including terminal-state transitions. Keep current scheduler/advisory-lock coverage.

## Documentation notes and uncertainties

- `docs/diagnostic-logging.md:5` says provider duration measures response headers. At `provider-fetch.ts:306–330`, a buffered request's duration includes lane waiting/pacing and complete body buffering; a streamed request ends at response headers. Correct that distinction when updating the guide so exports do not misattribute local lane delay to provider header latency.
- `docs/code-organization.md:25` names `migrations`; the immutable SQL history is actually `drizzle`. This is minor navigation drift, not a reason to rename the persisted migration tree.
- This review did not observe real DNS/TLS behavior, provider response pacing, deployed filesystem permissions, registry publication order, Docker lifecycle, migration upgrade histories or runtime query plans. The passing mocks establish the tested contracts only.
- Retention's returned `more` flag and startup/shutdown scheduling were traced only through direct infrastructure callers. Playback cleanup concurrency is covered by the separate playback report; no duplicate finding is asserted here.
- All schema declarations were inspected, but the complete historical migration chain and manually implemented trigger behavior were not independently rerun. Earlier snapshots were scanned rather than manually compared column by column. Current fresh-chain DB results belong to the root audit.
- Benchmark environment comparability remains observational (host/process load, cache and short unobserved activity can differ), as already documented. No new performance regression is claimed without representative measurements.

## Minimal ordered recommendations

1. Preserve a real buffered-response deadline and add the single meaningful slow-drip regression (INFRA-01).
2. Repair the generation baseline before the next schema change; verify a no-op model produces no migration (INFRA-02).
3. Fence the mutable preview tag to the intended current revision without weakening native-image checks (INFRA-03).
4. Reconcile the taste uniqueness claim, actual outbox index and runtime-unused `jobs` declaration (INFRA-04), then correct the two small documentation statements.

Retain the current UI, existing performance/security boundaries and simple shared primitives. This review provides no reason for a new framework, production dependency, cache system, scheduler, database layer or broad schema split.
