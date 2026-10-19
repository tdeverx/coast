# Implementation ledger

Work remains active. This is the current repair overlay for the [pinned baseline audit](README.md). No commit, push, PR or deployment has been made. Every original finding/opportunity/plan lead stays visible; an applied change is not automatically complete acceptance. [Machine-readable ledger](implementation-ledger.json).

## Reading the evidence

Actual-data and live-browser checks are recorded separately from controlled regression faults. Complete before/after comparisons, immutable baseline source, current source fingerprints, all samples and remaining gaps belong to each change. Counts below are recorded items, including overlaps, not independent defects or additive savings.

| Current status | Recorded items |
| --- | --- |
| implemented-actual-acceptance-pending | 3 |
| implemented-actual-byte-replay-verified | 1 |
| implemented-actual-data-restore-verified | 1 |
| implemented-actual-data-verified | 6 |
| implemented-actual-equivalence-verified-coverage-gaps | 1 |
| implemented-actual-equivalence-verified-scale-gap | 1 |
| implemented-actual-labels-verified-scale-gap | 1 |
| implemented-actual-retained-snapshot-replay-verified | 1 |
| implemented-admin-actual-catalogue-verified | 3 |
| implemented-admin-native-queue-overflow-verified | 1 |
| implemented-completed-actual-cohorts-verified | 1 |
| implemented-live-verified | 6 |
| implemented-normal-rollout-common-and-authenticated-inbox-verified; actual-toast-cohorts-partial | 1 |
| implemented-regression-verified | 5 |
| implemented-representative-actual-data-verified | 1 |
| investigation-boundary | 1 |
| open | 19 |
| overlap-measured | 2 |
| partial-actual-data-and-live-verified | 2 |
| partial-actual-data-verified | 12 |
| partial-actual-native-lifetime-verified | 2 |
| partial-actual-snapshot-binding-verified | 1 |
| partial-actual-state-admission-verified | 1 |
| partial-admin-occurrence-and-boundary-verified | 1 |
| partial-bounded-library-collection-actual-data-verified | 1 |
| partial-friendship-policy-order-native-verified | 1 |
| partial-interest-input-actual-verified | 1 |
| partial-narrow-browser-dto-actual-verified | 1 |
| partial-open-menu-material-live-and-regression-verified | 1 |
| partial-planning-friend-admission-actual-verified | 1 |
| partial-profile-noop-and-feature-bindings-actual-rollback-verified | 1 |
| partial-read-lifetimes-actual-contract-verified | 1 |
| partial-regression-verified | 4 |
| partial-shared-conflict-summaries-admin-actual-verified | 1 |
| partial-shared-identity-batch-actual-verified | 1 |
| partial-shared-import-batching-admin-actual-data-verified | 1 |
| partial-shared-import-reload-built-actual-verified | 1 |
| partial-shared-logical-refresh-applied-regression-verified | 1 |
| partial-steam-chunk-policy-order-native-verified | 1 |
| partial-synchronous-menu-scope-reuse-actual-input-and-native-verified | 2 |

## Effective status for every recorded item

