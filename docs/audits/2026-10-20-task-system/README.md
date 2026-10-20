# Task-system audit — 20 October 2026

**Historical audit capture.** The subsequent [implementation and acceptance ledger](implementation.md) records repairs, failed trials, corrected findings and remaining verification. Statements below about no implementation changes describe the initial audit epoch. The original receipt is retained unchanged.

**Scope:** audit and test current behavior, not implement repairs or operate the live queue. The shared outbox, all 41 registered handlers, schedules, task presentation, retries, ordering, cancellation, progress, leases, snapshots and retention were traced. Findings and acceptance plans below are proposals. No live action was claimed, retried, promoted, cancelled or deleted by this audit. No provider write was dispatched. No application implementation was changed, committed or pushed.

**Conclusion:** the live workers are functioning, but account ordering turns individual permanent failures into account-wide barriers. The backlog then makes task selection expensive, while the task overview can hide the failures under Waiting. Fixing only the presentation, retrying every failure, or increasing worker count will not resolve that combination.

## Evidence and limits

Live installation: Apple Container `coast`, image `ghcr.io/tdeverx/coast:preview`, build `f7a3e3f71f1241a967106d5c6615726e965c3a5b`, public origin `https://coast.tdeverx.me`, host port 7318. These are live-container observations, not localhost:5173 data. The earlier normal-dev comparison is not used to establish the live task counts.

The narrow metadata census finished at **11:39:41 UTC / 12:39:41 BST**. Each query used a read-only transaction with a statement deadline. It contains **117,717 task rows across 21 observed kinds**, including the retired `jellyfin.scan`; **20 of the 41 currently registered kinds have real recorded runs**, and **12 have active representatives**. The other 21 registered kinds have source coverage only. No absent provider/format/lifecycle case is called a runtime pass.

The live queue changed during the investigation. For example, the earlier admin sync failure was cancelled and replaced by pending work by the census. This audit did not make that change. Counts are observations at stated capture points, not an immutable production snapshot or a guarantee of the current queue size.

Private inputs contain only selected task metadata, schedule fields, account IDs/roles/task opt-ins and query plans. They omit credentials, full task payloads and media histories. Raw receipts remain ignored under `.data/task-audit-20261020/`; the public [receipt](evidence.json) records hashes and aggregate results. Automatic approval review rejected a full database dump because it would persist user data and encrypted credentials. That dump was not executed; narrowly scoped read-only exports were the safer alternative. There is no disposable full-copy mutation/crash/provider-write acceptance in this report.

The task owners checked against the live build have no branch diff for the queue, execution, actions, maintenance, task definitions, timing policy and task presentation. Full source hashes are in the receipt. A source hash establishes the inspected version, not runtime acceptance of every line.

## Verified checks

| Check | Actual evidence | Result / boundary |
|---|---|---|
| Worker liveness | Recent successful live/stream/Seerr actions | 19 completions in the earlier five-minute observation. Workers are not globally dead. |
| Account failure barriers | Live pending rows joined to older failed account writes/changed-item jobs | 12,592 directly blocked in the 11:33 observation. Backlog continued changing afterwards. |
| Task overview | Shared `jobTaskSections` run on actual state representatives | Five failed delta jobs disappear from Needs attention alongside 3,645 pending; one failed reconciliation disappears alongside 8,945 pending. |
| Failed recurring run | Real failed Steam-achievement task, real integration schedule/account; shared `taskDue` | A forced due check with the existing active-failure evidence still returns `at:null`. Scheduler SQL separately confirms `failed` counts as active. No Run-now command was sent. |
| Failure notices | Actual task-to-notification join | All nine failed tasks in the census had notification rows; four notices were read. The defect is not wholesale failure to create notices. |
| Active provenance/payloads | Actual generation joins and payload-size aggregates | Zero stale-generation active rows observed; zero active payloads above 256 KiB; maximum 7,297 bytes across 12 active kinds. This does not establish all future admission paths are bounded. |
| Registration/card normalization | Actual source registry and providers present in live metadata | 41 unique handlers; every observed active kind registered; 37 provider task cards each normalize to exactly one kind. |
| Read-only candidate-selection analogue | Real queue, shared generated eligibility/order predicates, EXPLAIN ANALYZE | 9,454.761 ms; 4,140,067 shared-hit and 84 shared-read block visits. 12,623 correlated account-order checks; five candidates survive the main filter. |
| Application-matched planner setting | Same read-only analogue with `jit=off`, matching Bun's pool | Cancelled at the 10-second statement safety cap. No latency beyond that cap is asserted. |
| Wider eligibility aggregate | Real queue, shared predicates | Also cancelled at its 10-second safety cap; no aggregate eligibility result is claimed. |

