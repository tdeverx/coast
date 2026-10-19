# Data, API and domain audit

Date: 17 October 2026. Source baseline: `eb0673873462b71118d1c11678d128958a05ff07`; individual source hashes are retained in `data-api-coverage.json`. This report is an audit and implementation-options document. No application implementation was changed. The coordinator owns actual-installation capture, database cloning, serial integration checks and the consolidated report.

## What the evidence does and does not establish

Source was independently reviewed against the current implementation, with earlier audits used as context. A source-confirmed operation count, allocation or lock order is useful evidence, but is not a measured production latency, retained-memory leak, pool starvation or OOM. Runtime probes prepared for the coordinator operate on an actual-data disposable clone; no fabricated catalogue or user histories were proposed as performance verification. Every reported runtime number must identify that clone and its exact measurement boundary. Existing automated regression suites are correctness evidence, with their original fixtures disclosed separately.

The scope includes auth/configuration, database schema and revision triggers, all server query modules, browser API dispatch families, public API, application/domain operations, Collection, catalogue persistence, games, social/presence/taste, recommendations and Planning. Reading/music/playback/provider implementations have separate deep audits; this report follows their API and shared-data boundaries. Coverage JSON distinguishes a full owner/control-flow read from a dependency-boundary inspection and records unverified runtime dimensions. It deliberately does not claim that reading a file proves every possible data value, failure schedule or SQL plan.

## Actual-data measurements

The coordinator cloned the real development installation into an isolated PostgreSQL 17.11 database and ran current-source local functions using Bun 1.4.3. This is real persisted data: 147,946 works and 26,105 tracking rows for the selected owner. Each read has one untimed warm-up and three timed samples. Values below are medians; raw samples and sanitized plans are retained in `evidence/data-api-real-reads.json`, instrumentation version 2.

| Actual workload | Median | ORM statements | ORM driver rows | JSON bytes / result size |
| --- | --- | --- | --- | --- |
| Shared screen card page | 193.65 ms | 22 | 603 | 189,835 bytes / 60 cards |
| Personal Collection first page | 2,657.54 ms | 23 | 940 | 234,263 bytes / 60 cards, 12,010 total |
| Continue first page | 488.73 ms | 27 | 43,200 | 214,939 bytes / 60 cards, 97 total |
| Feed definition census | 1,151.91 ms | 0* | 0* | 63,551 bytes / 350 definitions |
| Notification inbox | 2,273.25 ms | 43 | 33 | 75,514 bytes / 3 visible notices |
| Largest existing season details | 1,975.81 ms | 264 | 5,910 | 1,490,119 bytes / 829 episodes |
| Largest existing collection details | 217.10 ms | 78 | 328 | 78,135 bytes / 23 members |

*ORM counts cover root and transaction sessions, but omit direct Bun SQL; zero does not mean zero database work. Driver-row counts count returned outer rows, not tuples processed inside PostgreSQL. Timings exclude HTTP transfer/browser rendering, use a warm clone, and are three-sample observations, not production p95 guarantees. CPU/memory deltas are process-wide observations and are not retained-heap/leak evidence. The selected owner has no lists and no pending received recommendations; those empty-feature timings are recorded but do not verify loaded fan-out. The complete real table census is coordinator-owned.

**Planner-setting boundary:** the separate six-plan probe uniformly applied `jit=off`, `recursive_worktable_factor=0.01` and a 30-second statement timeout. The primary Collection and inbox assessment plans match their production owner: both run through `collectionRead` (`src/lib/collection/query.server.ts:45-48`), which explicitly sets the same JIT and recursive factor. All application connections already disable JIT (`src/lib/server/db/index.ts:39`). Continue's episode query instead uses ordinary `getDb()` builders (`src/lib/server/queries/continuations.ts:83-114`) and does not set that recursive factor; its normal inherited factor was not separately recorded. Its captured EXPLAIN, and the secondary card/enrichment statements captured outside `collectionRead`, therefore have an explicit probe override whose equivalence to their ordinary planner environment is unverified. Treat those plans as exploratory observations, not normal-runtime plan/timing evidence. The timed production-function samples in the table ran before the plan wrapper and remain valid with each owner's existing settings.

## Executive assessment

The measured shared assessment query performs over 1.22 million repeated tracking-state lookups even for a one-work inbox assessment. Other strong newly identified structural problems are an inverted lock order between public API writes and ordinary tracking, repeated complete sequence expansion inside each item of a bulk collection operation, and per-item list updates while holding an account-wide mutation lock. These can affect stability as well as elapsed time. Large detail reads and Continue selection still have work proportional to complete child/history evidence despite small visible outputs. The shared `workCards` primitive has useful page batching, but a bounded batch does not remove unnecessary medium-specific reads or overlapping hydration by callers.

Several expensive-looking paths now have the earlier repairs: next-sequence selection without a cursor returns one entry; social card heads return at most three authorized details per work before presence resolution; insight period changes use card-free profile summaries; taste compiles a scorer once per medium, fences publication with the active job lease and persists its ten-user census; feed definitions are requested as one census and the ranker uses category/surface buckets. Those are current defenses, not open findings.

## Prioritized findings and implementation choices

### DATA-01 — P1: public API writes can deadlock with ordinary tracking through inverted owner locks

**Status:** reproduced against an actual persisted user row on the disposable real-data clone: one transaction completed and the other failed with PostgreSQL `40P01` after 1,011 ms. Evidence: `evidence/data-api-real-locks.json`. This is a source-shaped lock graph; an end-to-end API race remains a separate acceptance requirement.

**References:** `src/lib/server/public-api/mutations.server.ts:40-43`; `src/lib/core/tracking/service.server.ts:493-509`; `src/lib/server/features.ts:35-40`; `drizzle/0058_feature_controls.sql:4-9`.

`publicMutation` takes the account advisory lock, then selects `api_tokens JOIN users ... FOR UPDATE` without restricting the lock to the token table. PostgreSQL therefore also requests an exclusive row lock on the joined user. Ordinary tracking does the reverse: `requireWorkFeature` calls `coast_lock_feature_policy`, taking a shared lock on that user's row, then requests the same account advisory lock. A valid schedule is:

1. Browser tracking holds the user row `FOR SHARE`.
2. Public API mutation holds the account advisory lock.
3. Browser tracking waits for that advisory lock.
4. Public API waits for the user row `FOR UPDATE`.

One transaction must be aborted as a deadlock victim. This is not an argument to remove feature, token or disabled-user checks.

**Smallest option:** restrict the public token row lock with `.for('update', { of: apiTokens })`, preserving the authoritative joined predicate and transaction. Verify token revocation/expiry/disabled-user races before accepting this as sufficient. **Systemic option:** document and apply one lock order across policy locks, user rows, account advisory locks, token rows and domain rows. This takes more review but protects future feature additions. Blind transaction retries conceal the inversion and can repeat work; they are a resilience supplement only after ordering is corrected.

