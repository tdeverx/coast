# Cross-feature performance audit and implementation

Baseline: merged PR #30, `ea01908654db7c0b4cf591028c7f9b321c6896dd`. Work branch: `codex/performance-criteria`. Bun 1.4.3, macOS ARM64; controlled database probes use disposable PostgreSQL 17.11. This is a new audit, not a claim that the October 3 measurements describe the present application.

Seven independent auditors inspected separate ownership areas before production edits. The coordinator reproduced database costs centrally, combined overlapping flags, and strengthened [performance criteria](../../performance.md) before implementation. Heavy fixtures run serially; agents do not compete for a shared test database or change live/dev services.

## Independent reports

| Scope | Report |
| --- | --- |
| Shared frontend, rows, resources and images | [Shared UI](shared-ui.md) |
| Catalogue, Collection, profile, search and read projections | [Data reads](data-reads.md) |
| Queue, scheduling, provider imports and caches | [Jobs and integrations](jobs-integrations.md) |
| Audio/video, parties, reusable stream delivery | [Playback and sharing](playback-sharing.md) |
| Books/comics and PDF/EPUB/CBZ lifecycle | [Readers](readers.md) |
| Platform, authentication, public API and benchmark tool | [Platform/API/benchmarks](platform-api-benchmarks.md) |
| Recommendations, taste, experiments and charts | [Recommendations and experiments](recommendations-experiments.md) |

Reports preserve independent conclusions and measurement limits. The ledger below is authoritative for consolidation and implementation; a report's suggested optimisation is not automatically an established production bottleneck.

## Consolidated ledger

| ID | Priority | Shared owner and required repair | Independent references | State |
| --- | --- | --- | --- | --- |
| PERF-01 | P2 | Key Library/Credits and benchmark polling by current context/revision; cancel stale delivery and make explicit retry fresh. | UI-PERF-01; P-PERF-04 | Implemented; verification below |
| PERF-02 | P2 | Remove queued rail artwork when demand leaves the viewport; preserve active-request sequencing. | UI-PERF-02 | Implemented; verification below |
| PERF-03 | P2 | Coalesce rail and hero scroll geometry per owner/frame; skip hidden hero work and release frames. | UI-PERF-04; PB-PERF-02 | Implemented; verification below |
| PERF-04 | P2 | Use appropriate clock precision and visibility ownership; avoid reformatting static activity dates every second. | UI-PERF-03 | Implemented; verification below |
| PERF-05 | P2 | Read provider artwork mappings only for music, with narrow columns rather than full snapshots. | DR-01 | Implemented; verification below |
| PERF-06 | P2 | Replace per-card full sequence expansion with shared batched summaries/selected-root work, preserving sequence semantics. | DR-02 | Implemented; verification below |
| PERF-07 | P2 | Reuse resolved parent captions and already hydrated profile backgrounds instead of repeating full card hydration. | DR-03 | Implemented; verification below |
| PERF-08 | P2 | Hydrate multi-page identity sets in ordered bounded batches without losing requested cards. | DR-04 | Implemented; verification below |
| PERF-09 | P2 | Avoid rewriting unchanged music album membership at the canonical persistence owner. | PJI-1 | Implemented; verification below |
| PERF-10 | P2 | Index Steam achievement matching locally, batch writes and skip unchanged progress while retaining schema freshness. | PJI-2 | Implemented; verification below |
| PERF-11 | P2 | Read bounded active/latest-success scheduling evidence instead of aggregating permanent history. | PJI-3 | Implemented; measured plans and regression tests |
| PERF-12 | P2/P3 | Bound the common provider queue with urgent capacity and retryable local saturation; expire idle pacing metadata without losing cooldowns. | PJI-4, PJI-5, PJI-6 | Implemented; admission approved by user |
| PERF-13 | P2 | Coalesce consecutive pending playback progress reports while retaining lifecycle order and final accounting. | PB-PERF-01 | Implemented; verification below |
| PERF-14 | P2 | Cancel obsolete request-owned quality preparation/drain without losing recoverable encoder state. | PB-PERF-03 | Implemented; verification below |
| PERF-15 | P2 | Use bounded adaptive lease polling while preserving durable admission, crash expiry and cancellation. | PB-PERF-04 | Implemented; verification below |
| PERF-16 | P2 | Revoke party memberships once, without rewriting already revoked rows every heartbeat. | PB-PERF-05 | Implemented; verification below |
| PERF-17 | P1 | Own pending CBZ image URLs immediately and cancel unresolved decoding; fence stale successes and failures. | READ-PERF-01 | Implemented; verification below |
| PERF-18 | P2 | Skip already-rendered clamped page navigation; retain failed-page retry and forced resize rendering. | READ-PERF-02 | Implemented; verification below |
| PERF-19 | P2 | Reuse request-local settings reads and include request prework in timing; retain fresh transactional/auth checks. | P-PERF-01 | Implemented; verification below |
| PERF-20 | P2 | Verify rotated-token lookup plans, then index the previous hash without changing session authentication. | P-PERF-02 | Index justified by normal plans; implemented |
| PERF-21 | P2 | Make benchmark membership/assessment cohorts follow enabled media and version the changed workload. | P-PERF-03 | Implemented; verification below |
| PERF-22 | P2 | Give webhook listings bounded deterministic paging without dropping retained history or secrets. | P-PERF-05 | Implemented; verification below |
| PERF-23 | P2 | Rank feed definitions through pre-sorted equivalent buckets rather than repeatedly sorting the full remaining pool. | REC-1 | Implemented; verification below |
| PERF-24 | P2 | Compile affinity lookups once per scoring calculation instead of once per candidate. | REC-2 | Implemented; verification below |
| PERF-25 | P2 | Fence taste publication by active job attempt and checkpoint the bounded user census for cooperative yielding. | REC-3 | Implemented; verification below |
| PERF-26 | P2 | Keep a visit's consumed feed definition cursor stable across content revisions; refresh existing row contents independently. | REC-4; UI follow-up observation | Implemented; verification below |
| PERF-27 | Opportunity | Verify/retire the unused internal full-list expansion rather than invent another pagination implementation. | DR-05 | No production consumers found; retained contract, no runtime change |