The 9.45-second probe used psql's default JIT setting, not the application's forced-off setting. The second probe corrects that setting but timed out. Both concern the **read-only selection analogue**: they omit the claim UPDATE, `FOR UPDATE SKIP LOCKED`, recovery updates and global advisory claim lock. They are not full worker claim timings, cold-cache timings, percentiles or an optimization benchmark. The expensive account predicate and real backlog are established; a candidate repair still needs matched before/after acceptance. No further heavy live plan probes were run.

[verify-actual-tasks.ts](verify-actual-tasks.ts) passes **eight grouped checks** on those real metadata exports. Passing means the current behavior/findings were reproduced; it does not mean the defects are repaired. Existing synthetic fixture suites were inspected for coverage but were not run or counted as real-data acceptance.

## Findings and proposed paths

Priorities describe product/runtime impact, not security severity. Stable IDs below should remain attached when implementation is split into smaller changes.

### TA-01 · P1 · Permanent failures block unrelated account work

**Live confirmed + source confirmed.** `queue/index.ts` → `accountOrderBlockedSql` includes older `pending`, `running` **and `failed`** work for the whole user/connection. Except for independent/live kinds and maintenance exceptions, it does not distinguish title, operation or dependency. A missing item's failed reconciliation/delta therefore holds unrelated writes, catalogue scans and user sync. This is the direct cause of the measured blocked backlog.

**Preferred path:** retain ordering for genuinely dependent mutations, but give tasks explicit dependency/conflict scope. Item/category/list/session operations should serialize where their effects overlap. Read-only observations should not inherit unrelated failed mutation barriers. Keep whole-account barriers for the cases that actually require them. A simpler first containment is to isolate read/refresh tasks while retaining current mutation ordering; merely excluding all failures is unsafe.

**Acceptance:** authorized isolated replay of actual failed/pending account rows. Prove unrelated items and reading access scans progress, while watch/reset, history deletion/export, list replacement/removal and account replacement retain their required order. Preserve unresolved user intent and an actionable failure record. No mass cancellation is an acceptable substitute.

### TA-02 · P1 · Backlog amplifies claim-selection database work

**Live measured.** The real candidate-selection plan repeats the account-order subplan **12,623 times**, visiting over four million cached blocks before choosing one row. The claim owner serializes real claims under `queue-claim`; long selection work therefore delays other workers too. The application-matched analogue did not finish within ten seconds.

**Preferred path:** repair eligibility before adding workers. Compare computing account heads/barriers once with the current per-candidate correlated predicate; then assess a supporting index against the resulting query. Maintain one shared predicate contract for execution and waiting explanations. Preserve aging, urgency, cooldowns, generation and feature gates.

**Acceptance:** same actual backlog on an explicitly authorized isolated copy, complete ordered eligible-set equality, then repeated selection/claim timings with matching PostgreSQL/JIT settings and concurrent workers. Include buffer, lock-wait and write/WAL cost. Earlier [task index/query tradeoffs](../2026-10-17-app-performance/implementation-decisions.md) are not a verified repair for this different measured plan. Do not add an index alone on assumption.

### TA-03 · P1 · One stale changed item can poison a whole delta batch

