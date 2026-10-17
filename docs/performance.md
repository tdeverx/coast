# Performance methods

This is the current implementation and review guide for performance work. Start here before changing queries, caches, scheduling or rendering. The [cross-feature audit and fixes](audits/2026-10-15-performance/README.md), earlier [implementation evidence](audits/2026-10-03-performance-implementation.md) and [raw measurements](audits/2026-10-03-performance-measurements.json) describe controlled fixtures, not production latency guarantees or proof that every CPU/memory spike is resolved.

## Acceptance criteria for a performance change

An optimisation is complete only when it reduces evidenced work or fixes a demonstrated resource/lifecycle defect, preserves required behaviour, and uses the shared implementation that owns that work. A smaller diff or a faster isolated query alone is insufficient.

| Gate | Required evidence |
| --- | --- |
| Work and scale | Identify the input that grows (titles, users, pages, events, concurrent viewers), the work per request and the bound. Measure at multiple input sizes where scale is the finding. Count queries, rows, bytes, requests or writes as well as time. |
| Correctness | Compare complete identities, order, counts and state, including privacy, availability, enabled media, account generations and retry semantics. Do not optimise by omitting authorised results or weakening checks. |
| Demand | Opening a route/panel activates only necessary resources. Offscreen work follows the existing Shelf/row policy; hidden or closed renderers stop optional work. Essential playback/party/heartbeat work has an explicit owner and cadence. |
| Lifetime | Test open → use → replace/close → reopen and cancelled/superseded work. Timers, observers, listeners, workers, object URLs, pending requests and sessions have bounded lifetimes. After repeated cycles, retained state reaches a justified plateau rather than growing per cycle. |
| Concurrency and failure | Exercise relevant concurrent users/lanes, slow/failed/aborted requests, retries and permission/account changes. Check no duplicate delivery, stale publication, starvation, unbounded queues or pool/lock deadlock. |
| Resources | Separate process CPU/heap/external memory from PostgreSQL, filesystem cache and container limits. Include idle and active observations. A lower wall time that causes disproportionate CPU, memory, network or write amplification is a tradeoff to report, not an automatic win. |
| Integration | Fix the common owner so every consumer benefits. Keep feature adapters thin; do not add a private scheduler, cache, loader or alternate renderer to mask a shared problem. Preserve the approved UI. |
| Verification | Reproduce the issue, verify the smallest fix against the same workload, run focused regressions and the relevant integration/build gates. Runtime behavior tests take precedence over source-string assertions. Report untested cases and synthetic/live boundaries. |

### Measurement record

For each finding retain its ID, affected shared owner/consumers, severity, confidence, reproduction, baseline commit/runtime/dataset, raw observations, proposed cost/bound, smallest fix, correctness checks and before/after results. A hypothesis or unmeasured opportunity is not a confirmed defect. Deduplicate findings by root cause and keep all affected consumer references.

Use stable workloads with an untimed warm-up and alternating/repeated before/after samples. Label cold/warm cache, foreground/background load, concurrency and measurement boundaries. Report median plus samples/spread; small-sample p95 is descriptive, not production tail latency. Build size is not page transfer size: check actual entry imports and demand-loaded modules. Avoid averaging away failed operations, hiding provider errors or loosening assertions to make a timing threshold pass.

Measure one resource-intensive workload at a time. Prefer structural budgets and meaningful operation-count assertions over machine-dependent millisecond limits. Use disposable databases/files/providers; restore test services to their initial state and remove task-owned resources. Real-server tests, migrations, deployment and new production dependencies need the applicable user authorization. Never publish credentials, raw private payloads or diagnostic URLs as evidence.

### Shared budgets

Document the existing bound in the owning module and test it at the boundary: current catalogue pages hydrate 60 cards, Shelf social enrichment runs at most two 60-ID requests, visible artwork is sequenced per rail, a chart preview retains one renderer, readers retain one page/view, and imports yield after five committed boundaries or ten seconds at a safe boundary. These are separate budgets, not permission to add them as competing page-wide queues. Inputs exceeding a cap must produce the existing bounded pagination, backpressure or explicit error—not silent truncation.