**Verification executed:** `/private/tmp/coast-data-api-lock-probe.ts` uses an actual persisted user row and the production lock orders, with a four-second lock timeout and no data mutation. The API token join is reduced to its relevant users-row lock so installations with no tokens remain testable. Its result is explicitly a lock-graph reproduction, not a full HTTP test.

**Acceptance:** on a clone of actual data, orchestrate the real tracking and real `publicMutation` boundaries in both orders; both must complete with equivalent state and no `40P01`. Repeat alongside password change, token revocation, feature withdrawal and account disable; prohibited commands must still fail. Assert no account/user lock cycle, rather than adding a host-specific latency threshold. Verify ordinary browser writes, public relationships/ratings/game/reading writes, idempotent replay and failed-operation rollback.

### DATA-02 — P1: sequence-context tracking repeatedly expands the complete sequence; bulk collection completion is quadratic in transferred sequence rows

**Status:** verified with the actual core writer against existing catalogue collections on the real-data clone, rolling back every operation. Evidence: `evidence/data-api-real-bulk.json`, instrumentation version 2.

**References:** `src/lib/core/tracking/service.server.ts:174-180`, `:607-640`; `src/lib/core/lists/sequence.server.ts:103-112`.

`bulkTrackInTransaction` computes collection sequence entries, then supplies the selected incomplete-entry context where present to `applyChange`. For every contextual target, `applyChange` calls `sequenceEntries` again and finds a single entry in that complete array. `sequenceEntries` does one source-validation query and one complete ordered expansion. With N leaves and M contextual targets, this adds M complete N-entry expansions. In a previously uncompleted collection M equals N, transferring approximately N² leaf observations on top of the necessary per-leaf state/event changes. A contextual progress update with `source=coast` also re-expands the complete playlist to verify one entry on every admitted update. The validation branch is conditional on that source; automatic playback/import callers require independent tracing before attributing this cost to their cadence.

The actual collections with 2 / 8 / 23 leaves produced 3 / 9 / 23 full expansions and 36 / 90 / 221 ORM statements, respectively; the last collection changed 22 leaves. Corresponding single samples were 72.63 / 111.56 / 260.43 ms, including the deliberate transaction rollback. These operation counts establish the repeated work on real data; the three different collections are not interchangeable controlled latency samples.

This repeats inside the account advisory transaction, so unrelated writes from the same owner wait behind the avoidable work. The existing bounded `nextSequenceEntries` repair does not apply to this mutation validation consumer.

**Smallest option:** within bulk tracking, validate the immutable source/selected entry census once in the existing transaction, then pass a transaction-local validated entry to the private apply function. Keep the validation capability private; never let a client declare that its context was validated. Define and preserve membership validity for the transaction (using the existing source/isolation/fencing contract); a cached census must not silently permit a concurrently withdrawn entry that the current validator would reject. **Shared option:** add an exact selected-entry read to the existing sequence owner, preserving full source/entry ID/descendant semantics and rewatch/event boundaries. Use it for ordinary one-entry progress/watch updates; it must verify the complete path rather than merely match a leaf UUID. No independent sequence cache is needed.

**Acceptance:** use real existing collections/playlists from a clone, including repeated entries, nested collections/show roots, dropped ancestors, rewatches and source replacement. Complete normalized state/events must match the original algorithm; a bulk operation should consume one selected census, not one full census per leaf. Unknown or stale entry paths must still fail atomically. Capture source validation count, expansion count, returned sequence rows, SQL count, total transaction time and lock duration. Do not count N necessary event inserts as an avoidable defect. `/private/tmp/coast-data-api-bulk-probe.ts` runs the actual core function on existing collections and rolls back every mutation, with no exports or providers.

### DATA-03 — P2: list removal and reorder issue one update for every member under an owner-wide lock

**Status:** source-confirmed; actual-list operation measurement pending.

**References:** `src/lib/core/lists/service.server.ts:180-202`, `:217-249`; browser entry `src/lib/server/api/lists.server.ts:37-47`.

Removal deletes the requested entry, reads every remaining row, then runs one `UPDATE` per row to reassign positions. Removing an already absent entry still rewrites all surviving positions, updates list time and queues projection/export work. Reorder permits 10,000 IDs, validates an exact permutation, then writes every position individually, including unchanged positions. Both hold `hash(userId)` for the whole transaction. Bound: approximately N update round trips plus full-row list materialization; 10,000 is the explicit reorder input bound, not a measured installation size.

**Smallest option:** return immediately when `DELETE ... RETURNING` finds no row. For an actual removal, use one set-based `UPDATE ... FROM` with `row_number()` or decrement only positions after the removed item where the current contiguous-order invariant holds. For exact reorder, use `unnest(ids) WITH ORDINALITY` and update only changed positions. Keep exact permutation validation and the existing list/user locks. **Larger option:** sparse/fractional position keys avoid many position writes but introduce key maintenance and concurrency complexity; they are unnecessary before measuring the simpler set-based repair.

**Acceptance:** actual cloned ordinary lists and playlists, repeated titles represented by entry IDs, first/middle/last/absent removal, same/reversed/permuted order, concurrent move/add/delete and cross-page neighbours. Preserve exact sequence order, membership, IDs, timestamps and export intent semantics. Assert O(1) update statements per operation and zero mutation/outbox/revision change for an absent remove or identical reorder where semantics allow a no-op. Measure row writes/WAL separately from round-trip reduction.

### DATA-04 — P2: initial screen details materialize complete child and overlapping parent-collection cards

**Status:** measured on actual data: the largest existing season returned all 829 episodes, 1,490,119 JSON bytes and 5,910 ORM driver rows through 264 ORM statements, with a 1,975.81 ms median. Root browser evidence independently found 29,157 DOM nodes / 6.93 MB HTML for that real season. UI owner determines which arrays are needed immediately. Evidence: `evidence/data-api-real-reads.json` and coordinator browser record.

**References:** `src/lib/server/queries/media.ts:642-791`; `src/lib/application/work-details.server.ts:20`; `src/lib/application/media-details.server.ts:10-23`; `src/lib/server/api/media.server.ts:24-42`.

A season detail load enumerates every episode and hydrates them all in batches. A collection detail load enumerates and hydrates its complete sequence. For each parent collection, `detailsData` independently expands and hydrates the complete sequence, using `Promise.all` across all parents; shared leaves are hydrated repeatedly. Batching at 60 bounds individual metadata reads, but aggregate work, response bytes and concurrent parent branches scale with the complete memberships. `loadMediaDetails` may repeat the entire read after own-title or parent enrichment.