**Live failure class + source confirmed.** Five live delta failures carry `provider.item-unavailable`. `applyCompanionDelta` advances a batch checkpoint only after `syncJellyfinChanges` finishes. The reading path fetches each item before its import catch; a missing-item response escapes and permanently fails the job. Unprocessed siblings then remain behind the failed batch/account barrier. The companion persists acknowledgements and continues creating later page/account jobs, so ingestion can keep adding work while application is blocked.

**Preferred path:** retain per-item checked/deferred/withdrawn results and commit a bounded checkpoint after an authoritative item result. Treat a genuinely removed/inaccessible item separately from authentication, schema failures and incomplete census evidence. Apply withdrawal only within that account/source; do not convert a whole library failure into deletion evidence. Coalesce repeated refresh hints only where the latest-state contract makes that safe; playback/history transitions must retain their semantics.

**Acceptance:** actual failed batch IDs with current authorized Jellyfin reads on a private test installation. Verify missing ID, accessible siblings, changed permissions, account withdrawal and repeated feed-page delivery. Acknowledged changes must be recoverable; no silent skip or false whole-census completion.

### TA-04 · P2 · Waiting/running groups suppress Needs attention

**Actual metadata replay confirmed.** `ui/queue.ts` → `jobTaskSections` assigns a card to Attention only when it has neither pending nor running work. The real reconciliation and delta failure groups therefore remain under Waiting, however old or blocking their failures are. Failure counts are still present in detail/status text; this is a classification/visibility defect, not evidence that notices were never created.

**Preferred path:** make unresolved failures visible regardless of concurrent healthy work. Keep task counts unduplicated; an attention badge/filter or explicit precedence can work without redesigning the interface. Include the blocker and affected scope, not only a generic waiting count.

**Acceptance:** replay the captured real representatives, plus actual mixed running/failure cohorts when available. Needs-attention filtering must find all unresolved failures; task totals and controls must continue to target the original job identities.

### TA-05 · P2 · Run now can report a failed job as already active

**Shared-owner replay + source confirmed; no live command sent.** Maintenance deduplication includes `failed`; forced promotion updates only pending/running rows. A failed recurring job therefore suppresses new work, is counted as active and is not actually retried. `JobSchedule.run` can announce “existing jobs requested now” even though no retry occurred. Actual failed Steam-achievement evidence reproduces the due-owner branch. Metadata/recommendation/taste schedulers also regard failure as active.

**Preferred path:** distinguish running/queued from needs-attention in the result. Run now should either explicitly perform the canonical retry where appropriate or return a clear actionable blocked result. Do not reset permissions, provider cooldown, immutable snapshot or uncertain-delivery safeguards.

**Acceptance:** actual failed recurring rows for each scheduler family, with before/after state/attempts/notification/checkpoint comparison. Verify no duplicate maintenance job, no misleading success notice and no loss of the separate Retry semantics.

### TA-06 · P2 · Bulk controls remain unbounded and partially commit

**Source confirmed; already deferred design work.** `updateTaskActions` reads every matching ID, then invokes canonical retry/cancel/promote sequentially in separate transactions. In the actual census, a reconciliation control could target **8,945** pending rows. A request failure partway through leaves earlier operations committed and returns no durable progress/continuation receipt. The UI's busy state cannot establish all-or-nothing completion.

**Preferred path:** follow the existing [recovery/bulk contract proposal](../2026-10-17-app-performance/candidates/recovery-bulk-contracts/README.md), or choose an explicit bounded selection per request. Preserve canonical per-target semantics and notifications. This report does not revive the previously deferred implementation or authorize a broad SQL UPDATE.

**Acceptance:** authorized copy of the actual matching rows; disconnect/fail after a committed prefix; verify exact updated/skipped/remaining identities, replay without duplicate effects, current-generation filtering, concurrent state changes and retained running work.

### TA-07 · P2 · Reading availability waits behind unrelated import phases

**Live earlier failure + source confirmed.** `runJellyfinScan` puts the reading stage after screen traversal/reconciliation and music stages. Admin's earlier `provider.invalid-data` failure remained in playback reconciliation, before reading; its shared file mappings existed but account access observations were sparse. Cancelling/retrying that job does not remove the structural coupling.