PERF-03 combines two independently identified geometry paths, PERF-01 records the related resource identity consumers together, and PERF-12 covers common queue admission rather than adding a second private-artwork queue. Reader party-publication observations are checked with playback ownership, not counted twice.

## Baseline evidence

- Shared-card fixture: 72 provider mappings with 32 KiB unused metadata each yield 2,386,657 serialized result bytes for the wide projection versus 2,245 for the necessary 12 music mappings. Removing unused snapshot fields leaves the complete 60-card result identical. These are JSON-serialized driver results, not physical protocol bytes.
- Collection-card fixture: one root performs 19 ORM queries; twelve perform 41, including twelve recursive sequence expansions. This demonstrates a serial per-card work slope; the single local timings are not production latency claims.
- Scheduler fixture: normal plans and exact result comparison are captured at 10,000 and 100,000 retained actions, including current, old and legacy account-generation evidence. Raw plans determine whether an additional successful-generation index is warranted; no planner forcing or permanent-history deletion is used.
- Frontend/provider/playback/reader/recommendation reports contain actual-module or compiled-source operation probes. They explicitly separate mocked boundary counts from browser decoding, database row changes and production CPU/memory claims.
- Production baseline build: 227 JavaScript/CSS assets, 2,957,794 bytes before compression and 951,221 gzip bytes in aggregate. This is the whole build, not initial route transfer or proof that lazy modules are eager.

## Changes excluded without further evidence

The reports do not justify a new rendering architecture, material changes, cross-request authorization caches, higher SQL/provider concurrency, private schedulers, speculative indexes, arbitrary chart data truncation or an activity-feed pagination redesign. The previously parked activity-feed grouping/projection work remains parked. Offset pagination alone does not prove an expensive scan.

Long-play HLS buffer policy, native codec/autoplay/device acceptance, EPUB peak archive memory, pre-decode pixel admission and large live chart inputs need distinct controlled evidence. Tiny synthetic decoders, HTTP 200 responses and RSS snapshots cannot certify those cases or establish an OOM/leak. Existing chart fixture bounds and one-renderer policy, provider body backpressure, reader hashing, request cancellation and shared SQL pool lifetime were checked as positive patterns, not reported as defects.