User-visible operations should not wait on avoidable background work. No provider request or slow external callback should hold a database transaction or lock unless a documented correctness requirement makes it unavoidable. Cancellation must propagate through owned work and cleanup; abandoning a promise is not cancellation. Permission and generation checks remain authoritative across caches and single-flight results.

### State, cache and write contracts

Check never-activated, visible, offscreen, document-hidden, context-replaced and disposed states separately. A memoization owner must name its primitive key, viewer/permission scope, revision sources, finite size/lifetime and explicit retry behavior. Equivalent object replacement is not a content change. Waiting work must still be needed when admitted; a previously intersecting image is not necessarily still visible.

Configuration snapshots are scoped to one HTTP request, expire when it completes and do not flow into background startup. Explicit database/transaction arguments always read through that connection. Authentication, setup, token and permission checks must not become cross-request cached decisions. A committed settings update may replace only its own request's snapshot.

Timers declare their precision, visibility policy and last-consumer cleanup. Static calendar labels must not require second-precision updates; active party heartbeats and intended audio playback have different visibility requirements. Scroll, resize and mutation paths share the same per-owner geometry frame budget, and scheduled callbacks cannot publish after disposal.

Measure unchanged refreshes as well as first imports: identical final rows can hide repeated relationship rewrites, revision churn and WAL. Include permanent job-history growth, per-title child/achievement cardinality and provider mappings/metadata bytes in scale fixtures. Use database plans before selecting indexes; include old account generations and absent lookup values.

Keep one in-flight control writer and coalesce redundant pending snapshots by session while preserving lifecycle event boundaries and final drain. Renderer ownership starts when a URL/worker/image is allocated, not after decode succeeds. Unchanged settled reading locations are no-ops; resize is an explicit render invalidation. Lease waits have cancellation, capped polling cost and a recoverable state after partial destructive effects.

Benchmark probes reuse the production medium/gate/cohort contracts. Changing measured workload semantics requires a workload-version change; code/build changes being compared do not by themselves require a new version. Preview chart fixture bounds do not certify live datasets: a production consumer must define mark/aggregation limits and preserve truthful exact-data access.

### Audit record

The [15 October cross-feature audit](audits/2026-10-15-performance/README.md) retains seven independent reports, a deduplicated implementation ledger and controlled evidence. Confirmed issues, measurement-gated candidates, policy decisions, acceptance gaps and checked nonissues are separate. Previously parked activity-feed restructuring, long-play/native codec acceptance and material redesign do not become approved changes merely because they appear in an audit.