**Preferred path:** give reading/music/screen access independently resumable progress within the current queue, or move their positive observation stage before unrelated history reconciliation. Choose the smallest design that retains complete-census negative publication and account/feature/reset fences. A successful partial medium must not claim the entire account is synchronized.

**Acceptance:** actual mixed-media account/catalogue, failed screen-history record, accessible books/comics and genuine permissions. Prove positive reading access becomes usable independently, and a failed/partial medium never withdraws unseen files or declares other media complete.

### TA-08 · P2 · Some long exports still monopolize a worker/lane

**Source confirmed; real large-export runtime cohort absent.** Trakt list export reads the complete list, sends membership, reconciles removal and ordering without a job cursor/checkpoint. Collection projection reads the complete remote collection, may traverse it again per addition/cleanup batch, and has no cooperative `jobCheckpoint`. Multiple-page history removal and export identity/history lookups have similar whole-operation work. The ten-second/five-boundary rule only works when a handler actually reaches a committed checkpoint. This does not mean individual provider requests have no timeout; they do.

**Preferred path:** preserve stable snapshots and durable delivery attribution, then chunk only at replay-safe boundaries. Retain the existing list sent-snapshot acknowledgement, exact history IDs and uncertain-projection protections. Do not insert yields around a multi-step replacement without defining its continuation/receipt contract.

**Acceptance:** real large list/collection/history cases on a test provider/account, delayed delivery and restart between steps, identical final membership/order/history and no repeated destructive operation. Measure time holding workers/provider lanes, replayed reads and retained bytes. No natural Trakt execution was available in the live task history.

### TA-09 · P2 · Long retry loops have no degraded/attention escalation

**Live confirmed.** The IGDB metadata job had **57 attempts**, remained `pending`, and retained generic `provider.interrupted` failure information with a later retry deadline. Generic transient failures back off to six hours indefinitely. Notices may be sent after three attempts, but the overview still classifies pending retries as Waiting rather than requiring attention. A temporary outage should continue recovering; persistent failure also needs visible escalation and useful cause evidence.

**Preferred path:** preserve automatic recovery while exposing sustained failure/age/last-success separately from terminal failure. Use stable classified reasons; add a deliberate per-task retry/escalation policy rather than one arbitrary global retry cutoff. Keep webhook's separate eight-delivery budget and local-admission credits.

**Acceptance:** replay actual attempt/deadline/history metadata, establish whether the IGDB error is a stable configuration/provider problem, then verify degraded status, recovery after service restoration and no unsafe retry-budget reset.

### TA-10 · P2 · Typed adapter denials lose their remedy information

**Source confirmed; natural typed-denial execution absent.** `registerProviderActions` wraps every `ProviderActionError` as plain `PermanentActionError(error.message)`, discarding its `permission`, `identity` or `invalid-request` code. The common classifier then has no code to choose a permission/identity-specific remedy and generally returns `action.rejected`/retry guidance. Error text alone must not become the classifier.

**Preferred path:** preserve a small typed cause/code at the shared action boundary and map to stable remedies. Keep exception bodies/provider data out of public output. Do not turn every denial into a retryable failure.

**Acceptance:** real adapter denial responses from approved test accounts, matching the current permission/identity branches, through the registered wrapper and task DTO. Check the stored code, requested remedy, notice and retry policy together. Source-level proof is not a claim that the actual 403 failure in this census came through this wrapper.

### TA-11 · P2 · Invalid-data failures omit the useful safe field diagnostic

**Source confirmed, motivated by actual invalid-data history.** `validationDiagnostic` can produce bounded schema paths/types, and its existing unit test checks that provider values are excluded. The worker failure path never calls it; the closed diagnostics fields also do not admit such a structure. Operators are told to review diagnostics but mainly get `provider.invalid-data` and a broad stage. Old root failures can also outlive the seven-day rotating diagnostic store.