## Verification and completion

The 26 confirmed findings are implemented through their shared owners. PERF-27 is a checked opportunity rather than a demonstrated production cost: the unused internal full-list expansion has no production client consumer, so its contract is retained rather than silently truncated. Verification below distinguishes executed checks from broader acceptance gaps. The coordinator owns serial disposable DB runs, production build/type/inventory checks and rendered frontend acceptance. The user subsequently authorized opening/pushing a PR after the follow-up audit and final checks. No deployment or dev/live migration is included.


## Implemented cost and lifecycle changes

| Workload | Baseline | Working-tree result | Evidence boundary |
| --- | --- | --- | --- |
| One / twelve Collection cards | 19 / 41 ORM queries | 19 / 19 | Same generated PostgreSQL fixture; equivalent summaries; not route latency. |
| Mapping fixture with 60 screen + 12 music mappings | 72 wide rows, 2,386,657 JSON bytes | 12 narrow music rows, 2,245 bytes | Serialized driver results, not physical network transfer. Production projection is also guarded in `card-hydration-db`. |
| Unchanged twenty-track music membership | 400 DELETE + 400 INSERT effects in instrumented transaction | Zero relationship changes | Real DB regression additionally checks unchanged tuple versions and changed positions. |
| One hundred scroll events | 300 synchronous rail geometry reads | Two after one frame | Compiled actual shared owner; hero separately performs one read per frame. |
| 18,000 old-date labels | Median 275.32 ms | Median 9.07 ms | Five pure-JS samples each; fixed labels, formatter reuse only; no FPS/production CPU claim. Cards also use minute precision. |
| Sixty queued progress snapshots plus stop | 61 deliveries | First + latest + stop (3) | Actual report owner with held delivery; lifecycle/session boundaries and final listening accounting preserved. |
| Shared dispatch saturated one second | 65 SQL statements / 21 transactions | 23 / 7; admission at virtual 1,100 ms | Actual source with synthetic database/time boundary. |
| Crashed request lease retained 35 seconds | 1,402 SQL statements | 286; completion at virtual 35,100 ms | Same expiry/deadline; capped 250 ms polling delay, not provider throughput. |
| 1,000 weighted row definitions | 14,172,304 category reads | 40,958 | Actual pure ranking; exact seeded-order oracle including ties. |
| 500 taste candidates, twelve 500-entry affinity dimensions | 3,000,000 affinity identity reads | 6,000 | Compile lookups once per calculation; scores/reasons remain equivalent. |
| Valid/rotated/absent session hash, 10,000 sessions | Sequential scan; 220–221 shared buffer hits | Bitmap OR indexes; 5–7 hits | Normal PostgreSQL planner; all returned identities identical. |

Provider admission is **128 waiting requests per origin** and **512 active plus waiting requests overall**, reserving eight waiting slots per origin and 32 overall for bootstrap/interactive work. This is a conservative global bound, stronger than bounding waiting work alone. It preserves per-origin serialization, pacing, promotion and aging. Local saturation has its own retryable diagnostic code and cannot clear live observations, mark a provider unavailable or consume webhook HTTP delivery attempts. Idle paced origins share one cleanup timer.

The scheduler retains permanent history and selects active work plus the latest eligible success. Its generated partial index covers connection/kind/account-generation/time; the legacy NULL-generation lookup explicitly retains the index's ordering as well. Both current and legacy seeks use that index under normal planning. The 10k/100k mixed-generation fixture returns equivalent results; normal 100k retained-history buffer work falls from 197,065 hits to 751 with the generated index. A separately added duplicate probe index is reported independently and is **not** the shipped index or a claimed production result.

Reader changes own displayed and pending CBZ resources separately, release URLs even during an unresolved decode, reject/cancel stale work and avoid settled-page redecodes. PDF page caches invalidate when rasterization clears the canvas, so failed replacement or resize can retry the previous page. The second review caught that failure interleaving and the webhook retry-budget interaction before completion; both have regression coverage.

