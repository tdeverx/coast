# Shared conflict summaries, sequence acceptance and deferred finalization

One shared improvement is adopted: conflict review reads and returns list summaries instead of complete browser membership arrays. Existing sequence repairs gain named positive admin acceptance. The Jellyfin phased-finalization proposal remains private: resource results improve, but required concurrent-edit acceptance is not clean. No further method or lock redesign is attempted after that result.

All database scenarios use actual catalogue/account records with the admin as actor. Temporary lists, relationships, conflicts and scan/job states are controlled scenarios on private actual-data copies, not naturally observed workloads. No fake users, catalogue identities or provider replies are used. No normal data writes, external delivery, dependency, migration, commit, push or PR is added.

| Finding | Outcome | Verified scope |
| --- | --- | --- |
| PJ-12 conflict review | Narrow shared summaries adopted; finding partial | Native 103-conflict comparison, six native approval comparisons and unchanged wording/actions. DTO bytes 916,585→61,091; native statements 205→104. Full pagination/detail remains deferred. |
| DATA-02 sequence admission | Existing repair gains positive controlled acceptance; remains partial | Eleven unique native DEFAULT/current mutation pairs and four saved-boundary lock cases. Repeated paths, playlist occurrences, rewatch/backdated/drop, stale paths and saved boundaries exercised. |
| PJ-07 Jellyfin finalization | Resource-positive candidate not adopted | Maximum transaction statements 3,087→305 and selected rows bounded to 100. Native concurrent edit deadlocks in both DEFAULT and candidate; return proposal to investigation backlog. |

## Adopted conflict summary projection

[Native result and limits](candidates/admin-conflict-review/outcome.md), [exact native receipt](candidates/admin-conflict-review/native-actual.json), [production patch](candidates/admin-conflict-review/production-ready.patch).

The shared getPendingConflicts owner serves both settings and the private conflict API. It now reads local list name/description/count in one query per list, rather than loading every member through two queries. Browser DTOs omit member arrays and carry dedicated localItemCount/remoteItemCount fields. The shared ConflictList formatter uses those counts while preserving its original array behavior for other simultaneously supported scalar/unknown value shapes. Deleted values, progress values, items-absent remote state and unrelated itemCount metadata keep the same wording. Markup, controls, selected dialog, decision payloads and refresh behavior are preserved.

The actual native comparison covers 101 controlled admin list conflicts plus two unknown-agreed scalar conflicts. The largest list contains 10,000 actual catalogue works. All IDs, non-summary values, ordering and exact formatter output match. Complete response serialization falls from 916,585 to 61,091 bytes; native statements fall from 205 to 104. A single ordered local elapsed sample is 193.05→87.51 ms; this is not a production latency, CPU or heap claim. Preliminary SQL-shape results are retained separately rather than substituted for native acceptance.

Six native resolveConflict comparisons cover accepted/ignored choices for the huge list, edits after the summary read and actual unsupported work. Complete ordered membership, saved/agreed evidence, metadata, outbox state and native results match. The fresh ignored case preserves 10,001 members; accepted choices use complete authoritative saved remote state and fresh local state, preserving unsupported members. The admin has no active Trakt export connection, so no active export/delivery cohort is claimed. Resolution, full localListValue, supported-member merge and durable evidence owners remain unchanged.

A private type witness caught localItemCount inferring unknown at the general Record map. A number assertion at the known native count(*)::int boundary fixes the type; Bun-erased JavaScript is byte-identical to the actual-tested module. The original native receipt/source fixture remain immutable. [Type proof](candidates/admin-conflict-review/type-erasure.json) and passing integrated type/build checks cover the final source without repeating unchanged database behavior.

This does not bound the total number of conflicts, mounted cards or saved remote JSON loaded from the database. Deterministic paging and demand-loaded detail require API/selection/lifetime changes; adding an arbitrary LIMIT would hide reviewable decisions. Those broader parts remain deferred.

## Positive sequence and saved-boundary acceptance

[Executed scenarios](candidates/admin-sequence-acceptance/README.md), [summary](candidates/admin-sequence-acceptance/summary.json). Current tracking/sequence/rewatch owners are unchanged. Archived DEFAULT uses the documented older tracking source with current shared dependencies; the receipt states that baseline boundary explicitly.

Temporary relationships over actual collections and movies create repeated direct/nested paths; two playlist roots create six distinct occurrence paths. Eleven unique pairs preserve native results, complete logical tracking/events, user queue, rewatch/list state and atomic stale-path errors, with generated event IDs independently linked to actual inserted rows. Bulk completion uses one current full census plus three narrow live reads versus five DEFAULT full expansions. Ordinary current requests use one narrow read and no full expansion. These are scoped query observations; no production timing claim is added.

Four saved-boundary tests exercise existing rewatch clear and playlist restart while a separate session holds the admin account lock. DEFAULT completes without waiting; current waits with one matching waiter and completes correctly after release. This verifies the intended repair rather than treating the locking difference as a regression.

Named acceptance closes the prior naturally absent repeated/playlist/rewatch cohort gap. The finding stays partial: outbox comparison is count-only, not complete outbound payload equivalence; every downstream trigger/revision table, browser/API session, transport and arbitrary concurrency is not certified. One repeated-entry pair completed before a later harness import-loader failure; its receipt remains overall failed with that boundary explicit. A redundant dispatch is not counted as extra acceptance. Final lock-only dispatch records the intended probe path/SHA before launch, and all copies are absent afterward.