**Preferred path:** retain bounded, value-free schema path/type evidence and a durable failure context on the task, with explicit sanitization and retention. Never persist rejected provider values, response bodies, SQL parameters or credentials. A stage and stable handler/task identity should remain useful after routine log rotation.

**Acceptance:** real malformed provider response encountered on an isolated approved account/copy. Verify enough field/type context to identify the incompatibility, strict omission of values and survival of the task's useful explanation after log rotation. No invented malformed response is counted as actual-provider acceptance here.

### TA-12 · P2 · Snapshot expiry can invalidate retained job cursors

**Corrected during implementation:** the original Steam cursor suspicion was false. Its existing owner reads the saved checkpoint only when the matching durable snapshot exists, so missing snapshots already restart. No Steam repair is counted. The confirmed source issue is Seerr reusing `point.next` against a re-fetched expired page, whose membership may have changed. Original retention also removes non-running snapshots, including recoverable pending/failed jobs; the implementation preserves those and tests an actual Seerr page. The initial expiry runtime cohort was absent. See the [correction and acceptance boundary](implementation.md).

**Preferred path:** make snapshot/cursor expiry atomic: preserve a resumable snapshot while its job is recoverable, or explicitly reset to a fresh census with a new epoch and safe publication rules. Avoid reusing a partial-page index against an unrelated response.

**Acceptance:** actual owned-game/request snapshot and cursor, aged only on an approved isolated copy, retention then retry. Verify no permanent self-loop, no skipped new page members, no premature negative ownership/request observation and unchanged personal history.

### TA-13 · P2 · Waiting explanations do not cover every execution gate

**Source confirmed; current positive feature-transition blockage absent.** `pendingEligibleSql` blocks selected tasks behind active/failed feature reconciliation with a cutoff. `actionDetails.waitingReason` has no matching feature-transition branch and can fall through to worker capacity/account order. It reports a broad account-order label without the blocker ID/failure. The code shares some helper predicates but not the complete reason contract.

**Preferred path:** derive eligibility and its primary reason/blocker from one shared owner. Keep feature withdrawal fail-closed. Expose a safe link to the actual failed dependency rather than implying that priority or spare workers can bypass it.

**Acceptance:** approved isolated replay of real transition/account task identities, current generations and cutoff timestamps. Every ineligible result has the same primary gate in selection and presentation; prioritize cannot bypass that gate. No natural blocked feature-transition cohort was present.

### TA-14 · P3 · Success/progress outcomes are inconsistent between handlers

**Source confirmed; some real successes available, Trakt comparison absent.** Several wrappers await domain work and discard its outcome (`trakt.import`, list import/export, projection, request management). Successful no-ops/conflict deferrals can therefore look like unqualified completion. Companion polling resets its local checked count on each yielded invocation, so the final job outcome describes its last invocation rather than an accumulated whole run. Jellyfin success copy calls the count “screen items” even when reading/music stages also ran and those stages do not contribute the same way to `processed`.

**Preferred path:** define small consistent checked/applied/skipped/deferred/review outcome fields at the existing job boundary, with durable counters across yields. Make the displayed scope accurate. Do not fabricate progress totals, duplicate notices or turn a conflict into an applied change.

**Acceptance:** actual successful/no-op/conflict runs and resumed multi-page feed/import jobs. Compare stored outcomes with their complete committed effects and preserve counters across yields. Reuse the existing outcome presenter rather than per-card text implementations.

## Capacity and maintainability watchlist

- The outbox deliberately retains history; the census contains 104,000+ successful rows. That is not permission to delete it. Separate compact active scheduling state from retained evidence only after defining recovery, history, notification and reference retention. Test storage/index growth on actual data.
- The common provider lanes, account generations, bounded action payloads, local-capacity handling, canonical retry/cancel owners, guarded stream observations and several durable import snapshots are useful existing foundations. Preserve them.
- Runtime acceptance is missing for all 21 kinds listed below. This audit is not a production crash/restart test, a browser visual audit, a multi-process takeover test or a remote provider mutation test.
- The live source uses three workers, one urgent-only. Increasing that count before TA-01/02 could multiply database and provider pressure without releasing the blocked work.