Config reuse is HTTP-request-local, cleared when the request ends and excluded from background startup. Explicit SQL/Drizzle transaction reads, authentication, setup and token checks remain fresh. Benchmark Collection/assessment cohorts share enabled-medium policy; the changed workload is `coast-local-v2`. Public webhook history uses the established 60-item paging contract, preserving all retained subscriptions and excluding secrets.

## Evidence files and repeatability

[Evidence directory](evidence/) retains generated-data before/after results, normal session query plans, mixed-generation scheduler plan summaries and raw shared-UI samples. After files retain the baseline commit field from the probe harness; they were executed on the implementation working tree, not that baseline's unchanged source. The PR diff identifies the resulting implementation. Fixtures contain generated identities only. No live credentials, URLs, personal payloads or operator logs are included.

Meaningful regressions live beside existing tests: card hydration and sequence summaries; music/Steam unchanged tuples and batching; request admission and webhook retry credit; reader cancellation/failed raster retry; playback report/lease/hero lifecycle; UI source freshness/image demand/clock/geometry; request-config, benchmark polling/cohorts and public paging; feed ranking/cursor and taste lease/checkpoint resumption. Run them with the existing `bun test tests` and `bun scripts/test-database.ts` workflows rather than introducing another test runner. Database suites create/drop their own databases and apply the generated migration there.


### First-pass verification (before fresh consistency follow-up)

- Bun 1.4.3 unit/runtime suite: **490 passed, 611 guarded skips, zero failures**, 197 files. Skips are not counted as passes.
- Complete serial disposable PostgreSQL suite: **560 passed, zero failures**, 78 independently migrated databases. New config-transaction, benchmark-medium, webhook-paging/retry-credit, collection/card, Steam/music tuple, taste checkpoint and sharing membership cases executed.
- Svelte/TypeScript: **zero errors, zero warnings**. Production build, code inventory, UI inventory, adopted source style and `git diff --check` passed.
- The in-app browser exercised production-compiled actual Shelf/MediaCard/source and BenchmarkSettings components with synthetic artwork/transport: horizontal navigation, deferred below-fold artwork, activated revision refresh, and page-two replacement during a delayed page-one poll. Browser console checks were clean. Compiled-runtime tests additionally settle stale responses after disposal, simulate document visibility and count exact geometry/timer operations.
- This is focused component acceptance, not full authenticated-route, live-player, real-provider or cross-browser certification. The in-app surface reported a 426×266 CSS viewport despite a temporary requested desktop override; that override was reset. Do not label these observations as 1280px desktop acceptance or production FPS/heap evidence. The temporary fixture uses synthetic data and makes no application/database/provider calls.

The user requested another independent, cross-feature consistency sweep after these gates. Its reports and any further repairs are recorded separately below; the first pass is not treated as proof that no other issues exist.


## Fresh consistency follow-up

The following independent reports apply the strengthened criteria across recent and unchanged consumers: [Shared UI](follow-up/ui.md), [read projections](follow-up/queries.md), [integrations and jobs](follow-up/integrations.md). Further independent reports cover [playback](follow-up/playback.md), [reading](follow-up/reading.md), [platform/API/storage](follow-up/platform.md) and [discovery/charts](follow-up/discovery.md). A [final correctness review](follow-up/final-review.md) additionally checked the repaired shared owners. The independent reports retain discovery-time evidence; this ledger records accepted repairs.