**Option A:** preserve complete response semantics initially, collect the union of requested leaf IDs once, hydrate once, and remap each independent sequence/repeated entry. This reduces duplication without changing the approved UI. **Option B:** move each child/collection detail row to its existing on-demand paged source, leaving only header/summary/next selection in the initial detail response. This needs a clear replacement completeness/pagination contract, including all members and repeated entries; silent truncation is unacceptable. First verify actual UI demand so useful visible content is not withheld.

**Acceptance:** compare normalized complete initial and paged results on actual largest seasons/collections and titles in multiple collections; preserve season ordering, repeated entry identity, membership, next item, availability and rewatch state. Record initial response bytes, card identities hydrated (including duplicates), SQL statements, peak process memory and number of active branches. Closing/replacing a detail panel must prevent stale publication; DB cancellation behavior remains a separate gap.

### DATA-05 — P2: Continue and the initial home hero still plan from the owner's complete screen state and descendant sets

**Status:** actual-data clone measured 43,200 ORM driver rows for a 60-card Continue response (97 total results), 488.73 ms median and 27 ORM statements through the unmodified production functions. A separate exploratory EXPLAIN of its episode-planning statement returned 16,590 rows with 681,769 shared hits and 663.183 ms execution **under the probe's forced `recursive_worktable_factor=0.01`**. That setting is not applied by this production query owner, and its normal inherited value was not recorded; the plan's node work, buffers and elapsed time are not established as its ordinary runtime plan. Earlier audits already parked semantic restructuring; the production-function row transfer and timing independently renew that evidence. Source: `evidence/data-api-real-reads.json`.

**References:** `src/lib/server/queries/progress.ts:157-271`; `src/lib/server/queries/continuations.ts:67-156`; `src/lib/server/queries/home.ts:12-19`.

`screenProgressPlan` reads all owner screen tracking rows. `continuationIds` then returns eligible shows' episode observations, collection identities and started playlists before selecting next entries. Candidate IDs and availability/order checks are materialized before the final 60-ID slice. `continueHeroId` invokes this full planner to select one initial hero, so lazy shelves do not remove that route cost. Work grows with owner rows, episodes in relevant shows, collections and playlist sources; the public output bound is not a preparation bound.

**Smallest options:** reuse one request-local exact plan if a request needs both hero and Continue; move plainly ineligible stored states into SQL while retaining all continuation evidence; return only the selected candidate/summary from PostgreSQL where equivalence can be proven. **Structural option:** maintain a durable continuation projection through the existing mutation/import owners. That requires membership/release-date/rewatch/privacy invalidation and rebuild/recovery support, so choose it only after actual plans show the remaining cost warrants it.

**Acceptance:** large real owners, regular/special episodes, unfinished current season, untouched next season, unavailable next season, dropped parents, rewatches, playlists, saved parent deduplication and cross-profile privacy. Compare complete IDs/order/count/next context with the present oracle, not just the first card. Record full owner/child rows transferred and representative SQL plans under the owner's actual inherited/local settings; record those settings explicitly rather than applying Collection's override to another owner.

### DATA-06 — P2: received-recommendation progress fetches all candidates and assesses all candidates before paging

**Status:** source-confirmed preparation/transfer slope; actual installation may have few pending recommendations.

**References:** `src/lib/server/queries/progress.ts:297-325`; `src/lib/collection/query.server.ts:237-240`.

The received-recommendations branch aggregates every pending work and every sender/name/notification identity, transfers the full relation, optionally calls `workAssessments` with every candidate ID, filters in JavaScript, then slices 60 items. Pending recommendations have no total-per-recipient cap. `workAssessments` does not chunk its ID list, so this caller can produce large statements and recursive evidence sets. It is distinct from the social recommendation list endpoint's 61-row output and from provider recommendation scoring's 2,000-candidate bound.

**Smallest option:** compute authorization, availability eligibility, per-work grouping, total and page IDs together in the shared PostgreSQL read, then hydrate only the returned page. Sender names and recommendation IDs need be transferred only for page works. Use existing Collection assessment/visibility semantics; do not prematurely limit senders or roots and alter totals. **Alternative:** durable recipient/work aggregates if actual fan-out justifies their mutation/invalidation maintenance; ordinary SQL paging is simpler first.

**Acceptance:** actual pending data plus every available real boundary case, all/available scope, duplicate senders/work, removed friends, disabled categories and absent sources. Exact IDs/order/totals/names/recommendation IDs must match. Measure both all-pending count and visible-page count; zero pending recommendations is a coverage gap, not proof of scalability.

### DATA-07 — P2/P3: several unchanged operations still perform physical updates, timestamps and downstream work

**Status:** confirmed source behavior; expected economic value differs by call cadence and actual data. No global claim that all unchanged writes bump revisions.

**References:** screen persistence `src/lib/catalogue/service.server.ts:222,264`; games `src/lib/core/games/service.server.ts:116-132,193-215`; list metadata `src/lib/core/lists/service.server.ts:65-80`; up-next `src/lib/core/lists/up-next.server.ts:15-26`; reading file observations `src/lib/catalogue/reading-files.server.ts:58-62`; profile metadata `src/lib/core/profile/service.server.ts:128-134`.

Screen metadata always updates a matching snapshot's timestamp and supplied values. Game metadata always updates the game and feature rows, and game `updatePlaythrough` always updates/queues collection projection/emits `game.changed`, including an equivalent valid patch. Existing reading work import, reading progress and ratings demonstrate useful no-op guards. List metadata, up-next insertion conflict and profile updates also retain avoidable equivalent-operation paths. Reading access freshness timestamps remain meaningful observations and must not be eliminated merely because other content is unchanged.

Migration `0039_performance_benchmarks.sql:69-88` explicitly excludes snapshot/media/game timestamps from content-revision comparison and excludes several observation fields in other tables. Therefore a timestamp-only metadata snapshot update creates physical/WAL work but does not automatically invalidate content. `work_features` has no corresponding timestamp exclusion in that trigger: an identical unguarded feature upsert can still bump global revisions. Complete-detail raw timestamps also form part of raw content. Calibrate each path independently.

**Smallest option:** compare semantic fields or add `IS DISTINCT FROM` conflict/update predicates at the existing owner, keeping independent freshness/last-seen timestamps when required. For game commands, return the current normalized result without webhook/export on a semantic no-op. Reuse existing reading no-op patterns; no new cache is needed.

**Acceptance:** replay actual metadata observations and equivalent user commands on a clone; compare all user-visible/canonical fields, identity mappings, freshness/retry behavior, physical update count, WAL and content revisions. True changes still publish exactly once; explicit rereads/rewatches/new listens remain new events. Test source takeover, metadata precedence and reconnect generations.

### DATA-08 — P2: requesting one screen discovery bucket prepares and persists both buckets

**Status:** source-confirmed duplicated demand; wire traffic depends on existing provider cache state and is not inferred.