| ID | Status | Source changed | Shared workstream | Baseline finding |
| --- | --- | --- | --- | --- |
| DATA-01 | implemented-actual-data-verified | yes | W01 | [public API writes can deadlock with ordinary tracking through inverted owner locks](data-api.md) |
| DATA-02 | partial-admin-occurrence-and-boundary-verified | yes | W05 | [sequence-context tracking repeatedly expands the complete sequence; bulk collection completion is quadratic in transferred sequence rows](data-api.md) |
| DATA-03 | implemented-admin-actual-catalogue-verified | yes | W06 | [list removal and reorder issue one update for every member under an owner-wide lock](data-api.md) |
| DATA-04 | partial-actual-data-verified | yes | W05 | [initial screen details materialize complete child and overlapping parent-collection cards](data-api.md) |
| DATA-05 | partial-actual-state-admission-verified | yes | W02 | [Continue and the initial home hero still plan from the owner's complete screen state and descendant sets](data-api.md) |
| DATA-06 | open | no | W02 | [received-recommendation progress fetches all candidates and assesses all candidates before paging](data-api.md) |
| DATA-07 | partial-profile-noop-and-feature-bindings-actual-rollback-verified | yes | W06 | [several unchanged operations still perform physical updates, timestamps and downstream work](data-api.md) |
| DATA-08 | implemented-actual-retained-snapshot-replay-verified | yes | W06 | [requesting one screen discovery bucket prepares and persists both buckets](data-api.md) |
| DATA-09 | partial-actual-data-verified | yes | W08 | [inline raster avatars amplify settings reads and repeated social payloads](data-api.md) |
| DATA-10 | implemented-actual-data-verified | yes | W01 | [unchanged browser session authentication takes a row mutex on every request](data-api.md) |
| DATA-11 | implemented-actual-data-verified | yes | W08 | [shared card hydration activates medium-specific query owners for unrelated identities](data-api.md) |
| DATA-12 | implemented-admin-actual-catalogue-verified | yes | W05 | [a playlist-start command reads the complete list to inspect one header field](data-api.md) |
| DATA-13 | implemented-actual-equivalence-verified-coverage-gaps | yes | W08 | [profile activity/favourite section refreshes still compute discarded presentation data](data-api.md) |
| DATA-14 | partial-actual-data-verified | yes | W02 | [shared assessment repeats show eligibility per episode and expands broad evidence for item reads](data-api.md) |
| HELPER-01 | partial-synchronous-menu-scope-reuse-actual-input-and-native-verified | yes | W08 | [Menu scopes serialize full user settings per consumer](data-api.md) |
| HELPER-02 | implemented-regression-verified | yes | W09 | [Closed menu controllers retain individual breakpoint listeners](data-api.md) |
| HELPER-03 | implemented-regression-verified | yes | W03 | [Presence heartbeat does not recheck owner after awaiting reply](data-api.md) |
| HELPER-04 | implemented-actual-labels-verified-scale-gap | yes | W08 | [Request labels repeat destination-set construction](data-api.md) |
| HELPER-05 | implemented-regression-verified | yes | W12 | [Queue actions publish feedback outside preview client scope](data-api.md) |
| MIN-01 | implemented-actual-equivalence-verified-scale-gap | yes | W08 | [A status-filtered game preview calls `listGames` for a 60-record page, including presentation metadata, then returns12.](data-api.md) |
| MIN-02 | implemented-actual-data-verified | yes | W08 | [An episode menu hydrates its own card, whole-show card, then parent cards; the same show can be hydrated in both calls.](data-api.md) |
| MIN-03 | partial-actual-data-verified | yes | W08 | [Catalogue and accessible-library responses use full `workCards` then the non-personal DTO discards state, artwork, credits and most metadata.](data-api.md) |
| MIN-04 | partial-actual-data-verified | yes | W08 | [A source change sends one notification operation per affected user, each independently reading config/preferences.](data-api.md) |
| MIN-05 | partial-actual-data-verified | yes | W08 | [Admin health latency includes three sequential queries, and the action-state count scans durable job history.](data-api.md) |
| MIN-06 | implemented-admin-actual-catalogue-verified | yes | W08 | [Continue removal reads every owner's queued item, then filters to actual removed IDs.](data-api.md) |
| MIN-07 | partial-planning-friend-admission-actual-verified | yes | W08 | [Up to20 friend relationships are checked serially twice during creation, then reminders notify up to21 users serially.](data-api.md) |
| MIN-08 | implemented-completed-actual-cohorts-verified | yes | W08 | [Feature overlap uses `av.filter(...bv.some(...))`; per dimension up to500 affinities gives250,000 comparisons.](data-api.md) |
| PLAN-01 | overlap-measured | no | W12 | [Collection assessment](data-api.md) |
| PLAN-02 | partial-actual-data-verified | yes | W12 | [`activityFeed`](data-api.md) |
| PLAN-03 | partial-actual-data-verified | yes | W12 | [Taste staleness/ranking](data-api.md) |
| PLAN-04 | partial-actual-data-verified | yes | W12 | [Recommendation scoring](data-api.md) |
| PLAN-05 | partial-interest-input-actual-verified | yes | W12 | [Feed definition census](data-api.md) |
| PLAN-06 | partial-actual-data-verified | yes | W12 | [Admin missing demand](data-api.md) |
| PLAN-07 | overlap-measured | no | W12 | [Notification summary + page](data-api.md) |
| PLAN-08 | partial-actual-data-verified | yes | W12 | [Profile insight aggregations](data-api.md) |
| PLAN-09 | open | yes | W12 | [Deep numbered pages](data-api.md) |
| PLAN-10 | open | no | W12 | [Presence/read freshness](data-api.md) |
| PJ-01 | implemented-actual-byte-replay-verified | yes | W03 | [private artwork cancellation is owned by the first caller](providers-jobs.md) |
| PJ-02 | partial-regression-verified | yes | W04 | [crop cache does not provide true single-flight](providers-jobs.md) |
| PJ-03 | open | no | W04 | [crop processes and retained results lack aggregate bounds](providers-jobs.md) |
| PJ-04 | open | no | W10 | [Comic Vine search waits on optional enrichment](providers-jobs.md) |
| PJ-05 | open | no | W06 | [one Trakt value can require a full account walk](providers-jobs.md) |
| PJ-06 | partial-shared-identity-batch-actual-verified | yes | W06 | [Trakt list delivery still rebuilds full identities and rewrites converged lists](providers-jobs.md) |
| PJ-07 | open | no | W07 | [Jellyfin final reconciliation escapes page/transaction budgets](providers-jobs.md) |
| PJ-08 | partial-shared-import-batching-admin-actual-data-verified | yes | W06 | [a single music track can materialize 10,000 listens in one transaction](providers-jobs.md) |
| PJ-09 | open | no | W06 | [final shared-library membership update rewrites matching parents and correlates child counts](providers-jobs.md) |
| PJ-10 | open | no | W07 | [Jobs terminal representatives scan and spill permanent history](providers-jobs.md) |
| PJ-11 | implemented-actual-data-verified | yes | W07 | [Steam rewrites growing immutable snapshot content when only its cursor changes](providers-jobs.md) |
| PJ-12 | partial-shared-conflict-summaries-admin-actual-verified | yes | W08 | [list conflicts have no page bound and hydrate complete local membership per conflict](providers-jobs.md) |
| PJ-13 | open | no | W08 | [review pagination refetches invariant TMDB detail and credits](providers-jobs.md) |
| PJ-14 | open | no | W03 | [queued provider time has no caller deadline](providers-jobs.md) |
| PJ-15 | open | no | W07 | [bulk task controls select all matching jobs and execute serial transactions](providers-jobs.md) |
| PR-01 | implemented-actual-acceptance-pending | yes | W04 | [EPUB asset object URL cleanup failure](playback-readers.md) |
| PR-02 | open | no | W03 | [Hung control report blocks Stop and queues lifecycle events](playback-readers.md) |
| PR-03 | implemented-actual-acceptance-pending | yes | W03 | [Reader heartbeat overlap and no teardown abort](playback-readers.md) |
| PR-04 | partial-regression-verified | yes | W03 | [Missing cancellation at music/trailer request boundaries](playback-readers.md) |
| PR-05 | partial-actual-snapshot-binding-verified | yes | W06 | [Serial rich music persistence and per-source page growth](playback-readers.md) |
| PR-06 | open | no | W04 | [EPUB preflight and assets scale with full expanded archive](playback-readers.md) |
| PR-07 | partial-regression-verified | yes | W04 | [Native comic forward display depends on storage order](playback-readers.md) |
| PR-08 | open | no | W03 | [Room wide reconciliation per participant heartbeat](playback-readers.md) |
| PR-09 | partial-actual-data-and-live-verified | yes | W08 | [Reading range/HEAD metadata authorization amplification](playback-readers.md) |
| PR-10 | implemented-actual-acceptance-pending | yes | W08 | [Full provider snapshot hydration per playback relay request](playback-readers.md) |
| PR-11 | implemented-admin-native-queue-overflow-verified | yes | W05 | [Queue materialization silent cap and whole sequence validation](playback-readers.md) |
| PR-12 | partial-regression-verified | yes | W09 | [One hidden hero source/crop sampler retained](playback-readers.md) |
| PR-13 | open | no | W04 | [Post-decode comic dimension guard cannot bound peak allocation](playback-readers.md) |
| PR-14 | open | yes | W07 | [Evidence/session growth and history late page plans](playback-readers.md) |
| UIS-01 | implemented-normal-rollout-common-and-authenticated-inbox-verified; actual-toast-cohorts-partial | yes | W09 | [toast suppression remembers every historical ID](ui-second-pass.md) |
| UIS-02 | implemented-regression-verified | yes | W03 | [browser diagnostics poll in hidden tabs and permit overlap](ui-second-pass.md) |
| UIS-03 | partial-bounded-library-collection-actual-data-verified | yes | W09 | [append retains all loaded items and card owners](ui-second-pass.md) |
| UIS-04 | partial-open-menu-material-live-and-regression-verified | yes | W09 | [card/shelf demand is latched after first contact](ui-second-pass.md) |
| UIS-05 | implemented-regression-verified | yes | W10 | [empty compact charts still request an engine](ui-second-pass.md) |
| UIS-06 | partial-actual-native-lifetime-verified | yes | W09 | [scheduling is shared, but native SVG still rebuilds and has no pixel budget](ui-second-pass.md) |
| UIS-07 | partial-actual-native-lifetime-verified | yes | W04 | [avatar compressed-byte bound does not bound decode memory/lifetime](ui-second-pass.md) |
| UIC-01 | partial-synchronous-menu-scope-reuse-actual-input-and-native-verified | yes | W08 | [Menu identity repeatedly serializes complete unrelated user settings](ui-components.md) |
| UIC-02 | implemented-live-verified | yes | W03 | [Request dialog abandons option reads without aborting them](ui-components.md) |
| UIC-03 | partial-shared-logical-refresh-applied-regression-verified | yes | W06 | [Grouped recommendation responses refresh once per recommendation ID](ui-components.md) |
| UIC-04 | partial-narrow-browser-dto-actual-verified | yes | W08 | [Collection export preview returns full entries and mounts unbounded review panels](ui-components.md) |
| UPP-01 | open | no | W11 | [shared chart model lacks family work and generated-mark budgets](ui-preview-platform.md) |
| UPP-02 | open | no | W11 | [custom preview JSON and image imports bypass finite fixture bounds](ui-preview-platform.md) |
| UPP-03 | partial-actual-data-verified | yes | W11 | [bounded diagnostic store repeats filesystem and full-tail parsing work](ui-preview-platform.md) |
| UPP-04 | implemented-actual-data-restore-verified | yes | W12 | [recovery drill captures stdout and stderr sequentially](ui-preview-platform.md) |
| FRT-01 | partial-actual-data-and-live-verified | yes | W10 | [Selected search medium still starts other enabled searches](frontend-routes.md) |
| FRT-02 | implemented-live-verified | yes | W10 | [Public details activate private enrichment and false expiry handling](frontend-routes.md) |
| FRT-03 | partial-read-lifetimes-actual-contract-verified | yes | W03 | [Profile reads and onboarding polling bypass shared cancellation ownership](frontend-routes.md) |
| FRT-04 | partial-shared-import-reload-built-actual-verified | yes | W10 | [Lazy component imports have no scoped error and retry state](frontend-routes.md) |
| FRT-05 | implemented-live-verified | yes | W10 | [Public detail ancestry includes recommendation edges and can replace the hero title](frontend-routes.md) |
| LIVE-01 | implemented-live-verified | yes | W03 | [Section-to-detail replacement invalidates an outgoing Shelf source and blocks navigation](frontend-live.md) |
| LIVE-02 | implemented-live-verified | yes | W08 | [Linked reading candidate metadata is spread into a strict session command and blocks Read](reading-live.md) |
| LIVE-03 | investigation-boundary | no | W12 | [Development reload activity confounded initial Reader lifecycle measurement](reading-live.md) |
| PANEL-01 | implemented-live-verified | yes | W09 | [Small reverse detail-sheet scrolling snaps immediately back to the expanded position](panel-scroll.md) |
| LOCK-01 | implemented-representative-actual-data-verified | yes | W01 | [Account-first commands later acquire the shared policy fence](mutation-locks.md) |
| LOCK-02 | implemented-actual-data-verified | yes | W01 | [Concurrent token creators upgrade shared user locks for quota serialization](mutation-locks.md) |
| LOCK-03 | partial-steam-chunk-policy-order-native-verified | yes | W01 | [Steam ownership publication holds a connection before nested account admission](mutation-locks.md) |
| LOCK-04 | partial-friendship-policy-order-native-verified | yes | W01 | [Social commands lock friendship rows before later policy admission](mutation-locks.md) |

## Evidence and remaining acceptance for applied changes

The original reports define full consumer sets and alternatives. These entries add current implementation evidence and remaining gates. Related records must not be counted as separate savings.

### DATA-01 — implemented-actual-data-verified

publicMutation policy/account/token admission

Evidence: [implementation-data.md](implementation-data.md), [evidence/implementation-data-public-race.json](evidence/implementation-data-public-race.json).

- Broader real HTTP endpoint schedules and password/role race acceptance; no claim of exhaustive concurrency schedules.

### DATA-02 — partial-admin-occurrence-and-boundary-verified

Shared full/narrow sequence SQL, fresh exact-occurrence validation for ordinary and bulk commands, and policy/account fencing for boundary changes.

Evidence: [implementation-data.md](implementation-data.md), [evidence/implementation-sequence-canonical-actual.json](evidence/implementation-sequence-canonical-actual.json), [evidence/implementation-sequence-boundary-lock-actual.json](evidence/implementation-sequence-boundary-lock-actual.json), [evidence/implementation-sequence-entry-plan-actual.json](evidence/implementation-sequence-entry-plan-actual.json), [implementation-ancestor-aggregation.md](implementation-ancestor-aggregation.md), [implementation-ancestor-aggregation.json](implementation-ancestor-aggregation.json), [implementation-found-24.md](implementation-found-24.md), [implementation-found-24.json](implementation-found-24.json).

- Existing shared sequence repair gains11unique native controlled-admin DEFAULT/current mutation pairs plus4positive saved-boundary lock cases: repeated/nested paths, playlist occurrences, rewatch/backdated/drop and stale/source-replaced atomic errors pass.
- Bulk1full census+3narrow versus5full expansions; ordinary0full+1narrow. Event identity, logical tracking/events/userQueue/rewatch/list state match, with original baseline/current dependency boundary explicit.
- Outbox comparison is count-only; complete outbound payloads/every trigger/revision table, browser/API/transport, arbitrary concurrency and sustained resources remain unaccepted. Additional ancestor observation08 retains its separate earlier scope.

### DATA-03 — implemented-admin-actual-catalogue-verified

Set-based changed-position removal/reorder under existing owner/list locks; absent removal and identical order skip side effects.

Evidence: [data-api.md](data-api.md), [data-api-findings.json](data-api-findings.json), [implementation-found-01.md](implementation-found-01.md), [evidence/implementation-found-lists-actual.json](evidence/implementation-found-lists-actual.json), [implementation-found-22.md](implementation-found-22.md), [implementation-found-22.json](implementation-found-22.json).

- Controlled admin/real-catalogue acceptance is verified; no naturally observed workload, arbitrary concurrent/commit/reconnect, remote delivery, production tails or heap/CPU claim.
- 32native comparisons,4exact advisory-lock checks, row/statement bounds pass; global WAL samples increase and are not attributable production WAL. No universal resource gain claimed.

### DATA-04 — partial-actual-data-verified

Reuse base-card hydration only within one detailsData composition, preserving ordered identity remapping and fresh sequence-occurrence copies. All12 actual full DTOs matched across4owners and829episode season/23member collection/member detail. Explicit presentation demand now skips hidden episode/season/member/related hydration only for isolated Reviews/Credits/Activity, through signed/public routes, panel and every enhancement reread. Default/overview/insights/ordinaryAPI remain complete. Unsupported collection titleInsights now returns its existing null before unused identity/region/adapter setup, after feature and media404 admission.

Evidence: [implementation-detail-hydration.md](implementation-detail-hydration.md), [implementation-detail-hydration.json](implementation-detail-hydration.json), [next-detail-section-demand.md](next-detail-section-demand.md), [next-detail-section-demand.json](next-detail-section-demand.json), [evidence/detail-section-demand-panel-promotion.json](evidence/detail-section-demand-panel-promotion.json), [evidence/implementation-section-demand-normal.json](evidence/implementation-section-demand-normal.json), [collection-insights-admission.md](collection-insights-admission.md), [collection-insights-admission.json](collection-insights-admission.json), [evidence/implementation-collection-admission-normal.json](evidence/implementation-collection-admission-normal.json).

- Default eager detail payload and rendering remain:829episodes/about1.49MB. Isolatedsection compact reads now preserve allretained fields and reduce first-owner seasonmembership830→1/ORM248→38/DTO1490119→3437JSONbytes; no DOM/heap/CPU/wire/latency claim.
- Actual30 comparisons cover12signed-infull+12compact+3guestfull+3compact; completefullDTOorder/occurrences and compactretainedfields/independentnext match. Actual nested/multi-parent/repeated/missing-child and freshprovider positive cohorts remain absent.
- 7protocolcontrols94assertions and6compiledpanelcontrols37assertions are supplementary; currentnormalUIsectionacceptance recordedseparately. Truecomplete-summary/filter-aware paging and retainedDOM bounds still requireanexplicitdesignchoice.
- Early collection guard: four actual Trakt null pairs use2→1ORMreads; actual nonmedia service404 is unchanged. Normal authenticated actual collection GETs return JSON null for both supported sources. Failed isolated TMDB classifier trial remains failed; configured-provider setup, denied-screen and missing-identity cohorts remain unaccepted.

### DATA-05 — partial-actual-state-admission-verified

Add one necessary-condition state filter, retaining every direct or inherited canonical replay boundary so event-derived progress cannot be lost.

Evidence: [implementation-continuation-admission.md](implementation-continuation-admission.md), [implementation-continuation-admission.json](implementation-continuation-admission.json), [implementation-found-07.md](implementation-found-07.md), [implementation-found-07.json](implementation-found-07.json).

- All184actual complete planner/DTO/hero/cross-profile outcomes and ordered sequence Maps match. Reject69,503unused states across4owners before effective replay projection; statements and outputs unchanged.
- Descendant scans, full card hydration and repeated plans remain. Saved rewatches/started playlists/dropped states are absent;17tableless correctness cases are supplemental.
- Four alternating full-owner pairs show modest local median587.39→548.59ms; one pair slower and shared read blocks increase in one plan. No CPU/heap/universalI/O/tail claim.
- Three additional actual Collection traversal candidates remain unadopted: first188complete outcomes match but large-history work regresses; next two4-owner complete continuation comparisons reduce buffers with mixed timing. Production continuation SQL is unchanged. No missing replay/playlist/drop/topology cohorts fabricated.

### DATA-07 — partial-profile-noop-and-feature-bindings-actual-rollback-verified

Retain all validation, row lock and GIF effects; guard the final complete settings UPDATE with IS DISTINCT FROM so identical values retain their tuple. Catalogue feature conflict uses the inserted native object once; reading uses inserted features in SET and existing distinctness predicate, preserving omitted input, no-op rules and timestamps. Shared updateList now skips an identical normalized name/description after the existing owner lock and playlist validation; saved-list positive acceptance remains absent. Shared updatePlaythrough now returns unchanged normalized locked state before UPDATE/projection/webhook; shared Up Next queues projection only for affected INSERT/DELETE membership.

Evidence: [implementation-profile-write.md](implementation-profile-write.md), [implementation-profile-write.json](implementation-profile-write.json), [evidence/implementation-profile-write-actual.json](evidence/implementation-profile-write-actual.json), [next-catalogue-feature-parameter.md](next-catalogue-feature-parameter.md), [next-catalogue-feature-parameter.json](next-catalogue-feature-parameter.json), [implementation-reading-feature-binding.md](implementation-reading-feature-binding.md), [implementation-reading-feature-binding.json](implementation-reading-feature-binding.json), [implementation-found-01.md](implementation-found-01.md), [implementation-found-21.md](implementation-found-21.md), [implementation-found-21.json](implementation-found-21.json), [implementation-found-25.md](implementation-found-25.md), [implementation-found-25.json](implementation-found-25.json).

- Twelve actual complete output/state/revision comparisons: nine identical submissions now affect zero users rows; three genuine existing-value controls still write. All 102 tables / 1,864,145 row values restored.
- The SQL statement/lock remain and a second settings parameter/comparison is added; no measured latency/network/WAL or content-revision gain is claimed.
- Catalogue100exactretained raw objects and reading12single-canonical-row inputs preserve fullowner outputs/state/revisions/DML. Nativefeaturebindings200→100and36→12; requiredwrites/statements/transactions unchanged. No freshproviderwire/input or measuredCPU/heap/wire/latency claim.
- Feature freshness/precedence intentionally remain. Actual empty/omitted/changed/non-TMDB catalogue and book/genres/group/alias reading positive cohorts absent; authored installed-codec controls supplement actualreplay. Other unchanged-write/batching owners remain unresolved; no actualGIFdataURL cohort fabricated.
- Batch21: game12 native before/current cases pass on one actual playthrough; four saved-value no-ops reduce6→3 statements and1→0 tuple updates, no publication invocation. Five reversible real-row controls preserve genuine updates. Active recipient/delivery/concurrency remain unverified.
- Batch21: Up Next30 actual-record rollback outcomes preserve canonical state/returns/errors;82→66 statements and24→8 projection eligibility reads. No natural saved membership or enabled projection connections; connected-provider/concurrency and latency/WAL gains remain unverified.
- Batch25:14native scenarios/214checks add the shared variant tuple IS DISTINCT FROM guard.24retained canonical replays skip2variantupdates;258statements and26canonical/26featureupdates remain. Parent/source changes, identity/private state, parentKnown and source-precedence controls match. Games/work-feature clocks remain authoritative; equal-feature write suppression is contract-incompatible. No fresh provider wire/concurrency or production latency claim.

### DATA-08 — implemented-actual-retained-snapshot-replay-verified

Existing discoverMedia owner admits a named screen bucket before provider invocation/ingestion; shared lazy discovery passes that selection, combined route retained.

Evidence: [implementation-discovery.md](implementation-discovery.md), [evidence/implementation-discovery-real-match.json](evidence/implementation-discovery-real-match.json), [evidence/implementation-discovery-real.json](evidence/implementation-discovery-real.json).

- Actual signed-in20+20renderedbucketIDs all matched35retainedworks/5overlap. Replay verified40→20metadata transactions for named demand; combined40and exactcardorder unchanged; all writes rolledback.
- Replay is actual retained normalized metadata, not the original live discovery response bodies or natural wire/latency proof. Real provider outages/Seerr response/cross-device acceptance remain.
- For You links to Discover and has no separate discovery feed; Read/Play/Listen use separate owners. Direct Watch section SSR intentionally retains combined behavior.

### DATA-09 — partial-actual-data-verified

Shared four-format byte-preserving avatar storage/stream/save/delete and bounded existing maintenance adopted; checkpointed normal0064 and3→0actual inline conversion verified.

Evidence: [data-api.md](data-api.md), [data-api-findings.json](data-api-findings.json), [avatar-storage-candidate.md](avatar-storage-candidate.md), [avatar-storage-candidate.json](avatar-storage-candidate.json), [implementation-found-12.md](implementation-found-12.md), [implementation-found-12.json](implementation-found-12.json), [implementation-found-16.md](implementation-found-16.md), [implementation-found-16.json](implementation-found-16.json).

- Normal first/repeated direct stream costs and signed-in/repeated consumers pass; browser cold/network request distributions, complete-page compressed bytes, CPU/heap/tails and actual missing format populations remain unverified.

### DATA-10 — implemented-actual-data-verified

authenticateSession fresh joined ordinary read and locked rotation reread

Evidence: [implementation-data.md](implementation-data.md), [evidence/implementation-data-actual.json](evidence/implementation-data-actual.json).

- Production load/pool-contention measurement and broader account-change race schedules; no authentication cache was introduced.

### DATA-11 — implemented-actual-data-verified

One bounded canonical category census admits only relevant existing card hydrators; explicit validation, ordering, privacy and batch bounds retained.

Evidence: [implementation-card-categories.md](implementation-card-categories.md), [evidence/implementation-card-categories-actual.json](evidence/implementation-card-categories-actual.json).

- No saved books existed; real book-card cohort remains unverified.
- Mixed all-medium pages add one query; no general wall-time gain is claimed.

### DATA-12 — implemented-admin-actual-catalogue-verified

Shared owned header read separated from full detail; playlist start reads header only, retaining UUID/ownership/type/restart admission.

Evidence: [data-api.md](data-api.md), [data-api-findings.json](data-api-findings.json), [implementation-found-01.md](implementation-found-01.md), [evidence/implementation-found-lists-actual.json](evidence/implementation-found-lists-actual.json), [implementation-found-22.md](implementation-found-22.md), [implementation-found-22.json](implementation-found-22.json).

- Controlled admin/real-catalogue acceptance is verified; no naturally observed workload, arbitrary concurrent/commit/reconnect, remote delivery, production tails or heap/CPU claim.
- Native shared header and playback first/repeat/restart API acceptance pass with exact timestamps/status/output; no actual player/provider transport is exercised.

### DATA-13 — implemented-actual-equivalence-verified-coverage-gaps

Skip page-only featured/background/settings preparation for section refreshes, retaining visibility/order/counts/paging and full page contract.

Evidence: [implementation-profile-sections.md](implementation-profile-sections.md), [evidence/implementation-profile-sections-actual.json](evidence/implementation-profile-sections-actual.json), [evidence/implementation-profile-sections-full-audience.json](evidence/implementation-profile-sections-full-audience.json).

- 212 actual outcomes and24 alternating sample pairs match; retained nearly flat favourite timing demonstrates no universal latency gain.
- Positive guest-visible, featured and pinned cohorts absent; domain comparisons and signed-in dispatch DTOs are not complete browser/route-object acceptance.
- Shared summary counts remain. Current normal profile overview/favourites panel rendered three actual cards; API-section filter/preference writes were not exercised in that browser trial.

### DATA-14 — partial-actual-data-verified

Existing per-parent eligibility repair retained; explicit-ID assessment now admits direct reasons and observed/next screen/music parent inputs through the complete existing hierarchy closure. Full/personal SQL is unchanged.

Evidence: [implementation-common.md](implementation-common.md), [evidence/implementation-collection-real.json](evidence/implementation-collection-real.json), [implementation-found-08.md](implementation-found-08.md), [implementation-found-08.json](implementation-found-08.json).

- Global edges and remaining whole-owner helpers still materialize for item assessment.
- Actual books are absent; empty comic/reading personal histories do not certify large personal-history costs.
- Two staged96complete actual outcomes preserve exact rows/reasons, all nine existing kinds,60-item batches, other viewers and real source filters. Each16-plan pilot reduces all read-buffer visits; warm medians improve14/16and15/16with adverse album/individual timings retained.
- Final authenticated normal Notifications GET returns12real notices/9media assessments.839commonpasses/type/build/inventory/style pass. Whole-consumer mutation/provider/privacy-withdrawal/concurrency and CPU/heap/production tails remain separate.

### HELPER-01 — partial-synchronous-menu-scope-reuse-actual-input-and-native-verified

Exclude only actor profile.avatar from the invalidation key, preserving every other scope dependency; no global cache or presentation change. Five existing synchronous tracked effects now pass their exact computed key to shared resource sync, avoiding duplicate serialization without changing fresh read/completion admission.

Evidence: [implementation-work-menu-scope.md](implementation-work-menu-scope.md), [evidence/implementation-work-menu-scope-actual.json](evidence/implementation-work-menu-scope-actual.json), [implementation-found-09.md](implementation-found-09.md), [implementation-found-09.json](implementation-found-09.json).

- Sixteen actual-key comparisons preserve all non-avatar values; maximum tested key16640→1385bytes. String size, not a CPU/heap/latency benchmark.
- Other settings still serialize per consumer; a minimal shared policy key remains a separate dependency/SSR/preview review.
- Current normal movie menu rendered Play/Mark watched/Collection/Favourite commands. Saved list/party/browser-scale cohorts remain absent; no cohort fabricated.
- Batch09:52 actual-input callback comparisons preserve complete resource DTOs/read/reset/warm behavior; closed key calls2→1. Native actual movie root commands reopen intact; raw menu text includes a hovered child. No CPU/heap/latency claim; natural five-family dependencies/list/party scale remain.

### HELPER-02 — implemented-regression-verified

Shared menu controllers attach breakpoint listeners only while open; closed compact reads remain fresh before nested hover/open admission.

Evidence: [implementation-ui-lifetimes.md](implementation-ui-lifetimes.md), [evidence/implementation-menu-focused-tests.txt](evidence/implementation-menu-focused-tests.txt), [evidence/implementation-normal-dev.json](evidence/implementation-normal-dev.json).

- Actual desktop nested open/Escape/focus passed. Actual resize/hover transition remains; controlled nested responsive regression passed.
- No measured CPU/heap saving claim; closed controller retains one MediaQueryList object.

### HELPER-03 — implemented-regression-verified

Recheck stopped/aborted owner immediately after await before publishing status or refreshing friends

Evidence: [implementation-common.md](implementation-common.md), [evidence/implementation-unit.log](evidence/implementation-unit.log).

- Actual two-account presence replacement/hidden/resume trace

### HELPER-04 — implemented-actual-labels-verified-scale-gap

Compute destination multiplicity once per accessed request snapshot, reused by all three menu and confirmation label sites.

Evidence: [implementation-request-scope.md](implementation-request-scope.md), [evidence/implementation-request-scope-actual.json](evidence/implementation-request-scope-actual.json), [evidence/implementation-owner-batch-normal.json](evidence/implementation-owner-batch-normal.json).

- All 39 saved request labels and 38 active-state labels match. Active groups have only one request, so no observed active-menu scan gain.
- No actual 4K or multiple-destination active menu; authored wording/reactive snapshot tests are supplementary. Existing Requests grid wording preserved.

### HELPER-05 — implemented-regression-verified

Queue actions use the captured client feedback owner, isolating preview notifications from the application.

Evidence: [implementation-ui-lifetimes.md](implementation-ui-lifetimes.md), [../../../tests/ui-queue-actions.test.ts](../../../tests/ui-queue-actions.test.ts).

- Three controlled scope/concurrency/failure tests pass with19assertions; supplementary correctness evidence.
- Existing actual Tasks read/filter/navigation acceptance is retained separately. No actual job was retried/cancelled/promoted just to produce a toast, so actual task-action acceptance remains.

### MIN-01 — implemented-actual-equivalence-verified-scale-gap

Hydrate the requested twelve-game preview before presentation; preserve default sixty-game paging and ranked search.

Evidence: [implementation-game-preview.md](implementation-game-preview.md), [evidence/implementation-game-preview-actual.json](evidence/implementation-game-preview-actual.json), [evidence/implementation-owner-batch-normal.json](evidence/implementation-owner-batch-normal.json).

- 332 complete actual DTO comparisons pass; actual status cohort has only one dropped game, other statuses empty. No observed busy-status preview gain.
- No positive reduced-head private preferences or variant inheritance cohort; current signed-in functional acceptance passed; no browser scale/cancellation benchmark.

### MIN-02 — implemented-actual-data-verified

Deduplicate whole-work and parent hydration in one batch; filter back to original parent targets before action composition.

Evidence: [implementation-menu-context.md](implementation-menu-context.md), [evidence/implementation-menu-context-actual.json](evidence/implementation-menu-context-actual.json), [evidence/implementation-owner-batch-normal.json](evidence/implementation-owner-batch-normal.json).

- 31 complete actual menu responses and two validation contracts match; episode/season cohorts remove sixteen ORM statements. Timings are descriptive only.
- No actual franchises or selected active rewatches; no concurrent changing-parent graph proof. Current signed-in movie and episode menu functional acceptance passed.

### MIN-03 — partial-actual-data-verified

Shared bounded identity projection for public catalogue single/list, accessible Library and Collection; full cards/progress retained.

Evidence: [data-api.md](data-api.md), [data-api-findings.json](data-api-findings.json), [implementation-work-summaries.md](implementation-work-summaries.md), [evidence/implementation-summary-avatar-normal.json](evidence/implementation-summary-avatar-normal.json), [implementation-found-25.md](implementation-found-25.md), [implementation-found-25.json](implementation-found-25.json).

- Prior133actualcomplete outcomes remain. New11native policy/DTO pairs with61checks close original-title, private-alias/lock, administrator locked/unlocked override, guestprivacy and nonscreenalias controlled-positive gaps using actualadmin/movie/music.
- No book cohort or existing bearer-token/quota HTTP acceptance is claimed; native controlled owner proof is separate from normal-browser/authenticated HTTP acceptance.

### MIN-04 — partial-actual-data-verified

Shared notification preference projection in notifyMany/broadcast only; per-source recipient batching not adopted.

Evidence: [data-api.md](data-api.md), [data-api-findings.json](data-api-findings.json), [implementation-notification-preferences.md](implementation-notification-preferences.md), [next-notification-batch.md](next-notification-batch.md), [implementation-found-23.md](implementation-found-23.md), [implementation-found-23.json](implementation-found-23.json).

- Original direct notifyMany proposal tested with actual admin and4passive recipients: stable values/upsert identity match; statements12→3, but preference timing and later-write surviving prefix differ. Candidate rejected, default retained; no alternative investigation.
- All518original notices/preferences/config restored; no delivery. Earlier shared notification preference projection remains applied. Preparation/lost-ack and100-recipient scale acceptance are unrun after required contract failure.

### MIN-05 — partial-actual-data-verified

Measure database ping immediately after SELECT1, excluding later action/provider aggregate work; preserve authorization/order/failure behavior.

Evidence: [implementation-recovery-lifetimes.md](implementation-recovery-lifetimes.md), [evidence/implementation-recovery-actual.json](evidence/implementation-recovery-actual.json), [evidence/implementation-owner-batch-normal.json](evidence/implementation-owner-batch-normal.json), [implementation-found-25.md](implementation-found-25.md), [implementation-found-25.json](implementation-found-25.json).

- Actual restored administrator corpus verifies exact aggregate values and read order; current signed-in Admin health functional acceptance passed.
- Full-history outbox aggregation is unchanged; count snapshots or changed readiness semantics need a separate option.
- Batch25 original aggregate-plan measurement: action count125rootsharedblocks,6.124ms singlelocal sample; provider aggregate2blocks. Keep unchangedcountquery; no freshness-changing snapshotcache justified or adopted.

### MIN-06 — implemented-admin-actual-catalogue-verified

Share exact canonical tracking consumption predicate with the Continue Undo snapshot, narrowing its pre-mutation queue read; final removed-ID filter and transaction/event/undo semantics preserved.

Evidence: [data-api.md](data-api.md), [evidence/implementation-continue-queue-census.json](evidence/implementation-continue-queue-census.json), [probes/continue-queue-census.ts](probes/continue-queue-census.ts), [implementation-found-02.md](implementation-found-02.md), [evidence/implementation-found-consumption-actual.json](evidence/implementation-found-consumption-actual.json), [implementation-found-22.md](implementation-found-22.md), [implementation-found-22.json](implementation-found-22.json).

- Controlled admin/real-catalogue acceptance is verified; no naturally observed workload, arbitrary concurrent/commit/reconnect, remote delivery, production tails or heap/CPU claim.
- 4lifecycle pairs/78checks plus3concurrency pairs/37checks pass. Preexisting post-snapshot concurrent enqueue/Undo behavior is separately CONTINUE-UNDO-RACE-OBS-14; baseline equivalence is not a lossless-Undo claim.

### MIN-07 — partial-planning-friend-admission-actual-verified

Batch existing bounded friend admission at its shared social owner, retaining separate preflight and transactional checks and original singleton callers.

Evidence: [implementation-planning-admission.md](implementation-planning-admission.md), [implementation-planning-admission.json](implementation-planning-admission.json), [implementation-found-25.md](implementation-found-25.md), [implementation-found-25.json](implementation-found-25.json).

- Prior singleton/batch admission remains.9new fullnativeAPI/domain pairs preserve complete plan/reminder fields/payloads/associations, notifications, policy ordering, errors and rollback. Controlled actualadmin Planning enabled only on ownedcopy;3real passivefriends/actualmovie.
- Valid14→10statements, repeated16→10; nofriends8→8. Friends/party withdrawal, raw21, cap100 and nativeoutboxfailure match. Native reminder worker/delivery was not run.
- Reminder batching remains contract-incompatible and not adopted; each phase remains one statement snapshot rather than evolving serialreads. No production timing/CPU/heap claim.

### MIN-08 — implemented-completed-actual-cohorts-verified

Reuse the calculation-local right-hand feature Map for exact overlap membership and existing cosine calculation.

Evidence: [implementation-taste-overlap.md](implementation-taste-overlap.md), [evidence/implementation-taste-overlap-actual.json](evidence/implementation-taste-overlap-actual.json).

- 40 of64 planned complete comparisons matched across10 actual owner/viewer contexts. Capture was intentionally cancelled during a later insights SELECT; runner exit1 is retained.
- No two-sided positive affinities for themes/developers/publishers/mechanics/perspectives in completed data. No latency gain for every small/empty cohort is claimed.

### PLAN-02 — partial-actual-data-verified

Earlier unused fallback probes remain suppressed. Exact scoped work/artist/group/ID admission now runs before policy/enrichment at shared activityFeed, preserving unscoped SQL and original semantics; no history cap, cache, schema or UI change. Statement-local authoritative permission keys now remove repeated per-event policy evaluation for all shared feed consumers; scoped admission, parent fallback guard and selective reasons remain.

Evidence: [implementation-activity-feed.md](implementation-activity-feed.md), [implementation-activity-feed.json](implementation-activity-feed.json), [scoped-activity-attribution.md](scoped-activity-attribution.md), [scoped-activity-attribution.json](scoped-activity-attribution.json), [next-scoped-activity-workset.md](next-scoped-activity-workset.md), [next-scoped-activity-workset.json](next-scoped-activity-workset.json), [implementation-scoped-activity-workset.md](implementation-scoped-activity-workset.md), [implementation-scoped-activity-workset.json](implementation-scoped-activity-workset.json), [evidence/implementation-activity-workset-normal.json](evidence/implementation-activity-workset-normal.json), [implementation-found-27.md](implementation-found-27.md), [implementation-found-27.json](implementation-found-27.json).

- Historical V2 proof passes64complete actual response/ordered-row pairs,34unscoped SQL identities,16plans and4alternating sample pairs. All7work scopes reduce root shared accesses and all8plan pairs retain baseline temporary counters; explicit-ID pair has no gain.
- Current maintained actual-only admission regression separately passes16complete ordered-ID comparisons on adopted source, with RRread-only rollback/closed pool. Positive direct-member collection and artist/group-overlap cohorts are absent, not manufactured.
- Normal Watching→Watched empty→Watching and12-card inbox checks pass; full Back acceptance is partial with mixed outcomes and no causal trace.
- Current policy-key repair passes 28 complete native benchmark pairs, 22 full privacy/filter DTO/error pairs, two actual admission regressions and signed-in normal global/item rendering. All/screen medians 9.20/9.40→0.93/0.65s versus immediately before repair; small-item gains are limited and empty relationship +16ms is retained. Extra 4,997kB hash / 422 temporary blocks each direction is documented.
- Finite acceptance only: concurrent load/revocation, growth of complete history, browser heap/frame budgets, positive direct-member collection and artist/group overlap, full reading-group DTO and other absent media/event shapes remain. No cross-request policy cache or history cap was introduced.

### PLAN-03 — partial-actual-data-verified

Shared Taste feature candidate membership uses EXISTS instead of materializing every matching probe; all metadata-provider identities, rank priorities and500-per-medium cap preserved.

Evidence: [data-api.md](data-api.md), [data-api-findings.json](data-api-findings.json), [implementation-interest-fallback.md](implementation-interest-fallback.md), [implementation-recommendation-scoring.md](implementation-recommendation-scoring.md), [taste-query-measurement.md](taste-query-measurement.md), [taste-query-measurement.json](taste-query-measurement.json), [implementation-found-17.md](implementation-found-17.md), [implementation-found-17.json](implementation-found-17.json), [implementation-found-18.md](implementation-found-18.md), [implementation-found-18.json](implementation-found-18.json), [implementation-found-20.md](implementation-found-20.md), [implementation-found-20.json](implementation-found-20.json).

- Four actual enabled owners preserve complete inputs/profiles/ordered candidates/pure scores in first and adopted-source proofs. Both improve all four warm medians; adopted plans have3lower/1equal root read-buffer totals and no observed temp spill. First individual adverse plan/timings retained.
- Staleness split remains rejected. Broader media/metadata scans, full worker publication/lease/restart/concurrent revisions, absent natural policies/book/provider/growth cohorts and CPU/heap/pooled/whole-worker tails remain unresolved.
- Batch18: four further query shapes preserve all actual inputs/ordered candidates/pure scores but every family regresses warm medians. Grouped arrays lower buffers slightly; early distinct, lateral fence and coarse bound filter increase work, with lateral spills. Live GIN exists/valid/ready; no tested candidate uses it. Keep batch17; all four prototypes remain unapplied.
- Batch20 finishes copied index/parallel-work investigation; neither fence nor materialization is adopted. Keep accepted EXISTS owner; no further variant exploration in this pass. Publication/leases/restart/concurrent revisions and absent cohorts remain unverified.

### PLAN-04 — partial-actual-data-verified

Preaggregate DISTINCT evidence-genre weights once, then score each candidate genre occurrence with unchanged caps, ordering and other arithmetic. All9543 actual preselected candidates/scores across8 contexts and one60-item full DTO matched.

Evidence: [implementation-recommendation-scoring.md](implementation-recommendation-scoring.md), [implementation-recommendation-scoring.json](implementation-recommendation-scoring.json).

- Broader candidate preparation, author/series/provider/taste scoring and their resource costs remain.
- Actual positive game genre evidence and sufficiently rich reading/music genre cohorts remain unavailable.
- One source-shaped plan is descriptive, not a production latency distribution; future fractional weight changes require renewed score equivalence.

### PLAN-05 — partial-interest-input-actual-verified

Admit album-parent fallback only when neither episode nor season has already resolved a show root, preserving COALESCE/order/weights/caps and all four callers.

Evidence: [implementation-interest-fallback.md](implementation-interest-fallback.md), [implementation-interest-fallback.json](implementation-interest-fallback.json).

- Fiveactual complete ordered personal/global interest outputs match1018objects;6actualalbumfallback signals remain. Largest personal parent scans11650→639/global20336→1172. Singleplan elapsed samples are not latency distributions.
- Feed subject fan-out/adjacency reads/definition cardinality remain; no reuse/cache or provider job run. Tableless ancestry/mixed-fold controls supplement absent natural multiple-album-parent/mixed-sign cohorts.
- PLAN03receives the same input-owner benefit; its staleness and candidate ranking access paths remain open and must not count this gain twice.

### PLAN-06 — partial-actual-data-verified

Materialize the complete Collection intermediate once inside the existing shared demandStatement before joining needed assessments. All76 actual complete response pairs match; default temporary reads2003226→55900 with explicit small-account/materialization tradeoffs.

Evidence: [implementation-demand-materialization.md](implementation-demand-materialization.md), [implementation-demand-materialization.json](implementation-demand-materialization.json), [evidence/admin-demand-actual.json](evidence/admin-demand-actual.json).

- Only4actual consenting accounts; no large consenting-user/disabled/withdrawal cohort was manufactured.
- Counts/paging/source/request arrays and query-time semantics are preserved; no count/detail split, durable cache or global planner tuning.
- Some PostgreSQL temporary-write/read counters increase with materialization. Default/large work reduction is established, not universal I/O/heap/tail improvement.
- Live Admin/API auth, concurrent policy changes and production resource distributions remain separate acceptance.

### PLAN-08 — partial-actual-data-verified

Shared genreRows admits snapshot fallback only when both override and media genres cannot supply the result.; selected-genre summary now shares dated history and genre membership inside one SQL statement, leaving unfiltered SQL unchanged. Daily/genre activity aggregates now share exact dated history in one statement; Profile committed period stays with its values. Exact unfiltered favourite total now shares existing membership aggregate; filtered count SQL/bindings remain identical. Adjacent-period history is shared once; season early admission is reverted after higher read-buffer work.

Evidence: [data-api.md](data-api.md), [data-api-findings.json](data-api-findings.json), [implementation-profile-genres.md](implementation-profile-genres.md), [evidence/implementation-summary-avatar-normal.json](evidence/implementation-summary-avatar-normal.json), [implementation-found-07.md](implementation-found-07.md), [implementation-found-07.json](implementation-found-07.json), [implementation-found-10.md](implementation-found-10.md), [implementation-found-10.json](implementation-found-10.json), [implementation-found-11.md](implementation-found-11.md), [implementation-found-11.json](implementation-found-11.json), [implementation-found-13.md](implementation-found-13.md), [implementation-found-13.json](implementation-found-13.json), [implementation-found-14.md](implementation-found-14.md), [implementation-found-14.json](implementation-found-14.json), [implementation-found-15.md](implementation-found-15.md), [implementation-found-15.json](implementation-found-15.json), [implementation-found-19.md](implementation-found-19.md), [implementation-found-19.json](implementation-found-19.json).

- Actual72complete outcomes match; largest snapshot indexloops10779→136. SingleafterEXPLAINwalltimewasworse; reducedreadwork is not universal speed.
- Repeated watch-history aggregates remain a separate measurement lead. Explicit empty override behavior has source/guardedfixture coverage but0actualoverride cohort; newDBcorrectness regression isguardedskip, neverrunonactualclone.
- Later shared genre-history reuse:108complete actual outcomes across four owners match; all8genre plans reduce read-buffer visits. Four-pair warm SQL medians improve, with a slower individual EXPLAIN and unchanged unfiltered timing variation retained. Final839commonpasses/type/build/inventory/style and signed-in actual Other-history rendering pass. Separate activity statements/broader aggregation/resources remain unresolved.
- Batch10:36complete actual activity outcomes/privacy errors match across four owners/three periods/viewers.12history families use2→1statements, fewer buffer visits and lower warm local medians; natural pool concurrency/CPU/heap and other counts/previous-history/season work remain. Final841commonpasses and actual owner/visitor period/panel acceptance; preference-save side effect and pending-control proof limits recorded.
- Batch11:192complete actual favourites section outcomes/privacy errors match. Four all/all count families use2→1statements and fewer buffer visits/lower warm medians;60filtered SQL/parameter families exactly unchanged. Unconditional merge rejected after15/64buffer regressions. Final841commonpasses and normal three-item ordered panel pass. Other resource/concurrency/absent cohorts remain.
- Batch13: only required day/genre materialization fields;36complete actual outcomes/privacy errors and normal Year panel pass;12plans WindowAgg2→1/estimatedwidth176→32, buffers equal and11/12warm medians improve. Other read/concurrency/resource/growth gaps remain; this is not whole-Profile completion.
- Batches14/15:36complete actual outcomes each and12complete season lists. Batch14reduces changed-query buffers and warm medians. Season candidate warm medians improve12/12but buffers rise11/12; reverted pending cold resource evidence. Normal Year panel +844common passes. Wider query/resource/concurrency/growth acceptance remains partial.
- Batch19boolean-only candidate:36complete actual output/privacy outcomes and12complete season lists match; live watched NOT NULL; all12buffers equal and8/12warm medians improve. Unapplied because performance remains inconsistent; no row/date admission changes.

### PLAN-09 — open

Partial shared repairs applied at publicLibrary seed/closure and Watch libraryData canonical membership/count/page owners. Other numbered-page, progress/window/ordered-access and closure/count pressure remains open.

Evidence: [data-api.md](data-api.md), [data-api-findings.json](data-api-findings.json), [numbered-page-attribution.md](numbered-page-attribution.md), [numbered-page-attribution.json](numbered-page-attribution.json), [public-edges-materialization.md](public-edges-materialization.md), [public-edges-materialization.json](public-edges-materialization.json), [public-edges-multiset-pilot.md](public-edges-multiset-pilot.md), [public-edges-multiset-pilot.json](public-edges-multiset-pilot.json), [public-edges-resource-verification.md](public-edges-resource-verification.md), [public-edges-resource-verification.json](public-edges-resource-verification.json), [implementation-public-seed.md](implementation-public-seed.md), [implementation-public-seed.json](implementation-public-seed.json), [implementation-library-membership.md](implementation-library-membership.md), [implementation-library-membership.json](implementation-library-membership.json), [library-server-range.md](library-server-range.md), [library-server-range.json](library-server-range.json), [implementation-found-02.md](implementation-found-02.md), [implementation-found-02.json](implementation-found-02.json), [implementation-found-03.md](implementation-found-03.md), [implementation-found-03.json](implementation-found-03.json), [implementation-found-04.md](implementation-found-04.md), [implementation-found-04.json](implementation-found-04.json).

- Actual 20-owner-call/20-plan attribution passes six complete last/far-clamped DTO comparisons. Natural depth: UI Library45 pages/2,680 titles; public observed Library650/38,952; Profile History180/10,779; screen audit History542/32,482. Native timestamp ties and canonical UUID/event-ID order are preserved.
- Whole-plan work exists on page one: UI count and every selector each use 319,059 root shared accesses; public combined query uses 176,615 and 4,897/7,733 temp blocks at every measured position. Profile count/page windows repeat; audit late sorts spill while first page does not.
- Inspect shared membership, recursive edge reuse, recorded-watch count/page composition and ordered audit access with complete before/candidate proofs. OFFSET conversion alone does not address the measured common work; no source/index/cursor change was adopted at that attribution checkpoint; later partial query applications are recorded below.
- Default owner/self filters only. Deep music/reading journals, custom lists, every filter/privacy/source variant, live count/page races, token HTTP and browser navigation remain separate gaps.
- Public Library materialization preserves142unique actual DTO/primary pairs across4owners/9sources;65planpairs retain57mixed-resource cases and2Steam temp-write regressions. Unconditional fence unadopted.19comparisons include inheritedselectedaccess; allactualfeatureflagstrue, no books/cycles/disabled-feature/tokenHTTP proof. Redundant edge dedup is a separate next hypothesis.
- Separate edge-multiset candidate retains recursive identity UNION and4actual full pairs, with more sharedvisits but much lower temporaryIO. CPU/RSS/alternatingelapsed and its own broader proof remain needed before adoption; materialization142pairs do not transfer.
- Candidate-specific142full pairs plus24CPU/8memory trials verify positive resource gains, but65planpairs catch5empty-seed cases with+3081visits/+739tempreads/+1257tempwrites. Unconditionalrewrite unadopted. Testgenericzero-seedguard; do nottransferpositiveprofiletoemptyorHTTPcohorts.
- Guarded seed is separately applied after142actual full pairs/65plans/54fresh CPU+smaps trials, nine imported-main actual pairs and current common/normal smoke acceptance. Five earlier empty graph regressions avoided. Preserve96KiBretainedcapacity cost, positive sharedvisit increases and tinyempty CPU/elapsed limits. Other count/window/orderedaccess owners, futuregrowth and bearerHTTP remainopen.
- Watch membership query applied after260actual inputs/166SQLtuples,57planfamilies/171plans,30fresh resource trials,two13case imported-main passes andfinaltype-erasure/common/normal acceptance. Positive primary CPUroughlyhalved; defaultprivateDirty/RSS/PSS andtinyempty adverses retained. Progress still2.34s medianCPU. Separate eightWatchrange comparisons/20pages1200cards pass,butAPI/client/othermedia/rangeresources unadopted.
- Shared Progress CASE and Profile recorded-History count/page reuse are now applied with their own12/25actual complete comparisons, resource plans and final828/0/common/normal acceptance. Audit history, other owners/range, growth/native-memory and missing boundary cohorts remain separate.
- Shared mediaHistory scope/count/page now applied after10actual raw/hydrated pairs over32482events/542pages, four owners and empty title. Primary2→1;33359→32336rootvisits;deep temp spill unchanged. Current normal raw/hydrated7page scope and831/0common gates pass. Other history/resource/growth contracts remain.
- Later bounded range API/source adoption is now applied across all four Library media and Collection.32actual canonical DTO pairs/four owners preserve native counts/order; Watch51→49, Play12→8, positive screenCollection66→62 and gameCollection18→14ORMstatements for three-page requests. Read is one natural12-comic page and stays5→5. No new CPU/heap/latency claims, and correct multi-page refresh is not benchmarked against the old broken one-page reset.

### PJ-01 — implemented-actual-byte-replay-verified

One shared artwork flight owner gives each authorized caller an independent wait and aborts underlying work only after the last interested caller leaves; both private relays use it.

Evidence: [implementation-artwork.md](implementation-artwork.md), [evidence/implementation-artwork-real-cache.json](evidence/implementation-artwork-real-cache.json), [implementation-artwork-cache-recovery.md](implementation-artwork-cache-recovery.md), [evidence/implementation-artwork-real-cache-final.json](evidence/implementation-artwork-real-cache-final.json).

- Actual authorized private WebP and actual cached publicJPEG lifecycle/cache replay passed; fault schedules are controlled, not natural concurrent provider timing.
- Final complete gates and signed-in source-stable browse acceptance are still pending for the latest source.
- No new private aggregate download/resource budget was selected; malformed on-disk cache repair remains a separate source-only recovery candidate.

### PJ-02 — partial-regression-verified

Companion controller selects the winning inert Lazy<Task> before crop process admission and removes failed work only by exact key/value identity.

Evidence: [providers-jobs.md](providers-jobs.md), [providers-jobs-findings.json](providers-jobs-findings.json), [implementation-plugin-crop.md](implementation-plugin-crop.md).

- No current Coast main-app caller uses TrailerCrop, so no current UI gain is claimed.
- Controlled exact-controller/process fault tests and plugin build do not establish actual trailer/FFmpeg/Jellyfin production acceptance. Global crop concurrency/retention budget remains PJ-03.

### PJ-06 — partial-shared-identity-batch-actual-verified

Canonical500-tuple ordinal identity reader shared by scalar exports, captured list payloads and desired Collection projection, with exact existing alias validation and UUID casts.

Evidence: [providers-jobs.md](providers-jobs.md), [providers-jobs-findings.json](providers-jobs-findings.json), [implementation-found-03.md](implementation-found-03.md), [implementation-found-03.json](implementation-found-03.json).

- 1249actual identity objects, every746naturally multi-alias work/kind, missing/duplicate/uppercase controls match;1249→3statements. Actual757-entry personal desired projection matches759→4statements with transaction-wrapper boundary documented.
- Actual saved lists are absent. Positive remote list export/retry/uncertain-create, no-op converged list delivery, import identity resolution/traversal and provider/concurrency acceptance remain open. No CPU/heap/wire/latency gain inferred from query counts.

### PJ-08 — partial-shared-import-batching-admin-actual-data-verified

Shared imported-listen owner inserts up to100 deterministic occurrences per statement, updates progress for inserted rows only and retains native per-occurrence webhook order within the existing transaction.

Evidence: [providers-jobs.md](providers-jobs.md), [providers-jobs-findings.json](providers-jobs-findings.json), [implementation-found-23.md](implementation-found-23.md), [implementation-found-23.json](implementation-found-23.json).

- Exact final-source43native checks and30occurrence/effect checks pass; 10,000-listen statements30,031→10,231, history INSERTs10,000→100, progress writes10,001→101.
- Whole track still writes10,000history rows in one transaction. Resumable partial history/progress requires fenced pending-target/checkpoint semantics; no new durable contract adopted.
- Finite no-subscription elapsed improves28.58→19.10s, active-subscription205-occurrence sample worsens728→1,012ms. No universal latency, CPU/heap, live-provider or contention claim.

### PJ-11 — implemented-actual-data-verified

Immutable job snapshot remains unchanged; bounded checkpoint carries cursor/added counter under the existing job fence.

Evidence: [implementation-providers.md](implementation-providers.md), [evidence/implementation-providers-real-steam.json](evidence/implementation-providers-real-steam.json).

- Staged snapshot derived from retained actual observations; fresh live Steam ownership response not replayed.
- No latency or cluster-WAL gain claimed from one sequential first-chunk sample.

### PJ-12 — partial-shared-conflict-summaries-admin-actual-verified

Shared conflict reader uses local counts and narrow browser list summaries; shared formatter preserves exact wording and existing controls. Authoritative complete approval evidence/read owners remain unchanged.

Evidence: [providers-jobs.md](providers-jobs.md), [providers-jobs-findings.json](providers-jobs-findings.json), [implementation-found-24.md](implementation-found-24.md), [implementation-found-24.json](implementation-found-24.json).

- Native103conflict comparison and6native accepted/ignored huge/fresh/unsupported outcomes match; DTO916585→61091bytes, native statements205→104. Final type-only assertion erases identically; integrated gates pass.
- Deterministic pagination/selected full-detail API and lifetime contract, visible scalar batching, mounted positive browser/DOM/memory and active Trakt export acceptance remain unverified. Current normal authenticated empty screen/navigation/console pass; no normal writes.

### PR-01 — implemented-actual-acceptance-pending

Per-book EPUB asset/CSS URL owner installed at library replacements boundary

Evidence: [implementation-playback.md](implementation-playback.md), [implementation-playback.json](implementation-playback.json), [evidence/implementation-playback-focused-tests.txt](evidence/implementation-playback-focused-tests.txt).

- No actual private EPUB/browser RSS/worker plateau certification
- Pinned library internal seam requires regression on dependency changes

### PR-03 — implemented-actual-acceptance-pending

Reader presentation AbortController and heartbeat admission

Evidence: [implementation-playback.md](implementation-playback.md), [implementation-playback.json](implementation-playback.json), [evidence/implementation-playback-focused-tests.txt](evidence/implementation-playback-focused-tests.txt).

- Common request deadline/write acknowledgement work remains PR-02
- Actual long-lived visible-reader trace pending

### PR-04 — partial-regression-verified

Existing API/SSR read signal through music/trailer service, adapter and provider queue

Evidence: [implementation-playback.md](implementation-playback.md), [implementation-playback.json](implementation-playback.json), [evidence/implementation-playback-focused-tests.txt](evidence/implementation-playback-focused-tests.txt).

- Shared artwork flight ownership PJ-01
- Shared metadata and matching-reading per-consumer cancellation
- Actual canceled live-provider traces pending
- Already admitted SQL is not made cancelable

### PR-05 — partial-actual-snapshot-binding-verified

Reuse excluded.snapshot for the conflict SET so each full shared snapshot is bound once, retaining lastSeenAt and every identity/metadata/edition/artist/member/access/lease owner.

Evidence: [implementation-music-snapshot-binding.md](implementation-music-snapshot-binding.md), [implementation-music-snapshot-binding.json](implementation-music-snapshot-binding.json).

- All959actualretainedsnapshot results plus2existing50itemaccesscohorts match complete table state/orderedalbums/tupleDML;102tables1864145rowsandsequences restored. Snapshot bindings1918→959, serialized parameter-size proxy1829114→914557bytes.
- No transaction/statement/tuplewrite or latency/heap/wire claim. Existing rich metadata no-op guard already works for959items;0actual sparse optional-field false-update positives.
- No captured current providerpage, repeated-edition/newsource structural race or live sync acceptance. Fixed private observation clock/savepoint rollback changes lock-release schedule and is not production-concurrency proof. Broader page batching/structural admission remains unresolved.

### PR-07 — partial-regression-verified

Worker-owned ComicDecoder physical index map

Evidence: [implementation-playback.md](implementation-playback.md), [implementation-playback.json](implementation-playback.json), [evidence/implementation-playback-focused-tests.txt](evidence/implementation-playback-focused-tests.txt).

- Native rewind/replay complexity unchanged
- Actual-file latency/memory comparison still required

### PR-09 — partial-actual-data-and-live-verified

Reuse one freshly verified Jellyfin reading context within each stream request; public ownedReadingSession row contract and independent fresh request admission retained.

Evidence: [playback-readers.md](playback-readers.md), [playback-readers-findings.json](playback-readers-findings.json), [implementation-reading-context.md](implementation-reading-context.md), [evidence/implementation-context-material-normal.json](evidence/implementation-context-material-normal.json).

- Current frozen-source normal5173 actual linked CBR opened, decoded1988x3057, turned3→4→3of23, minimized/resumed/closed; final comic/Blob images=0/0 and no visible Resume control. Complete actual Range/HEAD/byte/SQL/decrypt accounting remains open.
- PDF/EPUB/CBZ byte/range/HEAD/provider interleavings and actual request resource measurements remain unverified; no cross-request capability cache or final revocation fence added.

### PR-10 — implemented-actual-acceptance-pending

Playback relay provider identity query

Evidence: [implementation-playback.md](implementation-playback.md), [implementation-playback.json](implementation-playback.json), [evidence/implementation-playback-focused-tests.txt](evidence/implementation-playback-focused-tests.txt).

- Root integration/relay tests pending
- Current snapshots modest; no measured byte/latency gain claimed

### PR-11 — implemented-admin-native-queue-overflow-verified

Shared music queue owner requests cap+one and rejects overflow with native409 before hydration; complete queues through10000 preserve occurrence order/repeats/DTO. Separate paged party picker unchanged.

Evidence: [implementation-data.md](implementation-data.md), [evidence/implementation-data-bulk-complete.json](evidence/implementation-data-bulk-complete.json), [playback-readers.md](playback-readers.md), [implementation-found-25.md](implementation-found-25.md), [implementation-found-25.json](implementation-found-25.json).

- 8native scenarios,33exact plus28resource checks pass. Saved10001tracks7→4queries;10000unchanged7queries/10004rows. Direct actual14member album and repeated-album overflow pass. No direct-album10001natural cohort or mounted-browser overflow/playback claim; source consumers await preparation before playback. Selector scan/sort and accepted10000queue memory remain.

### PR-12 — partial-regression-verified

Hero and PersistentPlayer crop sampler lifetimes now follow actual optional demand independently of retained source/resume state. Root source/visibility now obey explicit current screen/playback capability withdrawal and release the source through existing cleanup.

Evidence: [implementation-playback.md](implementation-playback.md), [evidence/implementation-playback-supplemental.json](evidence/implementation-playback-supplemental.json), [implementation-found-09.md](implementation-found-09.md), [implementation-found-09.json](implementation-found-09.json).

- Actual signed-in trailer loads, pauses offscreen/no-consumer and resumes on return; natural capability withdrawal still absent.
- Two compiled capability controls verify source detach/load/timer cleanup and reenable; authored media boundaries are supplementary.
- Ordinary warm hidden/no-consumer source retained; full unload policy unchanged. Sustained actual codec/CPU/RSS budgets remain.

### PR-14 — open

Existing retention operation and shared history/session query projections

Evidence: [playback-readers.md](playback-readers.md), [playback-readers-findings.json](playback-readers-findings.json), [numbered-page-attribution.md](numbered-page-attribution.md), [numbered-page-attribution.json](numbered-page-attribution.json), [implementation-found-02.md](implementation-found-02.md), [implementation-found-02.json](implementation-found-02.json), [implementation-found-03.md](implementation-found-03.md), [implementation-found-03.json](implementation-found-03.json), [implementation-found-25.md](implementation-found-25.md), [implementation-found-25.json](implementation-found-25.json).

- New unchanged actual read-owner proof verifies deep audit542/Profile180 and complete clamped DTO/order/ties. Audit scope has139 identities/32,482 events; count uses28,576 root shared accesses, selectors4,783, with middle/deep spill317–362 temp reads/363 writes.
- Music has only five listens overall and a largest per-track journal of three; reading has one history row. Those are positive single-page controls, not long-journal scale. No custom lists exist.
- No retention/deletion/index policy changed. Query reuse or ordered access must preserve all history/applied flags/bookmarks and measure writer/storage costs where schema changes are proposed. Growth curves, long playback/reader history and live/private HTTP acceptance remain open.
- Shared Progress CASE and Profile recorded-History count/page reuse are now applied with their own12/25actual complete comparisons, resource plans and final828/0/common/normal acceptance. Audit history, other owners/range, growth/native-memory and missing boundary cohorts remain separate.
- Shared mediaHistory scope/count/page now applied after10actual raw/hydrated pairs over32482events/542pages, four owners and empty title. Primary2→1;33359→32336rootvisits;deep temp spill unchanged. Current normal raw/hydrated7page scope and831/0common gates pass. Other history/resource/growth contracts remain.
- Batch25 original capacity measurement:111playback sessions/4reading sessions/5listens/1reading-history row;10native-shapedplans. Adminlargesttrack3events/onepage; selectedalbumemptycontrol. ActiveUPDATE EXPLAIN only, matchingactualSELECT0rows/14hits; no positiveUPDATE/WAL or growthmilestone proof. Keep currentindexes/history/retention; no new candidate.

### UIS-01 — implemented-normal-rollout-common-and-authenticated-inbox-verified; actual-toast-cohorts-partial

Approved durable suppression is adopted in the shared notification row/controller/viewer-keyed host. Exact14-file source, nullable timestamp and0062indexes applied through checkpointed existing migrator; no visual redesign. Inbox state and original window stay independent.

Evidence: [implementation-toast.md](implementation-toast.md), [implementation-toast.json](implementation-toast.json), [evidence/implementation-toast-actual.json](evidence/implementation-toast-actual.json), [evidence/implementation-toast-preflight-normal.json](evidence/implementation-toast-preflight-normal.json), [evidence/implementation-approved-rollout-decisions.json](evidence/implementation-approved-rollout-decisions.json), [evidence/implementation-approved-normal-rollout.json](evidence/implementation-approved-normal-rollout.json), [evidence/implementation-toast-normal.json](evidence/implementation-toast-normal.json), [evidence/implementation-20261018-toast-adoption-v2-gates.json](evidence/implementation-20261018-toast-adoption-v2-gates.json), [implementation-toast-main.md](implementation-toast-main.md), [implementation-toast-main.json](implementation-toast-main.json), [implementation-toast-commit.md](implementation-toast-commit.md), [implementation-toast-commit.json](implementation-toast-commit.json).

- Actual recent normal and persistent toast cohorts remain absent; their clocks, failure, capacity and disposal cases are controlled regressions, not actual-data timing/performance evidence.
- Normal signed-in shell/inbox/reload acceptance passes, but this account has no eligible toast write. Normal successful-write/recent/persistent/multi-window delivery acceptance remains unobserved.
- Integrated actual15+1contracts pass with rollback restoration; a separate disposable actual-copy COMMIT then freshprocess/backend canonicalDTO read now passes, with all518nonToastvalues/window/unread exact and copydropped. This is not normalHTTP/browsermultiwindow acceptance.
- Optional refresh has no new deadline; one active refresh and one coalesced follow-up per host, independent from write admission.
- General inbox retention is unchanged; storage remains proportional to retained notifications.
- Unsent or failed hides are not durable across a hard reload; acknowledged state is.
- Historical0039 original SQL bytes/data effects remain unknown and were explicitly accepted for this exact forward rollout; no provenance recovery claimed.

### UIS-02 — implemented-regression-verified

One in-flight request; skip document-hidden work; refresh on visible; abort and fence late publication on teardown

Evidence: [implementation-common.md](implementation-common.md), [evidence/implementation-unit.log](evidence/implementation-unit.log).

- Actual hidden/resume request trace and longer soak

### UIS-03 — partial-bounded-library-collection-actual-data-verified

Retain at most three native catalogue pages with exact per-page hydration counts. Reuse range eligibility/count/raw selection; keep native hydration/ranking and Music source-generation fences. Resource atomically refreshes the bounded range, rejects stale/withdrawn publication, and never evicts a leased focused/open/busy card. Generic retention ports, source-owned retry and existing Shelf geometry/history preserve current UX without an additional scheduler/cache/dependency.

Evidence: [ui-second-pass.md](ui-second-pass.md), [ui-second-pass-findings.json](ui-second-pass-findings.json), [library-append-reset.md](library-append-reset.md), [library-append-reset.json](library-append-reset.json), [evidence/library-append-reset-normal.json](evidence/library-append-reset-normal.json), [implementation-found-04.md](implementation-found-04.md), [implementation-found-04.json](implementation-found-04.json).

- Bounded Library/Collection is now applied across Watch/Read/Play/Listen. Actual32range comparisons/four owners,38actual-card buffer schedules,6current compiled-owner schedules/34actual domain reads and2normal Music comparisons pass. Normal20-page Watch stays at180cards; final Back restores range/anchor/scroll/focus, reverse load and focus-release retry pass.
- Other cursor/search/discovery/profile/list/sequence/detail owners retain their own complete-membership, occurrence and backward-cursor contracts. Do not silently truncate them or describe this Library repair as universal bounded retention.
- Native heap/CPU/GPU/decoded-image/pending-response/whole-app budgets, sustained multi-surface/device/touch/permission/account-withdrawal acceptance and absent natural cohorts remain unverified. Music page width scales with admitted sources; three pages is not a universal180-card/byte budget.
- Historical prefix-reset incident chronology remains unproved. Current atomic retained-range refresh has its own actual-data authored schedules; the early timed-out browser waits are not proof of failed requests.

### UIS-04 — partial-open-menu-material-live-and-regression-verified

Use existing surfaceMaterial action with controller.open; close releases per-action glass ResizeObserver/settings callback without unmounting menu/controller/domain drafts. Shared Shelf social demand now follows near-card/document visibility through one observer with last-owner cleanup.

Evidence: [ui-second-pass.md](ui-second-pass.md), [ui-second-pass-findings.json](ui-second-pass-findings.json), [implementation-menu-material.md](implementation-menu-material.md), [implementation-menu-material.json](implementation-menu-material.json), [evidence/implementation-ancestor-material-normal.json](evidence/implementation-ancestor-material-normal.json), [implementation-found-03.md](implementation-found-03.md), [implementation-found-03.json](implementation-found-03.json), [implementation-found-04.md](implementation-found-04.md), [implementation-found-04.json](implementation-found-04.json).

- Focused glass/menu6tests172assertions pass; normal5173 actualaccount/nested/task/movie/comicmenus shownativeglass, closedmarkers0andoldfilterremoved, Enter/Escape+accountArrowDown pass. AuthoredDOMcontrols supplement functionalacceptance; no heap/CPUclaim.
- Closed action loses its warm map cache; reopen rebuilds material. Existing500msSVG cleanup remains. No measured netCPU/GPU/heap/latency gain.
- Card activation still latches while a card remains mounted. Library/Collection now has a shared bounded page buffer; other retained arrays/DOM and offscreen refresh remain open. Shared domain engagement/current visibility/dirty ownership needs actual unseen/visible/offscreen/revision tests, keyboard/touch/openmenu and permission removal proof.
- Actual60-card native scroll/return admission matches18→30→18geometricnearsets, oldheadwithdraws/returns,0new warnings/errors. That60-card observation is historical; later Library/Collection window proof is separate. Actual hidden/resume/native-resource and other source retention remain open.
- Generic MediaCard retention context now covers focus, menus, Dialog and operation/mutation lifetime, including nested parents. Native focused-card eviction/release retry and actual-data independent-owner schedules pass. Still-open-menu scrolling did not move content in the browser control; it is not claimed as a native eviction test. Positive in-flight domain writes and touch/permission withdrawal remain separate.

### UIS-05 — implemented-regression-verified

The shared compact-empty ChartView branch does not read its lazy renderer from the client error effect. Existing SSR lazy behavior and rendering remain unchanged.

Evidence: [implementation-chart-demand.md](implementation-chart-demand.md), [evidence/implementation-chart-demand-tests.txt](evidence/implementation-chart-demand-tests.txt).

- Five installed-compiler client/SSR tests pass with37assertions; controlled supplementary correctness evidence.
- Actual signed-in empty-chart network/resource acceptance remains unmeasured; no byte or CPU saving claim.

### UIS-06 — partial-actual-native-lifetime-verified

Shared liquidGlass releases native SVG/map resources at zero dimensions and rebuilds through the existing resize/frame owner; visible same-key reuse remains.

Evidence: [ui-second-pass.md](ui-second-pass.md), [ui-second-pass-findings.json](ui-second-pass-findings.json), [implementation-material-diagnostics.md](implementation-material-diagnostics.md), [evidence/implementation-context-material-normal.json](evidence/implementation-context-material-normal.json), [implementation-menu-material.md](implementation-menu-material.md), [implementation-menu-material.json](implementation-menu-material.json), [implementation-found-05.md](implementation-found-05.md), [implementation-found-05.json](implementation-found-05.json).

- Actual normal movie details/menu hide/reopen passes: one prior zero-size native owner becomes zero. Controlled width/height/map-rebuild tests supplement DOM evidence; private heap/GPU/pixel reclamation is not measured.
- Reopening regenerates the discarded map; no net CPU/frame/pixel/heap/latency gain is claimed. Resolution budgets, map generation cost, repeated-key frequency and cross-surface sharing remain open.

### UIS-07 — partial-actual-native-lifetime-verified

Existing AvatarPicker owns and immediately releases pending image/src/BlobURL on cancellation, identityreplacement/removal and teardown.

Evidence: [ui-second-pass.md](ui-second-pass.md), [ui-second-pass-findings.json](ui-second-pass-findings.json), [implementation-avatar-lifetime.md](implementation-avatar-lifetime.md), [evidence/implementation-summary-avatar-normal.json](evidence/implementation-summary-avatar-normal.json).

- Actualfourformat native outputs arebyteidentical,41checks/4controlledlate schedules pass; noheap/decoderpreemption claim.
- Normal5173chooser opens/selectsconnectedsource/cancels/reopens with savedpreview unchanged; no Save submitted. Cross-format pixel/frame/animation admission and peakdecoderallocation remainopen; precise natural decode/cancel timing notinstrumented.

### UIC-01 — partial-synchronous-menu-scope-reuse-actual-input-and-native-verified

Exclude only actor profile.avatar from the invalidation key, preserving every other scope dependency; no global cache or presentation change. Five existing synchronous tracked effects now pass their exact computed key to shared resource sync, avoiding duplicate serialization without changing fresh read/completion admission.

Evidence: [implementation-work-menu-scope.md](implementation-work-menu-scope.md), [evidence/implementation-work-menu-scope-actual.json](evidence/implementation-work-menu-scope-actual.json), [implementation-found-09.md](implementation-found-09.md), [implementation-found-09.json](implementation-found-09.json).

- Sixteen actual-key comparisons preserve all non-avatar values; maximum tested key16640→1385bytes. String size, not a CPU/heap/latency benchmark.
- Other settings still serialize per consumer; a minimal shared policy key remains a separate dependency/SSR/preview review.
- Current normal movie menu rendered Play/Mark watched/Collection/Favourite commands. Saved list/party/browser-scale cohorts remain absent; no cohort fabricated.
- Batch09:52 actual-input callback comparisons preserve complete resource DTOs/read/reset/warm behavior; closed key calls2→1. Native actual movie root commands reopen intact; raw menu text includes a hovered child. No CPU/heap/latency claim; natural five-family dependencies/list/party scale remain.

### UIC-02 — implemented-live-verified

Shared existing-resource owner aborts superseded/closed option reads; request.signal reaches Seerr identity, permission, server and detail stages.

Evidence: [implementation-request-options.md](implementation-request-options.md), [implementation-request-options.json](implementation-request-options.json), [evidence/implementation-normal-dev.json](evidence/implementation-normal-dev.json).

- Two actual option dialogs opened/closed; the existing account has no destinations. Live nonempty destination/provider-abort acceptance remains.
- Already-admitted SQL and unrelated metadata work are not cancelled.

### UIC-03 — partial-shared-logical-refresh-applied-regression-verified

Root API-client ordered same-domain changeMany retains per-command acknowledgements/first-failure stopping and refreshes once for an acknowledged prefix. Grouped recommendations across work categories use it, including preview isolation.

Evidence: [ui-components.md](ui-components.md), [ui-components-findings.json](ui-components-findings.json), [implementation-found-02.md](implementation-found-02.md), [implementation-found-02.json](implementation-found-02.json), [implementation-found-24.md](implementation-found-24.md), [implementation-found-24.json](implementation-found-24.json).

- Native actual-admin Save/Dismiss backend outcomes are covered by batch22recommendation comparisons; the prior absent-backend-cohort statement is superseded.
- Shared logical client refresh ordering/prefix-failure/no-retry/empty/mixed-domain schedules remain supplementary; positive mounted client Save/Dismiss and complete actual refresh/query/resource measurements remain unverified.

### UIC-04 — partial-narrow-browser-dto-actual-verified

Adopt exact original narrow workId/title browser entries and Set-based conflict-first review derivation at existing durable preview owner/component; full saved evidence/approval/review/execution unchanged.

Evidence: [ui-components.md](ui-components.md), [ui-components-findings.json](ui-components-findings.json), [implementation-found-23.md](implementation-found-23.md), [implementation-found-23.json](implementation-found-23.json), [implementation-found-25.md](implementation-found-25.md), [implementation-found-25.json](implementation-found-25.json).

- Independent actual saved-preview/compiled derivation acceptance passes:1000actualmovies/nativeexportIDs, complete IDs/titles/counts/order/choices/durableevidence preserved;539938→143042JSONbytes, same600reviews, getterreads280800→1400. Controlledsavedlocalfacts are not remoteproviderreplies.
- Full genuine provider preview/approval requires current actualownedTrakt profile/collection context and remains unverified. Prior transport-disabled label was harnesspolicy, not a human blanket ban. Complete mountedpanels, retainedheap and fullpagination/access lifecycle remain unbounded/deferred; no arbitrarycap.

### UPP-03 — partial-actual-data-verified

Shared DiagnosticStore output admission plus first-line pruning avoids excess sanitized DTO work without changing complete export, ordering, retention or current file accounting.

Evidence: [ui-preview-platform.md](ui-preview-platform.md), [ui-preview-platform-findings.json](ui-preview-platform-findings.json), [implementation-material-diagnostics.md](implementation-material-diagnostics.md), [implementation-found-05.md](implementation-found-05.md), [implementation-found-05.json](implementation-found-05.json).

- 20complete actual-file comparisons pass across16325diagnostic/2656runtime rows; normal viewer30rows/disclosure passes. safeFields calls fall16325→30for its existing limit; full output remains complete.
- Whole-file reads/parsing/sorting, repeated viewer refresh, sustained event rate, natural failures and CPU/heap/I/O remain open. Limited output is not a strict storage or peak-memory bound; prior directory/accounting proof remains historical.

### UPP-04 — implemented-actual-data-restore-verified

Read stdout, stderr and process exit concurrently; preserve stdout and existing error/redaction behavior; report queried PostgreSQL version.

Evidence: [implementation-recovery-lifetimes.md](implementation-recovery-lifetimes.md), [evidence/implementation-recovery-actual.json](evidence/implementation-recovery-actual.json), [evidence/implementation-recovery-controlled.json](evidence/implementation-recovery-controlled.json).

- Actual restore preserves 102 tables / 1,864,145 rows including the migration ledger, sequence state and checked schema; disposable target and dump removed.
- Both old and current collectors passed real two-MiB OS-pipe exercise under Bun1.4.3; no natural deadlock or latency gain claimed.
- General output-byte and process deadline policies, actual key-copy/decryption and restored-app/provider acceptance remain separate.

### FRT-01 — partial-actual-data-and-live-verified

Shared search demand remains adopted; native Back now invalidates composed filter intent independently of skipped framework hooks, including query/draft/latest-failure handling and disposal.

Evidence: [implementation-search.md](implementation-search.md), [evidence/implementation-search-actual.json](evidence/implementation-search-actual.json), [evidence/implementation-normal-dev.json](evidence/implementation-normal-dev.json), [implementation-found-06.md](implementation-found-06.md), [implementation-found-06.json](implementation-found-06.json).

- 15 actual route pairs,30row+30family complete payload comparisons match with zero writes/unexpected fetches; provider transports denied, so counts are admission/local ORM work.
- Signed-in normaldev consecutive independent filters, settled Back, selected empty rows, query preservation and real ComicVine results passed; no new errors during that search trial.
- Actual books are absent; actual album local-title cohort returns zero both before/after (source alias-only canonical-title candidate, with actual owner/access membership unverified), and family subtype overfetch/cancellation remain.
- Actual rapid native Back/query/next-row-filter defect reproduced before and repaired on final source. Restored Movies + Comics returns12/38actual cards; all50ordered DOM identities/titles match a canonical reload. Controlled missing-hook/latest-rejection/draft/disposal checks supplement actual acceptance; other navigation/device/provider/resource schedules remain unverified.

### FRT-02 — implemented-live-verified

Optional private insight/review/credit/activity work is not admitted for anonymous viewers; preview transport remains enabled; shared API cancellation now fences late global expiry/diagnostic side effects and preserves body aborts.

Evidence: [implementation-common.md](implementation-common.md), [evidence/implementation-anonymous-normal-dev.json](evidence/implementation-anonymous-normal-dev.json), [evidence/implementation-unit.log](evidence/implementation-unit.log), [implementation-api-lifetime.md](implementation-api-lifetime.md), [evidence/implementation-api-lifetime-tests.txt](evidence/implementation-api-lifetime-tests.txt).

- Actual public normal-dev page produced zero API calls across five document loads; genuine-expiry UI and broader public media/device combinations remain unverified.
- New cancellation fences have controlled protocol regression proof; no natural actual two-viewer late401schedule is claimed.

### FRT-03 — partial-read-lifetimes-actual-contract-verified

Own profile favourites/insights reads and onboarding device waits; fence disposal and skip hidden import-status refresh while preserving device cadence and preference writes.

Evidence: [implementation-route-lifetimes.md](implementation-route-lifetimes.md), [evidence/implementation-route-lifetimes-actual.json](evidence/implementation-route-lifetimes-actual.json), [evidence/implementation-owner-batch-normal.json](evidence/implementation-owner-batch-normal.json), [implementation-found-10.md](implementation-found-10.md), [implementation-found-10.json](implementation-found-10.json), [implementation-found-25.md](implementation-found-25.md), [implementation-found-25.json](implementation-found-25.json).

- Four actual profile section GETs preserve complete output; completed setup checks pass. Signed-in rendered profile overview/favourites panel acceptance passed; filter/preference writes were not exercised.
- No actual pending device/provider cohort. Already admitted Kit invalidation and backend work are not physically cancelled.
- Preference chain remains ordered/uncoalesced; an old hung device wait can still delay a newly requested code. Those policies remain open; no latency/heap claim.
- Profile insight period is now part of the resource snapshot: retained values keep committed labels/links through pending/failing/superseded reads. Compiled schedules and final actual visitor settled output/panel pass; natural pending/failure interval was not captured. Broader read owners remain partial.
- Batch25: original adjacent-equivalent pending preference coalescing tested and rejected. Stable2→1nativeAPI/4→2ORM, but nativefirst-write503 makesbothcallersfail instead of default secondcaller recovery. Retain current orderedchain; no alternative this run.

### FRT-04 — partial-shared-import-reload-built-actual-verified

Six demand-only component imports handle failures with an explicit Reload page action and fence publication. HLS import rejection uses the same explicit action; post-import setup failures release partial resources and retain same-session Retry.

Evidence: [implementation-lazy-recovery.md](implementation-lazy-recovery.md), [evidence/implementation-lazy-recovery-tests.txt](evidence/implementation-lazy-recovery-tests.txt), [evidence/implementation-lazy-browser-before-ui.json](evidence/implementation-lazy-browser-before-ui.json), [evidence/implementation-lazy-browser-before-server.json](evidence/implementation-lazy-browser-before-server.json), [evidence/implementation-lazy-browser-before-runner.json](evidence/implementation-lazy-browser-before-runner.json), [evidence/implementation-lazy-browser-final-ui.json](evidence/implementation-lazy-browser-final-ui.json), [evidence/implementation-lazy-browser-late-ui.json](evidence/implementation-lazy-browser-late-ui.json), [evidence/implementation-lazy-browser-late-server.json](evidence/implementation-lazy-browser-late-server.json), [evidence/implementation-lazy-browser-late-runner.json](evidence/implementation-lazy-browser-late-runner.json).

- First native built fault rejected same-document Retry; retained failed trial. Corrected explicit Reload action recovers three real friends, current JS/CSS decoded bytes match buildfiles, and successful close/reopen reuses component. Fresh-origin browserBack before held503 suppresses late error, then reopen/Reload recovers.
- 26focusedtests/177assertions cover all six loaders, HLS startup and both feedback hosts; actual fault test uses Friends in nativeIAB only. No automatic reload/cache busting; Reload may end in-memory playback/panel state.
- CSS failure, evaluation rejection, version skew, other browsers, real HLS and chart/editor recovery remain open. Current normal Friends/Notifications/Streams/detail favourites and ForYou DynamicFeed rendered; new Reader failure/lifecycle trial not exercised.

### FRT-05 — implemented-live-verified

Exclude non-hierarchy recommendation edges from public ancestry, retaining actual structural edges and episode-show links.

Evidence: [implementation-common.md](implementation-common.md), [evidence/public-hierarchy-before.json](evidence/public-hierarchy-before.json), [evidence/implementation-public-hierarchy.json](evidence/implementation-public-hierarchy.json).

- Eight actual-data cohorts and the original normal-dev wrong-title case passed; broader public format/device and season/episode hierarchy composition remain separate.

### LIVE-01 — implemented-live-verified

Atomic resolved detail snapshot owns outgoing keyed presenter props through disposal.

Evidence: [implementation-ui.md](implementation-ui.md), [evidence/implementation-normal-dev.json](evidence/implementation-normal-dev.json), [evidence/implementation-music-detail.png (private verification image)](publication.md#private-verification-images).

- Short actual music handoff plus compiled seven-family regression; production-device/long-soak acceptance remains.

### LIVE-02 — implemented-live-verified

Exact linked-source command projection into unchanged strict prepare schema.

Evidence: [implementation-playback.md](implementation-playback.md), [evidence/implementation-normal-dev.json](evidence/implementation-normal-dev.json), [evidence/implementation-comic-reader.png (private verification image)](publication.md#private-verification-images).

- Actual linked CBR passed; actual EPUB and all provider/file-format/device combinations remain unverified.

### PANEL-01 — implemented-live-verified

Action-owned accumulated reverse travel temporarily suspends snap; resets/cancels with presentation lifetime.

Evidence: [implementation-ui.md](implementation-ui.md), [evidence/implementation-normal-dev.json](evidence/implementation-normal-dev.json), [evidence/implementation-panel-collapsed.png (private verification image)](publication.md#private-verification-images).

- Actual native small reverse and content-first handoff passed; broader trackpad/browser/touch/device acceptance remains.

### LOCK-01 — implemented-representative-actual-data-verified

Implemented existing lock-only configuration/subject fence before the account lock, preserving later admission and disabled cleanup branches

Evidence: [mutation-locks.md](mutation-locks.md), [evidence/implementation-mutation-locks-real.json](evidence/implementation-mutation-locks-real.json).

- Only representative Continue concurrency schedule exercised against actual rows
- All conditional route/job schedules are not exhaustively runtime verified
- Controlled protocol timings are not natural UI latency or universal gains

### LOCK-02 — implemented-actual-data-verified

Implemented policy→existing account advisory mutex→fresh nonexclusive active-user read

Evidence: [mutation-locks.md](mutation-locks.md), [evidence/implementation-mutation-locks-real.json](evidence/implementation-mutation-locks-real.json).

- Broader issuer/password/role revocation schedules remain in existing auth acceptance scope

### LOCK-03 — partial-steam-chunk-policy-order-native-verified

Steam ownership chunk acquires existing user policy fence before assertAccount connection/running-attempt locks; native observed user/outbox deletion-cascade cycle removed.

Evidence: [mutation-locks.md](mutation-locks.md), [implementation-found-26.md](implementation-found-26.md), [implementation-found-26.json](implementation-found-26.json).

- Verbatim extracted native chunk plus actual-admin native deletion under exact0064: baseline40P01 at outbox_actions cascade; candidate both callbacks complete and roll back. Complete scoped first-branch and warm effects/results match; statements20→21 and11→12, one extra policy query/user SHARE fence per chunk. Historical first-ownership tracking dedup returns added0; no first-ever publication claim.
- Full genuine getSteam/worker/bootstrap remains unverified. Original same-Steam account-advisory/connection counterpart was not established. Test proves the observed user/outbox cycle, not that hypothesized cycle or whole-database deferred-revision equality.

### LOCK-04 — partial-friendship-policy-order-native-verified

Friendship accept locks sorted participant policy rows before the friendship row, revalidates identity and retains existing feature validation/no-op/error/cleanup behavior. Native current0064 deletion cycle removed.

Evidence: [mutation-locks.md](mutation-locks.md), [implementation-found-26.md](implementation-found-26.md), [implementation-found-26.json](implementation-found-26.json).

- Current0064 baseline deadlocks40P01; candidate completes both native callbacks with rollback restoration and committed disposable-copy deletion. Five ordinary native outcome/effect comparisons and39assertions pass. Adds one identity read and two policy-lock helper calls on acceptance; no universal latency claim.
- Recommendation command row/policy order and other sorted multi-subject schedules remain outside this verified friendship repair. No normal account deletion.

## Additional runtime observations

These records sit outside the 94 canonical items. Each status distinguishes observed incidents, source/control proofs, staged proposals, rollout blockers and applied repairs. See [runtime observations](runtime-observations.md).

- SETTINGS-NAV-OBS-01 — investigating: Intermittent Settings initialization error; stable cold round trip passed; read-only diagnosis ongoing.
- ROUTE-NAV-OBS-02 — approved-repair-adopted; installed-schedules-clean-installs-common-and-normal-functional-verified: Historical incident causal trace unproved. Exact Kit2.70.3 patch/build drift admission adopted; 21 installed-owner schedules, clean full/production frozen installs and 801 common passes succeeded. Signed-in normal Friends retained47seconds, detail reverse-wheel and final30pausedTasks passed. Residual refresh snapshot races and native resource/overlap/long-soak acceptance remain. Later normal Activity trial has mixed Back outcomes: filtered sequence settled Library, unfiltered repeat eventually restored movie. Native close/history integration and actual request/refresh chronology remain unproved; see implementation-activity-workset-normal.json. Later seven authored native integration controls characterize duplicate/stale close requests, not the normal incident; minimal shared lifecycle repair and actual acceptance remain open. Separately, batch06 reproduces and repairs the existing Search native-Back/composed-intent gap, with actual canonical50card equality and unchanged21framework schedules; it does not certify the historical Activity incident or other refresh snapshot races.
- ARTWORK-CACHE-OBS-03 — implemented-shared-owner; controlled-actual-byte-recovery-verified: Both private/TMDB owners now use serialized cache validation/eviction.28 checks with copies of actual JPEG/WebP prove rejected-entry recovery, retained hits and queued replacement;20focusedtests115assertions. Latest normal-dev14private artwork images render. No natural corruption incidence or full decoder/integrity claim; existing magic-header limits remain.
- MIGRATION-DRIFT-OBS-04 — approved-normal-exact-forward-rollout-applied-and-postchecked: Normal0062+0063ledger62→64/schema/source verified with private readable archive checkpoint, common gates and authenticated inbox/reload acceptance. Historical0039 hash retained; original bytes/data effects still unknown and explicitly accepted. Archive actual restore and successful normal toast write absent; no default preflight relaxation or history rewrite.
- COMIC-LAB-SNAPSHOT-OBS-05 — concurrent-untracked-source-review-actual-acceptance-unverified: Separate 17-file unchanged snapshot, six source observations outside the 94 baseline records. No experiment execution or edits; actual archive/engine/provider/resource acceptance remains unverified. See comic-lab-follow-up.md.
- FEATURE-JOB-LEASE-OBS-06 — implemented-shared-lease-fence; actual-rollback-and-controlled-contracts-verified: Raw feature reconciliation now uses the existing queue lease/policy guard inside each bounded account chunk before domain mutation. Cancelled/stale attempts execute zero domain statements; actual unchanged valid/direct outcomes and all102tables/1,864,145row values restored. Positive destructive cleanup cohort absent; controlled active-chunk test is supplementary. PJ07/PJ09/PJ10 remain open.
- ROUTE-REFRESH-OBS-07 — implemented-shared-caller-contract; normal-actual-visible-windows-verified; midflight-state-gaps-open: Nine prior direct invalidation expressions now use eight shared calls across six consumers. From a clean Tasks URL, normal dev retained three actual friends and the close control for 45,893 ms, then closed and reopened correctly. Notifications (20,322 ms) and Streams (21,231 ms) remained open; final state had 30 task rows, zero popovers, no new warnings/errors and unchanged source. Exact poll counts were not instrumented. Opening/closing during an in-flight load and already-admitted refresh on unmount remain unresolved; OBS01/02 and the navigation candidate remain open.
- ANCESTOR-AGGREGATE-OBS-08 — implemented-shared-helpers;actual-rollback-verified;top-level-acceptance-partial: 28actual helper pairs/14existingcohorts preserve completeaccounttracking/all102tablepostvalues/tuplechangedkeys/DML;28054→48childmappedrows and1638240→4250JSONproxybytes;296statements andrequiredwrites unchanged. Actual fulltop-level track/bulk/rebuild/events/webhooks/concurrency and franchise/repeatedpath acceptance remain separate; no CPU/heap/wire/universalI/O/tail claim.
- LIBRARY-APPEND-OBS-09 — implemented-bounded-library-collection;actual-dto-owner-native-window-verified;broader-resource-gaps-open: The original300→180incident remains causally uninstrumented; the later actual revision trace is preserved. Batch04 applies shared bounded Library/Collection across four media:32actual range pairs,38actual-card schedules,6current compiled-owner schedules/34reads,normal Music comparisons and20-page Watch plateau at180cards with Back/scroll/focus recovery. Other sources, natural permission/provider/write races and sustained heap/CPU/GPU/image budgets remain open; this is no longer an unadopted generic-client proposal.
- API-HTTP-ERROR-OBS-10 — implemented-actual-handler-common-and-normal-body-verified: Controlled negative requests and synthetic direct-handler events are explicit. Normal response bodies were observed, with no network status capture. Natural failures, other actual error cohorts, token/CSRF/cancellation transport/provider success remain separate; no performance gain inferred.
- PANEL-HIDDEN-ERROR-OBS-11 — implemented-shared-manual-cleanup;23authored-native-controls-common-verified;actual-natural-error-unobserved: Current signed-in successful panel shrink, filtered Back, Close/focus and inbox acceptance pass. Natural hidden401/403/feature withdrawal remains absent; already-issued traversal and pre-effect-cleanup identity races remain outside this repair.
- TEST-RUNES-OBS-12 — implemented-shared-test-preprocessing-and-common-verified: Historical authored receipts keepoldpipelineboundaries. This changesverification, notproductioncompilation, anddoesnotupgradeactualcohortcoverage. Batch05 also restricts the root canonical test command to ./tests, retaining the archive-discovery failure and preserving snapshots; final batch06 has839canonical passes/715guarded skips/0failures, not duplicated archived tests.
- ACCOUNT-DELETE-OBS-13 — forward-migration-applied-actual-copy-verified-approved-normal-rollout-postchecked: Approved checkpointed normal0064rollout is complete; exact ledger/functions/trigger postchecked. No normal account was deleted. Killed-backend peaks, positive reaction/large archive/reconnect and broader concurrent/provider cohorts remain unverified.
- CONTINUE-UNDO-RACE-OBS-14 — preexisting-baseline-race-observed-controlled-admin-copy-unfixed-deferred: Investigate intended Undo ownership/recovery semantics after uninvestigated areas; no alternative implementation attempted during prescribed-method run.
- JELLYFIN-FINALIZATION-DEADLOCK-OBS-15 — preexisting-native-two-session-deadlock-reproduced-unfixed-deferred: Investigate existing lock ownership after uninvestigated areas; no alternative lock implementation in this execution pass.

## Continuing work and drift

Open items retain their full alternatives and acceptance in the baseline area reports. They remain unresolved work. Continue at shared owners: request lifetime, eager child materialization, provider finalization, retained DOM, task history and resource budgets. Changes that alter retention, navigation, presentation or major transaction boundaries need a concrete option and its tradeoffs before a decision.

Keep baseline source hashes immutable. Capture a separate reviewed current inventory after source review, regenerate this register with the overlay, check source against that manifest, and retain verification receipts per batch. Refresh complete comparisons when owner semantics or feature/privacy rules change. A passing regression does not erase actual provider, format, device or scale gaps.

Regeneration: `python3 consolidate.py`, then `python3 render-implementation-ledger.py` from this directory. Edit implementation-ledger.json deliberately; this renderer never changes a status or marks a test skip as passed.