| ID | Owner and additional repair | Independent reference | State |
| --- | --- | --- | --- |
| PERF-03 extension | Frame-coalesce captured Dialog popover placement, keeping initial placement synchronous and teardown fenced. | UIF-03 | Implemented; final verification below |
| PERF-04 extension | Use conditional minute precision for Streams History, retaining party second clocks. | UI residual | Implemented; final verification below |
| PERF-06 extension | Reuse bounded next-entry projection for cursor-free next playback, not full sequence transfer. | Query follow-up 1 | Implemented; final verification below |
| PERF-09 extension | Avoid unchanged canonical music/edition/artist writes and repeated unchanged album projection; retain rich metadata changes and fresh personal access. | INT-F3 | Implemented; final verification below |
| PERF-28 | Terminal resource disposal prevents new GET work after a closed panel's pending mutation finishes; cancel stays reusable. | UIF-01 | Implemented; final verification below |
| PERF-29 | Fetch only detail provider sources demanded by the active/visible rows, preserving TMDB crew and shared result reuse. | UIF-02 | Implemented; final verification below |
| PERF-30 | Abort trailer lookup when its optional hero owner is replaced/disposed. | UIF-04 | Implemented; final verification below |
| PERF-31 | Return at most three friends/work plus exact total; resolve presence only for those displayed. | Query follow-up 2 | Implemented; final verification below |
| PERF-32 | Use shared card-free profile insight projections rather than hydrating favourites/backgrounds discarded by the endpoint. | Query follow-up 3 | Implemented; final verification below |
| PERF-33 | Index Trakt list alias matching while preserving first-remote-match and exact mixed-kind ordering. | INT-F2 | Implemented; final verification below |
| PERF-34 | Make Seerr traversal cooperate at durable page boundaries without per-request lookups or growing-census snapshot rewrites. | INT-F1 | Scan field approved; implemented [plan](follow-up/seerr-checkpoint-plan.md) |
| PERF-35 | Guest explicit detail membership follows the existing complete-membership contract through bounded hydration batches; default public browse stays bounded. | Query contract gap | Implemented; final verification below |

These extend existing flags when the root cause/shared owner is the same rather than counting each consumer as a new issue. A cost reduction cannot come from dropping guest members, exact friend totals, rich metadata updates, cancellation confirmations or required background lifecycle events.


| Additional ID | Owner and repair | Independent reference | State |
| --- | --- | --- | --- |
| PERF-13 extension | Fence reusable share route polls/preparation/authority release by its lifetime; captured final reports retain their authority. | PB-F01 | Implemented |
| PERF-14 extension | Carry preparation cancellation through Jellyfin identity/PlaybackInfo and reading permission metadata to the shared request queue. | PB-F02; READ-F3 | Implemented |
| PERF-17 extension | Fence navigator, manual turn and follower rollback success/error/finally by renderer/session; release replaced busy state. | READ-F1; final correctness review | Implemented |
| PERF-26 extension | Retain one bounded immutable definition-only census per visit; reveal one lazy row at the existing bottom/settlement gate. | Discovery cursor probe | Implemented |
| PERF-36 | Deduplicate acknowledged reader bookmarks only; preserve failed-response recovery, latest drain and explicit heartbeat. | READ-F2 | Implemented |
| PERF-37 | Batch shared notification preference/insert work; keyset-page broadcasts and support supplied transactions. | PF-F1; Seerr commit review | Implemented |
| PERF-38 | Bound optional cache-write buffers before the disk tail; decline persistence while delivering authorized artwork. | PF-F2 | Implemented |
| PERF-39 | Cancel TMDB artwork per consumer, abort upstream only after the last consumer leaves, retain active capacity until settlement. | PF-F3 | Implemented |
| PERF-40 | Clear For You data on viewer/fixed-row/experiment withdrawal and denied access, preserving same-owner transient retry. | Discovery scope probe | Implemented |
| PERF-41 | Aggregate long all-time activity directly by years and observed dates, preserving quiet-year boundaries and exact totals. | Discovery bucket probe | Implemented |

The follow-up found two further Seerr correctness edges while running its new database cases: an expired attempt must yield before interpreting a saved page, and a confirmed missing external request must not cancel an interactively replaced identity. Both now retain the same account/lease and captured-request fences. Page status changes, notifications and cursor persistence share one transaction; failure-injection proves rollback and replay rather than losing notices after a checkpoint.

The final read-only review found no additional confirmed issue in its assigned queue/scheduler/sequence/music/Steam/taste/sharing paths. It did reproduce a late PDF turn/follower failure overwriting a replacement reader's error/busy state, which was fixed through the same reader owner fence and compiled actual-component regressions. That review ran 47 focused tests with zero failures; it did not run a database, browser or live provider.