**References:** `src/lib/server/queries/discovery.ts:58-63`; `src/lib/catalogue/service.server.ts:495-521`; `src/routes/discover/+page.server.ts:28-46`.

`screenDiscovery(section)` calls `discoverMedia`, which fetches and ingests both trending and recent. Separate trending/recent row requests repeat the complete two-bucket ingestion. The route also calls the combined function. Existing provider caches can avoid remote wire calls but do not remove ingestion transactions. Each bucket runs four concurrent ingesters, so the two branches can produce up to eight metadata transactions competing with other consumers of the ten-connection pool. This is a source bound, not proof of production starvation.

**Smallest option:** let the existing discovery owner request a named bucket and reuse the combined path only for consumers that need both. Share canonical persistence; do not create row-private caches or alternate imports. Add semantic no-op writes from DATA-07 independently. **Alternative:** durable periodically refreshed discovery sets served locally; this changes freshness/ownership and should be chosen only if measured provider/read ingestion remains expensive.

**Acceptance:** on an actual-data clone with transport recorded separately, one trending request does no recent ingestion and vice versa; combined route identities/order match. Measure wire requests, metadata transactions/rows, cache hit behavior and revisions separately. Test partial provider failure and empty/fallback discovery. No self-invalidating refresh loop has been demonstrated.

### DATA-09 — P2/P3 candidate: inline raster avatars amplify settings reads and repeated social payloads

**Status:** representation confirmed on actual installations. Development aggregate shows 3 inline-avatar users, maximum 15,243 avatar bytes and 16,276 settings bytes; deployed aggregate shows 4 inline-avatar users, maximum 14,947 avatar bytes. These are materially below the allowed maximum, so treat this as a smaller repeated-byte opportunity, not the dominant observed bottleneck. Evidence: `evidence/development-real-sql.json` and `evidence/deployed-real-sql.json`, `user-settings-bytes`.

**References:** `src/lib/core/profile/service.server.ts:43-59`; `src/lib/server/auth/index.ts:161-166`; `src/lib/server/config.ts:127`; `src/lib/social/queries.server.ts:107-119`; `src/lib/core/profile/gif-avatar.server.ts:13-65`.

PNG/JPEG/WebP avatars remain data URLs of up to 220,000 characters inside `users.settings`. Session auth selects the full user row; feature subject reads full settings; social rows copy avatar strings. A single accepted friend's inline image can repeat on many work heads/activity cards. The existing three-head/60-work bound controls friend objects, not bytes per avatar. GIFs already use the local file/URL owner and permission-checked stream.

**Option:** generalize that existing avatar storage/stream owner for raster images and migrate inline content without changing appearance. Keep stable hashed identities, privacy checks, cleanup and fallback semantics. Narrow policy reads to feature settings when appropriate, but continue returning the settings required by the session/UI. **Tradeoff:** more authenticated small image requests and filesystem lifecycle management in exchange for substantially smaller repeated JSON; measure actual browser cache/no-store policy before choosing.

**Acceptance:** aggregate actual settings/avatar byte sizes without logging content; compare compressed network bytes and repeat social responses. Verify all image formats, account/public/privacy changes, replacement cleanup and old-image access denial. This is an opportunity if the current installation has small/no inline avatars; it must not be presented as a measured major bottleneck without data.

### DATA-10 — P2 candidate: unchanged browser session authentication takes a row mutex on every request

**Status:** confirmed locking/floor; throughput impact unmeasured.

**References:** `src/lib/server/auth/index.ts:148-183`; `src/hooks.server.ts:42-79,115-116`; `src/lib/server/db/index.ts:38`.

Every syntactically valid session token enters a transaction and selects its session `FOR UPDATE`, then reads the user. This occurs even when rotation is not due and for image/artwork/API requests passing the hook. Requests sharing a token therefore serialize at auth; tabs and concurrently admitted artwork can wait behind the same short critical section. The hook also performs request configuration, setup existence, feature-subject and onboarding checks. Those checks are deliberate authoritative policy, but their combined round-trip cost should be measured as a common request floor.

**Option:** retain a non-locking current-session read for the common no-rotation case and use an atomic conditional rotation/locked recheck only when due, preserving the previous-token grace and revocation/disable semantics. A single combined read of request policy/auth/onboarding may reduce round trips. Cross-request authorization caching is not justified. Removing the row lock without a correct concurrent rotation design is unacceptable.

**Acceptance:** actual valid sessions, many concurrent same-token requests versus independent tokens, rotation boundary, old-token grace, logout/password change/disable/revocation and duplicate cookies. Count waits/transactions/query work; distinguish deliberate injected blocker time from normal auth latency.

### DATA-11 — P3: shared card hydration activates medium-specific query owners for unrelated identities

**Status:** source-confirmed bounded extra work, actual ORM count prepared.

**References:** `src/lib/collection/query.server.ts:290-309`; `src/lib/core/games/service.server.ts:215-225`.

Every `workCardPage` calls screen hydration, game presentation, music rows and enabled reading rows for the entire ID page. A pure screen page still performs empty game/music/reading reads; pure game/reading pages activate the screen owner before discovering no screen records. The costs are bounded per batch but repeated across almost all shared shelf/API consumers.

**Options:** accept the small fixed cost if actual profiles show it is minor; or let callers with authoritative category data pass that information to the shared owner, validating when needed. A preliminary `works(id,category)` partition query can save later empty reads on homogeneous pages but adds its own round trip; compare mixed and homogeneous real pages before introducing it. Keep one batching owner and preserve original requested order/repeated IDs.

**Acceptance:** normalized cards for all homogeneous/mixed page combinations and cross-profile/guest settings, zero/1/60/61 IDs, repeat IDs and absent IDs. Record complete ORM + raw-SQL boundaries; the prepared probe's ORM logger is deliberately a lower bound, not a total database-call counter.

### DATA-12 — P3: a playlist-start command reads the complete list to inspect one header field

**Status:** active source path confirmed; API compatibility use of the separate complete-list endpoint needs a product decision.

**References:** `src/lib/server/api/lists.server.ts:15,29-32`; `src/lib/core/lists/service.server.ts:108-139`; `src/lib/server/queries/lists.ts:203-233`.

The playlist playback command calls `getList`, materializing all list items and full joined media rows, then uses only `playbackStartedAt` and `id`. Separately, GET `/api/v1/lists` still expands every user's list through `userLists`; ordinary UI paths use summaries/paged selected lists, but the endpoint remains callable. Do not call the legacy endpoint a hot production path without caller evidence.

**Smallest option:** use an owner-validated header-only domain read for playback-start admission. Retire or truthfully paginate the complete-list endpoint only after confirming consumers/contract. Do not silently cap returned members.