## All-handler coverage ledger

“Observed” means real retained tasks exist, not that the handler was executed again by this audit. “Source only” means the live corpus contains no run of that registered kind. Shared TA-01/02/04/05/06/09/10/11/13 concerns apply according to policy; the final column highlights handler-specific boundaries.

| Registered kind | Live history | Handler owner / key boundary |
|---|---|---|
| feature.reconcile | Observed | feature-transition; bounded user/chunk leases; TA-13 gate reporting |
| benchmark.run | Observed | benchmarks/service; bounded read probes, admission reconciliation, new-run-only retry |
| taste.refresh | Observed | social/taste-cache; frozen ten-user census, revision and lease fences; TA-05 |
| planning.reminder | Source only | planning; due/expired/cancelled plan checks; friend notices, no provider dispatch |
| webhook.deliver | Source only | public-api/webhooks; signed event, token checks, eight-delivery budget, local-capacity credit |
| jellyfin.updates | Observed | companion updates; page acknowledgement + durable follow-ups; TA-03/14 |
| jellyfin.delta | Observed | companion delta; bounded checkpointed batches; TA-01/03 |
| jellyfin.streams | Observed | stream-history; generation/lease/time fences, failed reads retain old sessions |
| igdb.steam-metadata | Observed | steam/sync; frozen 500-ID pass; TA-09 actual 57-attempt case |
| steam.sync | Observed | steam/sync; immutable ownership snapshot and fenced chunks; TA-12 |
| steam.achievements | Observed | steam/sync; frozen twenty-title pass, exact owned AppIDs; TA-05 actual failed cohort |
| catalogue.user-scan | Observed | catalogue/maintenance; bounded provider pages and persisted cursors; TA-01/09 |
| tmdb.refresh | Observed | catalogue/maintenance; finite saved batch and per-title deferral; TA-05 |
| tmdb.recommendations | Observed | recommendations/providers; frozen seeds, consent/lease fences |
| igdb.recommendations | Source only | same owner; shared instance identity, gaming policy |
| trakt.recommendations | Source only | same owner; per-account generation and opt-in |
| social.checkin-complete | Source only | social/presence; expiry, duplicate history marker, outbound delivery exclusion |
| jellyfin.live | Observed | social/provider-live; generation/feature/freshness checks |
| steam.live | Observed | same owner; Steam privacy and game feature checks |
| trakt.live | Source only | social/trakt; watching + recent history, duplicate-delivery exclusion |
| trakt.checkin | Source only | social/trakt; started/uncertain receipts; never blindly resend ambiguous delivery |
| seerr.manage | Source only | seerr/requests; remote conflict comparison and account/lease fences |
| trakt.list-delete | Source only | actions wrapper; stable list marker fallback; TA-08 |
| trakt.progress | Source only | trakt-export; exact progress records, local intent comparison |
| seerr.sync | Observed | seerr/requests; staged page, missing confirmation and conflicts; TA-12 |
| history.remove | Source only | history-removal; exact history IDs/timestamps and before/after conflict checks; TA-08 |
| trakt.collection-review | Source only | collection/projection; verified preview/version/snapshot; TA-08 |
| trakt.collection-project | Source only | same owner; uncertain attribution and explicit cleanup preview; TA-08 |
| trakt.collection-cleanup | Source only | same owner; bounded remote write batches, complete confirmation reads; TA-08 |
| jellyfin.reconcile | Observed | jellyfin sync; reconciliation opt-in, current desired value; TA-01 |
| jellyfin.user-state | Source only | same mutation owner; desired/current comparison, scoped acknowledgements |
| jellyfin.scrobble | Observed | jellyfin sync; actual playback session/account source, shared sessions excluded |
| trakt.scrobble | Source only | trakt-export; durable uncertain completion before delivery, confirmed deduplication |
| jellyfin.library | Observed | jellyfin sync; shared mappings, source proof, complete-census negatives |
| jellyfin.bootstrap | Source only | same owner; personal-first import, separate availability follow-up |
| jellyfin.sync | Observed | same owner; resumable multi-medium account census; TA-07 |
| trakt.import | Source only | trakt-import/staging; stage/activity fences, durable application/cleanup; TA-14 |
| trakt.lists-import | Source only | same owners; independent list stages and negative reconciliation |
| trakt.list-export | Source only | trakt-lists; sent snapshot acknowledgement, marker, membership/rank; TA-08/14 |
| trakt.export | Source only | trakt-export; current desired value, verified identity, duplicate-history checks |
| seerr.request | Observed | seerr/requests; request identity, exact linked account/generation; replay needs test provider |