## Finalization candidate: measured, not adopted

[One candidate and decision](candidates/admin-jellyfin-finalization/RESULT.md), [outcome](candidates/admin-jellyfin-finalization/outcome.json), [two-session result](candidates/admin-jellyfin-finalization/actual-concurrency.json).

The private proposal extends the existing scan progress with screen/music/enqueue subphases and keyset cursors. Source selection and intent enqueue pages have at most 100 rows, effects commit with cursors, and native jobCheckpoint runs afterward. A narrow versioned-backfill guard rejects obsolete/missing intent versions before adapter identity; it leaves manual/unversioned behavior unchanged. None of this candidate or its isolated guard is applied to runtime.

Before controls, the actual admin has 62 nonempty screen states, 797 music progress rows and no intents in the selected real account. Controlled native comparison uses actual screen/music identities and produces 771 exact normalized intents and 770 mapped pending backfills in both versions. Candidate commits 17 finalization pages with three native yields; normalized completion, unknown-mapping retention and negative availability agree.

| Resource | DEFAULT | Candidate |
| --- | ---: | ---: |
| Native ORM statements | 3,102 | 2,434 |
| Intent seed INSERTs | 771 | 9 |
| Maximum ORM statements per transaction | 3,087 | 305 |
| Maximum selected source/intent rows | 650/770 | 100/100 |
| Transactions | 2 | 18 |
| Single local elapsed, ms | 2,558.83 | 1,542.56 |

Counts exclude raw checkpoint/policy SQL, BEGIN/COMMIT and harness work. Final negative availability and native compaction can still affect more than 100 rows; this is not a universal write-row bound. Time and global WAL samples are descriptive, with no direct account-lock span, production-tail or remote-delivery claim.

The primary receipt passes 56 assertions before a harness baseline error compared pre-entry progress metadata with post-page rollback. The corrected rollback-only receipt passes 12 checks at transaction admission; no resource scenario is repeated. Lost acknowledgement, below-cursor native edits, version replacement/deletion, generation/reset/feature/attempt fences and committed checkpoint behavior have finite local evidence. Adapter identity is trapped by throwing, with no fabricated reply or transport; local jobs do not prove exactly-once remote effects or a live worker-lane release.

A required two-session native manual-edit schedule reproduces PostgreSQL 40P01 in BOTH DEFAULT and candidate. Primary finalization completes, the concurrent manual writer aborts, and one pending intent/backfill remains. The tested account-row/advisory/FK lock cycle is preexisting, not a candidate-only regression. Nevertheless, concurrent-edit acceptance is not clean and the proposal introduces durable cursor ownership. Under the user's stopping rule, retain current runtime and return the proposal to the investigation backlog; do not independently redesign locking in this run.

The existing cycle is separately recorded as JELLYFIN-FINALIZATION-DEADLOCK-OBS-15. No claim is made that the adopted imported-listen batching repairs it. The current importer remains exactly the batch-23 source.

## Authenticated rendered check

The flow is normal signed-in admin /settings/pending → Appearance → Sync conflicts. The existing in-app tab is retained as the user required; a separate unauthenticated Playwright session is not used. The dedicated Browser plugin is not available, so CUA controls the existing authenticated browser. [Machine evidence](candidates/admin-execution-batch24/normal-ui.json).

| Check | Result |
| --- | --- |
| Page identity | /settings/pending, Sync conflicts · Coast |
| Meaningful screen | Settings navigation, administration and conflict section rendered |
| Framework overlay | None visible |
| Console | Zero captured warnings/errors |
| Screenshot | Captured at 1280×720 |
| Interaction | Appearance navigation and return to Sync conflicts settle correctly |

Normal admin currently has no pending conflicts: this is empty-state/render/navigation acceptance only. No normal approval/write is submitted. Positive native 103-conflict and approval comparisons are separate; extracted formatter/action and Svelte compile checks supplement them. Mobile and a mounted positive-conflict browser are not certified.

## Restoration, drift and remaining work

[Independent full restoration](evidence/implementation-found-24-restoration.json) confirms the same 102 tables / 1,864,145 rows and original canonical logical SHA256. Every disposable copy is marker-verified, dropped and checked absent. Physical WAL/cache effects are not undone by rollback. [Integrated gates](evidence/implementation-found-24-gates.json) pass on the final source; guarded DB/provider skips are not actual-data acceptance. Current report/source/artifact integrity is checked separately.

[performance.md](../../performance.md#conflict-summaries-retain-authoritative-detail) records summary-vs-authoritative state, exact wording, erased type-only proof, honest bounds and test-dispatch identity. Failed/deferred methods return to [the investigation backlog](failed-method-backlog.md); [uninvestigated areas](follow-up-roadmap.md) retain priority in the later investigation pass. Existing native Save/Dismiss evidence from batch 22 also corrects UIC-03's outdated absent-backend-cohort note without promoting client refresh acceptance.

Current canonical counts: 32 implemented / 37 partial / 20 open / 5 other. Seventy-one of 94 canonical findings have some applied source; 15 additional observations are separate. These figures do not mean the overall audit or all partial findings are complete. No further new-area investigation is performed in this batch.