**Acceptance:** real large playlist first start/restart/already-started/missing/cross-owner cases; zero item hydration for header admission. Existing full list/summary/paged identity and order must remain unchanged until intentionally migrated.

### DATA-13 — P3: profile activity/favourite section refreshes still compute discarded presentation data

**Status:** confirmed bounded discarded work. Insight section repair is present and excluded.

**References:** `src/lib/server/api/profile.server.ts:14-29,39-53`; `src/lib/server/queries/profile.ts:171-297`; public branch `src/lib/server/api/index.server.ts:92-99`.

The section handlers return only history or favourite cards plus paging but call `profileData`, which still validates featured/background preferences and can hydrate featured/fixed/activity-background cards. For a history page, those presentation cards do not appear in the response. The expensive old 20-favourite hydration during insights is already repaired; this is the smaller residual demand mismatch.

**Option:** extend the existing shared summary/section projection owner to select only requested cards and counts, preserving centralized visibility and totals. Keep full profile page presentation unchanged.

**Acceptance:** compare actual full section responses for owner/friend/public, all periods/filters/available scope; assert history/favourite refresh does not call unrelated background/featured hydration. Preserve complete full-page profile output.

### DATA-14 — P1: shared assessment repeats show eligibility per episode and expands broad evidence for item reads

**Status:** confirmed on actual persisted catalogue/history data with current production functions and sanitized PostgreSQL execution plans. This is the dominant measured shared data-path issue in this pass.

**Shared owner:** `src/lib/collection/query.server.ts:55-236`, particularly the `raw_direct` active-show branch at `:90-96` and broad `edges`/owner evidence. Consumers include Collection pages, explicit `workAssessments`, notification inbox, missing/admin demand, received-recommendation availability and Collection projection. Fixing an inbox renderer or adding a notification-private cache would leave the expensive shared query active elsewhere.

**Measured evidence:** actual-data clone contains 147,946 works; selected owner has 26,105 tracking rows. Current Collection first page returns 60 cards / 12,010 total, median 2,657.54 ms (samples 2,442.85 / 4,367.92 / 2,657.54 ms). Inbox returns only 3 visible notices from 112 stored, median 2,273.25 ms. Its dominant assessment query returns one driver row. Exact sanitized plans are in `evidence/data-api-real-reads.json` (`instrumentationVersion:2`):

| Statement | EXPLAIN execution | Shared buffer hits | Temp written blocks | Relevant plan work |
| --- | --- | --- | --- | --- |
| Personal Collection | 3,967.795 ms | 6,903,821 | 12,322 |13,099 direct rows;16,072 assessment rows before 12,010 eligible results and 60-card output. |
| One-work assessment during inbox hydration | 2,276.176 ms | 6,303,958 | 10,743 |One requested root expands 29 scoped works, but still builds the full owner `direct` relation and 250,822 edge rows. |

These two primary EXPLAIN samples use `jit=off` and `recursive_worktable_factor=0.01`, matching the existing `collectionRead` production owner at `src/lib/collection/query.server.ts:48`; inbox hydration reaches that owner through `workAssessments` at `:239`. They execute separately after the route-function samples, under the probe's 30-second statement timeout, and must not be compared as if from one simultaneous run. This settings match does not extend to every secondary plan in the evidence file or to Continue's exploratory plan (DATA-05). Shared-hit counts are repeated logical buffer accesses, not disk reads or distinct pages. Temp-block counts demonstrate spill work in these plans; they do not alone prove memory exhaustion.

**Why:** the active-show reason starts with each tracked watched/progress episode and runs `EXISTS` over that show's remaining regular episodes before the later UNION deduplicates show IDs. The actual plans show 10,260 outer evaluations, roughly 119 episode rows each, and 1,220,658 `tracking_state` primary-key lookups in that branch. Collection and the one-work assessment both pay this owner-wide cost. The explicit-ID branch scopes its root/descendant work but does not comparably scope all owner evidence; its materialized edge relation also contains 250,822 rows before the small requested closure is selected. Global next-episode/music helper work and assessment materialization add further work, but should be optimized from their measured contributions, not assumed equal to the dominant branch.

**Option A, first:** in the same Collection SQL owner, select distinct candidate show IDs from meaningful owner episode state, then evaluate remaining-episode eligibility once per show. This retains exact watched/progress/release/special/drop semantics while eliminating repeated per-episode checks. Preserve all relationship reasons and privacy decisions. **Option B:** for explicit-ID assessments, propagate the already resolved ancestor/descendant closure into evidence and next-item helpers before they prepare unrelated owner/catalogue rows. Keep the full-owner path for personal membership where exact total membership requires it. **Option C:** replace the global materialized edge union with equivalent index-directed scoped recursive legs, or another proven plan shape in this same owner; benchmark complete/cyclic/repeated memberships before adopting it. A durable membership/assessment projection is a larger fallback only if the simpler shared query changes leave substantial actual cost.

Do not respond by raising pool size, globally increasing work_mem, disabling authoritative availability/privacy, limiting raw owner evidence, or silently dropping members. An extra index is not the first explanation for 1.22 million already indexed lookups of the same logical show evidence.

**Acceptance:** capture current complete Collection IDs/order/reasons/counts and explicit assessment outputs for all actual owners/source modes/categories, then compare after each change. Include saved/collected/favourite/list/queue/history, partly watched shows, all-watched shows with future/unreleased episodes, specials, dropped parents, rewatches, inherited/member-derived reasons, reading/music/game and guest/friend privacy. Assess the same real notification work, page and source data. Repeated episode lookups should scale with distinct relevant shows rather than watched-episode count; explicit one-work reads should not prepare unrelated complete-owner reasons or global edges where equivalent scoped traversal is available. Record actual rows/loops/buffers/temp blocks and transaction time, not only 60-card response size. Test all shared consumers listed above and preserve refresh/clock-dependent freshness.

## Cross-cutting observations owned jointly with other reports