Reference methods: [PostgreSQL EXPLAIN and buffer evidence](https://www.postgresql.org/docs/17/using-explain.html), [combining indexed OR conditions](https://www.postgresql.org/docs/17/indexes-bitmap-scans.html), and [Page Visibility lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API). Browser throttling is not a substitute for explicit ownership and cleanup.

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
| UI reference | Mount only the selected playground editor/example and its scenario; lazy-load chart and material editors and dispose the previous owner on selection changes. Pinning or closing the inspector must not remount the preview or reset drafts. Each specimen owns its finite fixture transport/local playback state; no live provider, account, reader or party commands. Keep format engines demand-only and do not mount operational routes as fixtures. | `src/routes/ui-preview/Workspace.svelte`, `PreviewExample.svelte`, `reference.ts` |

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

Run SvelteKit generation/check and production build sequentially in one checkout. They share generated files; concurrent runs can produce different server/client bootstrap identities. Start browser acceptance only after the final build finishes, and restart any fixture server that loaded an earlier build.

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

Anchored detail rows resolve the next item and its air-date position using lightweight IDs, then hydrate only its sixty-item page. Earlier/later pages use the shared detail source and rail; never fetch all preceding seasons to reach a late episode. Prepending retains the visible card position, and append/loading changes do not reset the rail. The shared source retains its remote page while a segment displays an already loaded finite selection, cancels hidden pending reads and refreshes invalidated data only when needed. Available filters before server pagination; finite selections filter locally. Initial positioning runs once per selected owner/revision, rather than on every scroll or page append.

Fallbacks and artwork source changes reacquire that same rail slot; assigning an unchanged URL is a no-op. Shared progress sources refresh activated shelves only when the content revision or supplied initial payload changes. Metadata readiness and artwork readiness remain independent, and card avatars wait for their artwork to settle.

For You's initial route returns only its hero and next action. Continue uses the shared lazy progress source; section grids skip the home hero query. Hero selection reuses Continue's lightweight page plan and retains saved-history and permitted-Library bounds, then hydrates only the chosen hero. On a disposable PostgreSQL 17.11/Bun 1.4.2 fixture with 1,000 tracked screen works and 100 Library works, one warm-up and five alternating samples measured a `homeData` median of 50.05 ms before and 16.79 ms after. Hero/next-action payloads matched across six priority, permission and history-bound scenarios. These samples exclude HTTP, parent route loads, browser rendering and provider calls, and are not production latency guarantees. Durable cases live in `tests/home-data-db.test.ts`.


### Provider jobs and request scheduling

The common transport admits at most 128 waiting requests per origin and 512 active plus waiting requests overall. Eight per-origin waiting slots and 32 global slots are reserved for bootstrap/interactive work. A local `ProviderQueueBusyError` is retryable capacity pressure, never provider unavailability or a reason to clear live observations. It must not consume a webhook's HTTP delivery budget; cumulative claim attempts remain monotonic for fencing. Idle pacing metadata shares one expiry timer. Do not bypass provider spacing or add another queue when admission is full.

Use `task-timing.ts` for eligibility and due decisions, `job-policy.ts` for work identity and purpose, and the existing durable outbox for claims and recovery. Never add an adapter-private FIFO that hides requests from the common priority transport. An explicit foreground operation can promote an exact shared resource through `providerSingleFlight`; this must not promote unrelated work or duplicate the fetch. Current HTTP arbitration is process-local and retains one request per origin, provider spacing, cooldowns and aging.

Queued traversals use `jobCheckpoint()` only after committing their cursor and effects together, or after an idempotent persisted stage. Workers yield after five committed boundaries or ten seconds at a safe boundary. This is cooperative scheduling, not interruption of an in-flight request or transaction. `JobYield` is control flow: do not catch it as a provider failure or consume retry attempts. Persist large stable responses outside the bounded action payload; Steam uses job-scoped snapshots and Trakt uses staged records. Recommendation jobs retain only their bounded seed selection and completed-set cursor; do not reselect seeds on resume as saving a set changes freshness. Personal publication must check the active job lease inside its guarded transaction, after account locks.

Measure synthetic fixtures separately from live-provider latency. Test resumption without repeated committed effects, changed account generations, local edits, incomplete pages, cooldown preservation and final-negative publication. Raising priority must not bypass authentication, permissions, rate limits or retry backoff. The Queue waiting reason and order should reflect these same execution rules.

### Search

Local screen, game and reading searches retrieve bounded candidates through native PostgreSQL GIN full-text indexes before hydration. Normalize punctuation consistently in query and indexed documents; do not score the entire catalogue in application code. Only an empty direct result permits a second bounded prefix candidate query. Screen metadata aliases stay indexed and user-specific aliases stay owner-scoped; public search does not read them. SQL relevance and document-length normalization apply before the result limit, while the shared pure `search.ts` helper ranks hydrated/streamed results with stable ties.

Keep Search's existing local-first streaming and shared Shelf loading. Provider fallbacks run at most once after a successful empty response, retain only relevant broader matches and never retry a failure or bypass cooldowns. Comic series enrichment is bounded and batched, not a request per issue. Resolve registered reading identities together, without fetching details for every search card. Database tests verify the candidate index plan, ranking before limits and private alias isolation.

### Reading

Books/comics use the same streamed Search, lazy Shelf artwork, bounded hydration, content revisions and provider request lanes. Metadata results do not fan out into per-card detail imports. File readers import only the selected format on open: PDF has its own worker and one page canvas, CBZ/ZIP decodes one image and revokes superseded URLs, CBR/CB7/CBT loads its self-hosted decoder in one disposable worker only on demand, and EPUB retains one paginated view. Native comic archives retain at most 128 MiB compressed input and extract one bounded page at a time, with no extracted-page cache. Terminate their worker on close or supersession to cancel synchronous native work; retry through a new owner. Their decoder operation budget is 30 seconds. Preserve ZIP range reads rather than routing all comic formats through a whole-file decoder. Local file identity hashes in a lazy worker. Archive/file/pixel limits are documented in [Reading](reading.md); cancellation and destruction release renderer resources on close/minimize.

Bookmarks coalesce behind one request at a time and close drains the latest position. State transitions journal once; page turns do not add Activity rows. Reading imports commit per-item durable cursors before cooperative queue yields, including skipped files. Source permission and generation checks remain authoritative even with cached shared mappings. Public progress writes reuse scoped, idempotent transactions and durable webhooks. Validate reader lifecycle and party behavior in disposable browser/database fixtures; distinguish these from live file/provider certification.


### Shared playback delivery

Reuse the existing authenticated playback relay and pinned provider transport. Shared viewers use durable, owner-scoped bandwidth reservations across all links. Reservation transactions perform database work only; Jellyfin preparations/stops run after releasing transaction locks. Preparation ownership uses UUID tokens rather than round-tripped timestamps, since PostgreSQL timestamps retain finer precision than JavaScript Dates. Fence publication and finally cleanup by that token so an expired worker cannot overwrite its replacement.

Signed HLS resource paths remain stable across bitrate-only provider generations. Validate the viewer and share on each resource, then replace only the upstream session/device/bitrate parameters. Keep codecs, dimensions and segment timing fixed, preserve abort signals and never expose provider tokens. Admission/renewal and delivered-position observations coalesce their writes; do not create an outbox job per segment or fetch upstream data per stream card. Active-stream hydration batches by server, uses keyset pagination and excludes duplicated provider device observations. Failed encoder cleanup remains a durable playback-session flag and retries in bounded lifecycle passes.

Use disposable sharing fixtures for concurrent admissions, revoked/expired grants, cross-viewer resource isolation, replaced source accounts, preparation ownership, retryable cleanup and unchanged personal histories. Separately test actual decoding and bitrate transitions with real players; successful segment HTTP responses alone do not prove uninterrupted playback or strict network bandwidth enforcement.


### Ownership and bounded optional work

`createResource.cancel()` ends the current request but leaves its owner reusable; `dispose()` ends the component owner permanently. Component teardown uses `dispose`, so a pending mutation's continuation cannot restart a GET after its panel closes. Capture the current session/renderer/revision in asynchronous playback and reader operations, and fence successes, failures and cleanup; an old failure must not overwrite its successor's error or busy state. Propagate owner AbortSignals through adapter metadata/permission requests as well as the final stream download. Do not substitute a post-await check for cancellation of a queued request.

Catalogue menus enter through `WorkMenu`, retain the shared Button/controller, and use `createMenuResource` over `createResource`. A snapshot belongs to one mounted owner, viewer, canonical/source identity, occurrence, selected playthrough and meaningful content/policy revision. Reopening an unchanged settled owner reuses its snapshot; closing cancels optional reads, while disposal is terminal. Session heartbeat and friend presence updates must not refetch unrelated personal action state. Fence late success and failure against the captured scope even before reactive cancellation runs. This is component-local reuse, not a permission cache.

Root action reads are local. The common Collection projection reads direct relationships, rating, queue and the selected/latest playthrough or reading state in one statement; do not invoke recursive Collection coverage to render those controls. Screen roots omit unconsumed child hydration and saved-list payloads. Lists, listening history and the party track picker use separate owner-scoped pages of sixty, with counts before pagination. Preserve exact list-entry identity and complete choice pagination; a small visible menu is not justification for silently truncating choices.

An acknowledged field patch preserves snapshot completeness: a rating update during a cold/revision-changing read must not turn empty game/reading fields into a settled snapshot. Replace the full single-flight promise when installing an authoritative replacement; stale responses still cannot publish. Private music alias search hydrates at most sixty local candidates and reuses permission-aware work assessments for availability; report the bounded-result notice when that candidate limit is reached.

Unknown provider identities resolve only through an explicit preparation/import or playback command. Play owns its required identity/next-playable read separately from optional menu reads, so dismissing a menu cannot abort playback preparation or make it wait for ratings/lists. Stable medium command owners keep dialogs outside transient menu children. Capture mutation targets before awaiting; preserve selected playthroughs, reading editions and repeated list occurrences. Treat a successful transport write as acknowledged even if route/menu refresh fails: retain success, offer refresh recovery and never invite resubmitting the write as though it failed.

Menu geometry uses synchronous placement followed by a Svelte tick for newly mounted child bounds, then coalesced ResizeObserver frames. Close/dispose releases observers, outside-event subscriptions and frames; closed menus must not schedule geometry work. Compact submenu focus returns after the parent is visible again. Verify cold/warm request counts, late delivery, exact occurrence commands, keyboard/back/focus, narrow viewports and repeated lifecycles in actual rendered controls; request counts alone do not establish retained-heap or live-provider latency improvements.

Media detail provider data follows visible/selected row demand through the existing Shelf activation observer. Share each TMDB/Trakt result among its consumers, retain TMDB crew demand for Credits, and cancel sources when no active row needs them. Do not eagerly fetch both providers for an Activity-only section. Geometry callbacks such as Dialog positioning coalesce per frame after synchronous initial placement and release the captured frame on teardown.

Detail page adapters supply the real Shelf contract to `MediaDetails`; `MediaDetailRows` owns the common Insights/Reviews/Credits rendering, without provider I/O. Full-page and overlay music/game loads share their feature services; the overlay imports only the selected medium's component after its saved data arrives. Close, viewer replacement and disabled/forbidden identities retire stale ownership immediately. An acknowledged edit keeps the open sheet and its scroll position.

`DetailOverlay` uses the shared Dialog's bounded 160px expansion range, one queued animation frame per scroll burst and native proximity snap areas. Read scroll position before writing the expansion CSS variable, release queued work on teardown, and do not add an idle animation loop. A fixed outer track owns expansion; after it reaches 160px, the inner scroller owns ordinary page travel. A scoped wheel handoff forwards remaining travel even when the browser keeps momentum latched to the outer track; preserve nested scroll ownership, horizontal gestures and pinch zoom, and remove the listener on teardown. Never change scroll-dependent content padding or track height: that feeds layout changes back into the scroll measurement. Artwork tint sampling is detail-only (never per shelf card), 32×32 pixels, at most six sequential candidates and a 64-entry colour cache. Replacing/closing the owner removes pending image handlers. Optional root trailers stop under the modal rather than consuming resources behind it.

Edition changes use the existing local media presentation query and shared resource cancellation, not provider requests. Load provider-item metadata only for an explicit edition read; ordinary shelves retain their existing projection. Select from permitted availability, use deterministic source ties, preserve metadata policy/override precedence, and never send raw provider snapshots to the browser. Edition changes update the shared detail model without remounting lazy rows or resetting scroll.

Reading related-title matching uses indexed author/subject overlap, SQL counts/ranking and at most one 60-card hydration page. Never hydrate a whole catalogue or make a provider call per related card. Credits reuse the bounded provider detail cache on demand; authors and provider identities remain canonical. Community aggregates apply separate visibility predicates for actual book/comic ratings and progress, plus enabled-user/feature checks. Comic-volume summaries explicitly count locally known issues, not an assumed complete provider run.


Dynamic For You takes one immutable, definition-only census per visit, with an explicit maximum of 10,000 definitions; overflow returns an error rather than silently dropping rows. The current bottom sentinel reveals one row, waits for it to settle and then observes the new bottom. Card/provider pages and artwork remain lazy. Content revisions refresh row contents independently; viewer or enabled-medium changes discard the census. This avoids rebuilding and re-ranking mutable definitions at each numeric offset, which can skip or replay rows during an ordinary tracking edit. Do not add a server snapshot cache or durable feed table for this contract.

Reader bookmark saves deduplicate only successfully acknowledged equal locations for the same session. An ambiguous failure invalidates that acknowledgement; latest pending positions, explicit retries and the final close drain remain required. Server heartbeat/session timestamps express live presence and resume ordering; identical positions are not a reason to remove the explicit 60-second visible-reader heartbeat.

Optional image persistence has its own memory admission, separate from provider rate/admission lanes and the durable disk budget. Each image cache reserves at most 64 MiB and sixteen pending writes before enqueueing a buffer; saturation declines persistence immediately while the authorized response can still deliver its image. Release reserved credit on success, error and declined disk admission. TMDB retains its four active download bound, shares exact-key work among live consumers and cancels upstream only when its last consumer leaves. A canceled download retains active credit until it actually settles; a late cleanup cannot remove a replacement's map entry.

### Complete bounded projections and cooperative effects

Complete membership is different from a bounded browse page. Hydrate explicit guest/detail IDs in ordered batches without silently limiting a season or episode set. Social card projections return the displayed top three people plus an exact total and resolve presence for those displayed people only. Profile insight endpoints use shared card-free totals/summary projections instead of hydrating backgrounds or favourites they discard. Cursor-free next playback uses the bounded sequence-next projection; explicit sequence cursors preserve their existing complete traversal semantics.

Trakt list reconciliation builds one local alias index while preserving first remote occurrence, mixed media kinds, duplicate identity handling and exact order. Music canonical updates compare meaningful values and relationship inputs; avoid rewriting unchanged album membership or re-projecting it for a mere availability observation. Rich browsing still persists changed metadata and batches personal access observations through the existing account/lease fence.

Seerr scans retain a nullable internal request scan UUID, a constant-size task checkpoint and at most one hundred-record page snapshot. Commit each page's request effects, notifications, marker and cursor together under the account and active-attempt fence; a notification failure rolls the page back. Resume slow metadata pages without refetching or serializing an ever-growing census. Only an individual confirmed 404 can cancel a missing request, and the update must still match the captured external identity and scan marker. A failed/incomplete traversal cannot publish `requestsVerifiedAt`. A stale attempt yields before interpreting its saved page.

Notifications own one shared preference/level decision for both single notices and batches. Administrator broadcasts keyset-page enabled users/settings in batches of one hundred and insert bounded groups with one policy read, preserving complete delivery, social opt-outs, locked/silent behavior and source-key upserts. Transactional callers read policy and persist notices on their supplied connection; they must not open another pool connection while holding locks.


### Feature policy and withdrawn consumers

Feature choices are explicit subjects, not a process-wide actor cache. Request read models may share one config/subject snapshot only for that request; transaction/publication checks and queued provider admission use current policy. Filter admitted categories/cohorts before counts, ranking, pagination and taste construction. A scheduling actor's personal opt-out cannot disable shared work serving other users. Administrator stream inspection remains independent of optional personal presence.

Off must remove optional resource owners, module consumers, timers and observers, rather than fetching empty results behind hidden UI. Use primitive effective-policy keys with existing cancellation/disposal. Withdrawal uses bounded, resumable outbox cleanup (forty users, one hundred resources/jobs per batch); it must not hold a settings transaction over provider I/O, create another scheduler, or flush disabled-period webhook/reminder backlog on reenabling. Operational stop/revocation remains admitted. Preserve imported positive availability when a medium is skipped, and invalidate scan checkpoints when their medium-policy signature changes.

Feature-gated command transactions acquire `coast_lock_feature_policy` before their fresh policy decision: shared configuration advisory lock, then shared subject-row lock. Settings writes use the corresponding exclusive lock in global-first order. Keep the lock and decision in separate statements so a waiter receives a fresh READ COMMITTED snapshot. These are local command transactions only; read projections use non-locking predicates, and provider I/O must not be moved into the locked transaction.

### Row and heading consistency

All Shelf sources share the same header-control partition and rail renderer. Availability uses the existing compact toggle beside ordinary row segments; focused panels place standalone buttons/toggles alongside top-right filters so the sticky footer contains only segments. Changing a header or opening its filter menu must not activate another data source or add a second loader: menu content mounts only on open through the existing Button/menu controller, and selection dispatches to the owning source. Local finite-array selection remains local; paged sources keep server filtering/counts before pagination. Real destination links retain the active selection and use native anchors.

Preserve the existing one-shot Shelf activation, component-local Resource cancellation/latest-response rules, revision scope, bounded hydration/social enrichment, per-rail left-to-right lazy artwork and coalesced geometry teardown. Dynamic rows remain append-only at the actual bottom, one settled row at a time. Verify header order and keyboard/submenu/back/focus on desktop and narrow viewports alongside request counts; do not introduce a separate row scheduler, global artwork queue or eager provider fetch for layout consistency.


### Non-screen detail sections

Music detail routes return only root metadata and a bounded parent lookup. Albums/tracks load through the existing Shelf source/resource lifecycle when their row or selected section is visible. Hydrate one bounded page together with viewer-scoped availability, authorized artwork, credits and private progress; preserve release-entry IDs for repeated tracks. Do not replace missing access with a canonical work UUID. Source-backed music requests and manual reader source searches pass request cancellation to Jellyfin, and cancelled observations cannot grant account access. Music child pages use the shared sixty-item bound and clamp stale page numbers with at most one corrected source read. An unchanged verified reading-file fingerprint reuses its durable identity without an Open Library edition lookup; Jellyfin access, direct identity conflicts and transaction/account fences still apply, and changed files still require metadata validation.

Game detail routes fetch a playthrough summary/count, not its session history. Music and game history use the same lazy resource and bounded paging methods as Reading. A resource owns its request through context changes, close and destruction; an externally cancelled reader preparation must also clear its loading owner and retire a late prepared session. Reference specimens mount feature-owned production detail compositions with finite fake transports, rather than copying simplified route markup or invoking live commands.

### Detail overlay navigation

Eligible detail anchors share one delegated root listener and an explicit route parser. Suppress duplicate full-route tap preload only for the handled event; do not add per-link observers, retain DOM nodes, preload detail modules globally, or intercept core application/action routes. Reuse feature-owned loaders in an internal dispatcher. Opening and replacing content owns one abortable request and lazy component import; keep the current panel until the next destination is ready. Local section/filter/page state must use that destination's URL, rather than the page underneath it.

The native modal owns click/focus isolation and a CSS document scroll lock. Expansion and the retained adaptive hero capability use the existing coalesced scroll frame, not another scroll observer or animation loop. Detail heroes currently remain left-aligned; adaptive alignment is parked. Keep a fixed 160px outer expansion track separate from the inner content scroller. Reverse momentum cannot contract the sheet while inner content remains above its top: pin the outer offset to its expanded limit in that same coalesced frame. Hand upward wheel travel back to the expansion track only after content reaches zero, preserving nested scroll ownership and non-cancelable gesture handling. Section navigation resets only the content scroller; it retains the outer offset and presentation, even for short/empty sections. Focused media sections suppress their detail hero and repeated metadata links in the shared composition. Review sources use the same segment picker as Activity; additional review pages use the existing Shelf end-of-list activation. Keep canonical or provider-scoped identity in section destinations. Linked row views reuse source cancellation, filters and bounded-page append; they must not rewrite the underlying page URL or introduce a second loading scheduler. Plain segmented controls must not mount disabled glass renderers: a disabled renderer can still supply a fallback backdrop. Material variants have exactly one material owner.

The detail friends rail uses the existing lazy detail Shelf with bounded sixty-person pages. Filter visibility and relationships before counts/ranking; omit presence and reaction hydration when only people cards are rendered. Ordinary card heads retain the bounded top-three social projection.

The shared media detail Activity row reuses the For You social source and card presentation. Resolve durable work/artist/reading-group identity in the composition; do not add medium-specific history fetchers. Apply the requested work or verified container membership in `visible_raw`, before grouping and the 61-row cursor lookahead. Keep privacy/category gates and reaction targets unchanged, append on demand, and cancel superseded item requests. Remote previews without a persisted identity do not start an Activity request.

Item Activity relationship segments share `relationshipEdges`/`relationshipReasons` with card-head projections. Restrict reasons to the requested work/container closure before privacy checks and grouping. Represent no-history relationships as undated state cards, not synthetic history records; retain a stable event/state cursor with the existing 61-row lookahead and hydrate only the returned page. Filter changes cancel old reads and make one replacement request; ordinary unscoped For You requests do not activate relationship traversal.