### Follow-up evidence boundaries

The evidence directory also retains discovery-time UI/query/integration/playback/platform probes. These are synthetic actual-function or compiled-component operation counts, not production latency, CPU, heap or codec measurements. Reports retain the original failure description and append implemented behavior; final verification below supersedes discovery-time guarded test skips. The main performance guide documents the resulting ownership, admission, projection and checkpoint contracts.

- Trakt alias matching at 100/1,000 entries falls from 40,400/4,004,000 identity reads to 800/8,000 while preserving exact ordering/first-match behavior. Remote identity exports remain required; this is not a claim of zero per-entry provider identity work.
- Repeated rich music pages at 20/100 tracks fall from 340/1,700 instrumented statements to 203/1,003, with no unchanged relationship mutations, no unchanged artist updates and one access batch. Canonical upserts still issue value-guarded SQL; actual database tuple versions separately protect the no-op claim.
- Seerr checkpoints remain constant-size; a slow page retains at most 100 records. Six hundred already-known requests yield after five page boundaries, resume at the next page and preserve visible timestamps for unchanged states. One individually confirmed 404 is still required before cancellation.
- A visit's dynamic definition response is prepared once (maximum 10,000 definitions, explicit overflow error), rather than regenerated after each one-row reveal. This retains the accepted lazy card/row loading and avoids offset drift after a tracking change. The bound is definitions, not eagerly loaded cards.
- Reader queued preparation/file permission cancellation removes the obsolete queue entry immediately; synthetic transport sees no abandoned metadata call or download. Bookmarks still send changed locations, retry ambiguous failures and heartbeat while visible.


### Final rendered acceptance

The in-app browser exercised production-compiled actual DynamicFeed, Shelf/MediaCard and Dialog against a loopback-only synthetic fixture. Initial offscreen feed made zero census/card requests. Reaching the bottom produced one census and row 1; successive new-bottom visits appended rows 2 and 3 in order, with one census and three card-page requests. A content revision retained the visit’s identities; opening/closing the actual Dialog restored the feed. No relevant browser console errors/warnings were recorded. The surface was 426×240 CSS pixels; this is focused component acceptance, not a full authenticated route, desktop/cross-browser certification, real-provider playback or FPS/heap profile. The temporary tab/server were closed; no dev/live service was changed.

Whole-build client output remains 227 JS/CSS assets: 2,964,271 raw bytes and 953,672 gzip bytes versus baseline 2,957,794 and 951,221. That is an aggregate increase of 6,477 raw / 2,451 compressed bytes for the additional ownership/admission logic, not an initial-route transfer measurement. Lazy renderer boundaries remain intact. Raw aggregate summaries are retained beside the other evidence.


### Final verification after all follow-up repairs

- Bun 1.4.3 full unit/runtime suite: **543 passed, 625 guarded skips, zero failures**, 213 files and 31,726 assertions. Guarded database tests are executed separately, not counted as unit passes.
- Complete serial disposable PostgreSQL 17.11 suite: **574 passed, zero failures**, 80 freshly migrated test databases. This includes real JSON fidelity/transaction rollback, all six Seerr checkpoint/cancellation cases, complete guest membership, profile/social projections, playback cancellation, reading, provider imports and webhook budgets. Each database is dropped; the test container is returned to its original stopped state.
- Svelte/TypeScript: **zero errors, zero warnings**. Production build, code inventory (482 production modules; no unused modules), UI inventory (63 components), adopted source style (7 modules) and final diff checks passed.
- Focused rendered acceptance and whole-build asset evidence are recorded above. No dependency, material, licence, deployment, live/dev database or existing service change was made.

The initial follow-up database run caught a notification JSONB binding regression introduced during batching: pre-encoding a native JSON value made Bun SQL store a JSON string. The helper was corrected to pass native objects/null, the synthetic boundary was corrected so it could no longer mask this behavior, and both targeted real-database and complete database suites passed afterward. A stale Seerr attempt and transactional-notification failure interleaving were likewise repaired and verified before final completion. Discovery-time reports and first-run failures are not presented as final green results.