- **Single-medium search starts all enabled media work.** `src/routes/search/+page.server.ts:75-121` starts local screen and reading reads and all enabled streamed provider branches after validating a selected view. Explicit Books/Watch/Play selection does not constrain those branches. The UI audit owns demand correction and browser evidence; provider/data impact includes avoidable screen ingestion and unrelated provider requests.
- **Feature reconciliation publication fencing.** `src/lib/application/feature-transition.server.ts:27-70` performs destructive local closure/cancellation transactions without `assertJobLease(tx,true)`, then calls `jobCheckpoint`. Frozen cutoffs and idempotency reduce effects but do not fence a cancelled/recovered attempt at commit. Scheduler audit owns lease/cancellation verification and deduplication.
- **Collection projection.** `src/lib/collection/projection.server.ts:63-75` selects complete desired evidence and calls `exportIdentity` for every leaf; repeated episodes from one show repeat mapping reads. `previewSourceChange` computes before/after per affected account. Addition delivery still confirms through a complete remote census per leaf (`:171`), while removals use batches of 50. Integrations audit owns live/provider/lifecycle costs and options; source coverage is retained here.
- **Ancestor refresh after progress.** `src/lib/core/tracking/service.server.ts:326-377,408-476,511-512` transfers every sibling's state for each affected show/season and reads collection child state before recomputing summaries. Progress cadence can repeat this work. A SQL aggregate can reduce transfer, while maintaining parent fences and exact completion/play-count rules. This remains a source opportunity until actual-row plans and rolled-back mutation measurements establish its cost.
- **Request cancellation.** Most database read models take no `AbortSignal`; the details dispatcher passes a signal only to the music-source branch. Client cancellation prevents stale UI publication but does not itself stop admitted PostgreSQL work. Add cancellation/statement budgets at the existing database owner only after distinguishing safe read aborts from committed mutation semantics. The pool cap is a bound on active connections, not proof that queued work is inexpensive.

## Measurement-gated SQL candidates

These are real source shapes, not verified bad plans. Do not add indexes, planner overrides, caches or projections without actual plans/result equivalence.

| Owner | Growing dimension and existing bound | Investigation and options |
| --- | --- | --- |
| Collection assessment | Owner evidence; root/descendant closures; mappings/editions/source count. Visible cards 60. Some CTEs read global child/music evidence before joins. | Capture actual `ANALYZE, BUFFERS` plans for personal page/action assessment/source modes and large child fan-out; inspect materialization and repeated work. Existing local recursive planner factor/JIT choices are intentional; do not duplicate them elsewhere. |
| `activityFeed` | Complete visible histories are windowed/grouped before final 61-row lookahead. Relationship traversal is conditional on item relationship scope. | Existing parked redesign requires exact run/album grouping, listen numbering, unknown dates, repeated events and cursor identity. A durable grouped projection or exact boundary-preserving page plan is possible; early raw-event LIMIT changes behavior. |
| Taste staleness/ranking | Ten users/run, 300 evidence roots/user, 500 candidates/medium; freshness expression can rescan recommendations per candidate user and candidate windows rank all eligible matches. | Actual many-user/set/feature plans before global aggregate hoisting or candidate access redesign. Existing compile/checkpoint/fencing repairs must stay. |
| Recommendation scoring | Up to 2,000 preselected candidates, 100 positive evidence roots; local reads only. | Measure joins and correlated scoring against actual catalogue. Preselection occurs before weighted genre/author scoring; changing its cap/ranking is also a recommendation quality decision. |
| Feed definition census | 300 evidence works; at most 10,000 definitions; up to four adjacency reads each bounded to 2,000 catalogue candidates. | Current one-census-per-visit client architecture removes prior page replay. Profile actual interest aggregation/subject fan-out before introducing reuse. |
| Admin missing demand | Complete demand projection per consenting active user before final 60-user page; each returned user contains at most 60 demand items. | User count multiplies full projection work. Consider separate existence/count and selected-user detailed projections; do not lose exact total/filter consent. |
| Notification summary + page | Visibility/context evaluated for unread summary and again for 61-row cursor page; hydration page60. Reaction notices also hydrate activity/card details. | Capture large actual inbox/provider history plans and bytes. Reuse within one statement/request if exact snapshot/visibility semantics remain. Keep snapshot-based read-all boundary. |
| Profile insight aggregations | Period/all owner watch history; daily series can span all dated years; genre rows transfer all then display six+Other. | Request-local shared aggregate/CTE may reduce repeated watch projection. Keep truthful all-period exact data and do not fabricate chart caps. |
| Deep numbered pages | Count+OFFSET across catalogue/library/history/list/public API. 60 outputs; public page input10,000. | Compare actual page1 and actual deep pages. Cursor contract migration is optional product/API work; OFFSET alone is not a defect. |
| Presence/read freshness | One latest live state/person but visibility/candidate SQL can inspect active sessions globally. | Plans need active-session/source/peer scale, not whole-history assumptions. Heartbeat write threshold10s and content revisions excluding heartbeat are good defenses. |

## API families and contract bounds

| Family | Data/network behavior audited | Current bound / limitation |
| --- | --- | --- |
| Hook/session/setup/auth | Request-local policy; authoritative session/setup/feature/onboarding checks; password hashing outside account-create lock. | Pool10; session read mutex; attempt map10,000 keys with15-minute expiry; 10 attempts/window. Auth cost on artifact requests needs actual observation. |
| Browser Collection/Library/Progress/lists | Domain read models and shared cards; category/privacy/source predicates before most page hydration. | Page60; exceptions DATA-05/06/12; complete-list summary count unbounded by number of lists. |
| Browser media/heroes/sequence | Local details/actions/history; explicit enhancement/provider refresh; ID/field validation. | Hero IDs60; history60; media explicit ids10,000 with individual limit500; shared explicit hydration batches60 and retains completeness. DATA-02/04. |
| Browser social | Friends, activity, popularity, reactions, work heads, recommendations, insights, check-ins. | Friends61; feed61; work/reaction IDs60; heads3/root; discovery60; insight sample300/person and overlap60; all-current check-in response depends on active peers. |
| Browser games/playthroughs | Canonical local pages, IGDB previews/imports, private sessions and selected playthroughs. | Page60; game details playthroughs60; session history60; equivalent update issue DATA-07. |
| Browser reading | Thin dispatch into shared reading/session/group owners; cancellation passed for file/source/session preparation. | Reading report owns format/provider/file bounds; all progress uses idempotent shared domain writer. |
| Browser providers/playback/queue | Existing provider/domain dispatch; request signal on streams/start/artwork; jobs queued via existing owner. | Specialized integration/playback reports own resource/lifetime checks; no independent dispatcher-wide concurrency pool was found. |
| Browser notifications | Visibility-filtered summary + cursor inbox; batch seen/read; broadcast. | Inbox60+lookahead; seen60; broadcast batches100; read-all affects every matching notice by explicit snapshot. |
| Browser settings/admin | Bounded token/invite lists; user/config changes; benchmarks and taste queue. | Tokens20 active, list50; invites100; `listUsers` full directory; admin health aggregates complete outbox history. |
| Public v1 reads | Bearer-only auth/quota; explicit scopes/DTOs; catalogue/library/collection/progress/reading history/webhooks reuse domains. | 120 requests/min/token; 60/page; page1–10,000; webhook list paged. HEAD performs normal authoritative read work then discards body. |
| Public v1 writes | Body64KiB; mandatory canonical idempotency identity; domain transaction reuse; webhook events inserted transactionally. | DATA-01; no page-time provider browse. Idempotency/revoked token/feature checks must remain authoritative. |
| Webhook delivery | Active subscription/token/account checks, bounded fetch, HMAC, durable outbox and retry count. | Ten active subscriptions/user; response64KiB, timeout10s, at most8 attempts relative to retry base. Queue/backlog retention reviewed by integration lane. |
| Planning | Plans and release reads local; reminders queued. | 100 scheduled plans/user; friends20; page60; up to21 serial notification recipients. No page-time provider request. |