Retired `jellyfin.scan` appears in retained history but has no active representative; it is not a missing current handler. The suspected multi-kind bulk-control defect was discarded after checking `serviceTasks`: normalization already produces one kind per task card. Benchmark cancellation/admission orphaning was also discarded after finding its existing `reconcile` owner. Do not implement fixes for those discarded candidates.

## Implementation and verification checklist

No checkbox below is an implemented repair.

- [ ] **Containment proposal:** review actual failed blockers and their source cause individually; define exact retry/cancel/defer intent before operating the live queue. Resolve permission/metadata errors rather than mass retrying or clearing accepted changes.
- [ ] **First shared repair:** TA-01 dependency scope + TA-03 poison-item handling. Test original vs candidate using the actual failed backlog on an approved isolated copy; preserve dependent mutations and complete-census publication.
- [ ] **Selection performance:** TA-02 query/index options after semantics are fixed. Compare full eligible order, CPU/buffers, claim lock duration and concurrency under the same data/configuration. No claimed speedup until both correctness and improvement pass.
- [ ] **Visibility/control repair:** TA-04, TA-05, TA-09 and TA-13 through the common task DTO and presenters. Real administrator browser acceptance must cover mixed states, Needs-attention filtering, blocker links, Run now, Retry, Prioritize and Cancel waiting work.
- [ ] **Durability/long work:** TA-06/08/12, respecting the earlier deferred receipt/snapshot design decisions. Explicitly approve any necessary new storage/continuation complexity before adoption.
- [ ] **Diagnosis/outcomes:** TA-10/11/14 at the common classification/DTO boundary, with bounded sanitized evidence and honest counters.
- [ ] **Provider cohorts:** obtain real test-account cases for the 21 source-only kinds before claiming all handlers are runtime accepted. No writes to real users' external histories/lists/requests for a read-only audit.
- [ ] **Recovery schedules:** interrupted request, database restart, lost lease, concurrent worker takeover, account replacement, feature withdrawal, expired snapshots, provider cooldown, permanent missing item, repeated hints and partial bulk failure on approved actual-data copies/test providers.
- [ ] **Drift:** update source hashes, run the real metadata replay, retain before/after results and compare all affected callers. Preserve failure/timeout receipts and missing-cohort labels. Do not replace an old proof with a new hash unless it was actually rerun.

To replay the exact original lightweight checks, from the repository root:

```sh
bun docs/audits/2026-10-20-task-system/verify-actual-tasks.ts \
  .data/task-audit-20261020/readonly-task-evidence.private.json \
  .data/task-audit-20261020/accounts.private.json
```

For a fresh census, run `python3 docs/audits/2026-10-20-task-system/collect-readonly.py`, then pass its printed timestamped JSON path to the verifier; new exports include account context and need no third argument. Existing receipts are not overwritten.

The collector needs permitted access to Apple Container `coast`; it performs selected READ ONLY queries and stores only the narrow private metadata described above. The original audit exported account context separately; its exact replay accepts `.data/task-audit-20261020/accounts.private.json` as a third argument. Do not run ordinary database fixture suites against live Coast. Expensive selection probes are not part of this collector and should be repeated on an approved isolated copy after this audit's live timeout evidence.