## Verified defenses to preserve

- Request config and feature subjects are scoped to one HTTP request, deactivate in `finally`, bypass snapshots for explicit transactions, and cap memoized subjects at40. Background startup exits request context.
- Public API never treats browser cookies as machine auth; token quotas are atomic durable updates and narrow DTOs avoid accidental private-field export. Mutation replay and domain writes share one transaction.
- Collection membership, category/privacy and availability normally precede card paging. Availability freshness includes clock-dependent expiry rather than requiring writes.
- `workCards` deduplicates fetch identities, chunks at60, and restores requested repeated order. Explicit public detail hydration now batches500 and remains complete; the old silent500-child truncation is fixed.
- Screen metadata snapshots exclude unused raw JSON except selected artwork; music mappings use narrow fields; sequence summaries/next results are batched60; local search uses indexed documents and bounded fallback.
- Game/reading provider cards resolve local identities in batches instead of importing every result. IGDB variants borrow presentation without changing canonical identity.
- Reading work and progress, rating and ordinary tracking writers have meaningful no-op/replay guards. Permanent source-event IDs remain durable even for no-op imports; removing those markers would duplicate historical plays on retry.
- Social privacy predicates remain SQL authoritative before ranking/counts. Card heads cap selected details before presence; comparison transfers only300 sampled evidence rows/person plus60 overlap rows while exact counts remain database aggregates.
- Taste work is bounded per user/medium, compiles reusable scorers and fences/revision-checks publication. The queue census remains fixed through yields/resume.
- Notification writes/broadcasts use the same preference/visibility owner in batches100, duplicate source keys preserve sequential upsert semantics, inbox paging uses timestamp+UUID and read-all has a snapshot boundary.

## Verification record and outstanding acceptance

Actual-data-clone workers are retained as `data-api-real-probe.ts`, `data-api-lock-probe.ts`, and `data-api-bulk-probe.ts` beside this report (not production changes). The coordinator executes their matching temporary copies:

- `/private/tmp/coast-data-api-real-probe.ts`: real persisted owner, homogeneous screen page, personal Collection, Continue, received recommendations both scopes, watchlist, feed census, inbox and largest existing season/collection. One untimed warm-up plus three measured reads each. Outputs aggregate row/card/byte counts, CPU/process memory deltas and ORM statement counts. Raw Bun SQL is excluded from that logger and explicitly disclosed. No providers or private identities are written to evidence.
- `/private/tmp/coast-data-api-lock-probe.ts`: deterministic source-shaped incompatible lock graph on a real persisted user; no data changes. Does not claim full HTTP race coverage.
- `/private/tmp/coast-data-api-bulk-probe.ts`: actual existing collections, actual production core bulk writer, complete transaction rollback, SQL/sequence-expansion counts, no providers/exports. Skips with an explicit gap if no qualifying real collection exists.

The coordinator executed all three actual-data workers and retains overall suite/build/browser evidence. Local read evidence has 30 successful measured reads and no operation errors; empty real feature tables remain the explicit coverage gaps above. No isolated timings are invented here, and no speedup is claimed before an implementation exists. Measurements of a real installation's empty feature tables are valuable coverage information but cannot verify that feature's loaded runtime behavior.

Implementation should proceed one root cause at a time. Keep the actual-data snapshot identity and source hashes, retain complete result-equivalence oracles, then rerun the same workloads after each candidate fix. Add regression assertions for meaningful operation bounds and lock ordering to the existing owning suites. Preserve accepted UI, domain privacy, source generations, historical event identity and required complete/paged semantics. Cross-feature projections/caches are optional larger choices after the simpler fixes have measured residual cost.

## Shared implementation ownership and consumer acceptance

Every repair belongs in the existing owner. A feature-specific bypass, hidden truncation, new row-private cache or competing scheduler would leave the same root cause active elsewhere. A repeated semantic pattern can be applied consistently in multiple existing domain owners without inventing a general framework.

| Finding | Shared owner to change | Consumers that must receive the repair and be verified |
| --- | --- | --- |
| DATA-01 | Existing feature-policy/account/token transaction admission and documented lock ordering | Public tracking/bulk/relationships/ratings/music/game/reading/webhook writes; browser tracking; configuration/account/token withdrawal paths. |
| DATA-02 | Core tracking's sequence admission + existing core sequence SQL owner | Bulk collection/show-in-playlist; single playlist/collection watch/progress; browser and public API; playback/import callers supplying context. |
| DATA-03 | Core list mutation service | List menus, work-list actions, playlist order/sequence, add/remove undo, Trakt export consumers and concurrent list commands. |
| DATA-04 | Shared screen `detailsData` composition + existing detail-row sources | Full page, canonical detail overlay, enhancement reload, season/collection/episode parent sections and selected-edition workflows. |
| DATA-05 | Shared continuation/progress planner | Home/For You hero, Continue/Next/up-next rows, progress page/API, public progress, cross-profile progress and request-local callers. |
| DATA-06 | Existing received-recommendation progress projection and shared assessment SQL | Progress/Next recommendations row/page, browser progress API and public progress API; all media/category/privacy/availability modes. |
| DATA-07 | Each existing semantic persistence owner using the same no-op/revision contract | Screen metadata from discovery/search/credits/import/maintenance; games from IGDB/import/manual/public API; list/up-next/profile/reading-file callers. Freshness observations remain explicit. |
| DATA-08 | Existing catalogue discovery service | Discovery full page, lazy trending/recent rows, guest reads, For You discovery consumers and retries. |
| DATA-09 | Existing profile avatar storage/stream owner + policy projections | Session/settings, card heads, friends, activity, notifications, profile, public profiles and avatar chooser. |
| DATA-10 | Existing session authentication owner and request hook | All browser-authenticated pages, JSON APIs, artwork, streams, reader files, tabs and session renewal/logout flows. |
| DATA-11 | Shared `workCards`/medium hydration boundaries | Collection, Library, Progress, lists, profiles, social, notifications, planning, streams and public API; every medium and mixed page. |
| DATA-12 | Existing core list header/summary/detail read service | Playlist admission, list actions, summaries, legacy complete-list endpoint and any discovered external callers. |
| DATA-13 | Existing profile summary/section owner | Signed-in and guest activity/favourite APIs plus full profile pages and insight period controls. |
| DATA-14 | Shared Collection assessment SQL/evidence/edge traversal owner | Collection, every explicit work assessment, notifications, demand/admin demand, received-recommendation availability and Collection projection. |

Cross-feature acceptance must exercise the same shared primitive through at least one browser/API consumer and one independent domain/read-model consumer where both exist. A local row improvement is incomplete if another caller still performs the removed expensive work before invoking it.

## Smaller bounded opportunities retained for completeness

These are source-confirmed discarded work or repeated operations, with no standalone speedup claim. They belong in the same shared-owner backlog and should be measured after the larger issues.

| Source | Current cost | Shared option and verification |
| --- | --- | --- |
| `src/lib/server/queries/media-rows.ts:88-92` | A status-filtered game preview calls `listGames` for a 60-record page, including presentation metadata, then returns12. | Let the existing list/read projection accept an explicitly bounded projection limit where its contract permits; retain exact preview IDs/order and full grid paging. Verify both consumers. |
| `src/lib/server/queries/media-actions.ts:22-50` | An episode menu hydrates its own card, whole-show card, then parent cards; the same show can be hydrated in both calls. | Collect the bounded identity union in the existing action composition and hydrate once, then preserve whole-work/parent/request/playable fields exactly. Same owner serves every screen action menu. |
| `src/lib/server/public-api/handler.server.ts:58-81`, `response.ts:6-9` | Catalogue and accessible-library responses use full `workCards` then the non-personal DTO discards state, artwork, credits and most metadata. | Add a narrow shared work-summary projection preserving title preferences, game variant presentation, year and attribution. Reuse it in all summary-only consumers; do not duplicate field precedence/privacy. Compare actual DTO identities/order/content and query/byte work. |
| `src/lib/collection/source-changes.server.ts:57-58` | A source change sends one notification operation per affected user, each independently reading config/preferences. | Reuse existing `notifyMany` in batches100 where event semantics permit; verify per-user visibility/preferences/deduplication, failures and source-key identities. |
| `src/lib/server/notifications/index.ts:157-165` | Admin health latency includes three sequential queries, and the action-state count scans durable job history. | Distinguish connectivity latency from total health preparation; measure actual plans before using a durable count snapshot. Reuse existing readiness/telemetry owners. |
| `src/lib/core/tracking/continue.server.ts:132-149` | Continue removal reads every owner's queued item, then filters to actual removed IDs. | Read only relevant scope/returned deleted queue IDs within the existing transaction. Verify exact Undo snapshots, source order and concurrent queue changes. |
| `src/lib/experiments/planning.server.ts:18-22,63-65` | Up to20 friend relationships are checked serially twice during creation, then reminders notify up to21 users serially. | Deduplicate inputs before both checks, batch authoritative friendship admission and reuse shared notification batches; retain transaction-time validation, policy withdrawal and per-recipient visibility. The existing bound makes this lower priority. |
| `src/lib/social/taste.ts:31-34` | Feature overlap uses `av.filter(...bv.some(...))`; per dimension up to500 affinities gives250,000 comparisons. | A calculation-local set of right-hand affinity IDs bounds lookup work; preserve exact scores/shared counts. Measure on actual sampled profiles; do not add global personal caches. |

No extra dependency, private scheduler or UI redesign is needed for these options. Maintain exact existing contracts and make a shared read/write owner serve each consumer.

## Residual shared-helper review

A final source pass read 36 additional media/profile/client/control helpers in full. Exact files, exports, source hashes and review depth are retained in `data-api-helper-coverage.json`. No additional tests were run in this pass. Pure artwork, media identity/lifecycle, journal grouping and UTC period helpers have no autonomous resources. The all-time activity helper already aggregates by year after two years, avoiding allocation for every quiet day. Menu reads use the shared generation/abort/disposal resource; outside-event listeners are shared, and resize/scroll/observers belong only to open menus. Feedback failure owners clean themselves up on destroy, and acknowledged writes retain their independent lifetime.

| ID / classification | Source evidence and practical limit | Generic owner, option and acceptance |
| --- | --- | --- |
| HELPER-01, P3 source-confirmed serialization opportunity | `src/lib/ui/controls/work.svelte.ts:10-14` stringifies the complete `page.data.user.settings` in every menu scope computation. Equal resulting keys prevent a refetch, but do not prevent serializing the actual roughly 15 KB inline-avatar settings for each mounted consumer after session object replacement. Number of mounted menu owners determines the real cost; no allocation benchmark was run. | Define the minimal primitive policy key once at the shared menu/client owner, keeping every permission/settings dependency actually used by menus. Apply to screen/catalogue/work/list/party menu consumers. Verify unchanged session replacement preserves scope and causes no read; real feature/role/presentation changes invalidate every affected menu correctly. |
| HELPER-02, P3 source-confirmed closed-owner resource cost | `src/lib/ui/controls/menu.svelte.ts:283-291` installs one matchMedia change listener per mounted menu controller even while closed. Cleanup at `:313-319` is present, so this is retained cost proportional to mounted owners, not evidence of a leak. Open-menu resize/scroll/observer cleanup is sound. | Either subscribe to the existing shared responsive owner or activate this listener only while the controller needs it. Keep the same controller for all menus. Verify desktop/mobile mode transitions before/during open, nested compact drill-down, keyboard/focus restoration and last-owner cleanup. |
| HELPER-03, P3 unverified disposal-race candidate | `src/lib/social/status.svelte.ts:30-33` updates global status and may invalidate social data after the awaited heartbeat without rechecking `stopped`/abort. Disposal does abort the fetch and remove timer/listeners. A transport completion/abort boundary can leave already-resolved work publishing after stop; no browser race was reproduced here. | Add a current-owner/stopped guard at the shared presence publication boundary, without cancelling intended active playback presence. Verify stop/restart, hidden/playing states, settings writes and account changes; no old heartbeat may publish or invalidate after teardown. |
| HELPER-04, P3 source-confirmed small repeated computation | `src/lib/media/requests.ts:14-23` constructs a Set of all request destinations every time a single request's scope label is formatted. Rendering N request rows can repeat that N-element walk N times. Actual request cardinality and cost were not measured. | Compute the destination multiplicity once per immutable request snapshot in the shared request presentation owner. All request menus/cards use the same formatter. Preserve exact single/multiple destination and season/4K labels. |
| HELPER-05, P3 source-confirmed feedback-scope mismatch; runtime unverified | `src/lib/ui/controls/queue.svelte.ts:6,16` captures context-specific `change` but publishes success through global `notifyAction`. `client-context.ts:8-13` gives previews their own feedback channel, and all mutation component callers explicitly use that channel. Thus queue actions have a different delivery ownership contract. No preview interaction reproduction was run in this pass. | Capture `feedback` alongside `change` in the existing queue action owner and use its notification channel. Verify real QueueList retry/cancel/promote and preview QueueList interactions: one notice appears in the correct scope and no app-global notice escapes a preview. No alternate queue controller or UI redesign is needed. |
