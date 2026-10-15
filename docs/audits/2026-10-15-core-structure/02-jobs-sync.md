# Jobs, synchronization and provider delivery audit

Date: 2026-10-15. Section: JOBS. Reviewed the current working tree, including current untracked feature files, without substituting historical HEAD implementations.

## Scope and method

Read-only engineering review of durable queue claims, account/service lanes, retries, cooldowns, priorities, resumption, staged Trakt reconciliation, exports, conflicts, Seerr identity/delivery and Queue projections. Followed relevant canonical list writes, current source-disconnect workflow and staging migration triggers across their boundaries. No application code, tests, configuration or data changed. Findings are strong static traces; the small pure reproduction confirms the comparison decision, while complete DB/provider fixture reproductions remain unrun.

The machine-readable companion gives the exact substantive-read and search/targeted-scan inventories separately. Large test files shown partially are classed as scanned. Detailed Jellyfin traversal and per-user evidence belong to the separate Jellyfin review. There is no current application/integrations.server.ts; provider-sources.server.ts owns the relevant workflow.

## Coverage and healthy patterns

- The existing outbox is the active scheduler. Maintenance uses shared task timing/eligibility rules with the Jobs read model, and exact account-generation identity prevents ordinary deduplication from collapsing different personal accounts.
- Claims and Queue display share priority/eligibility SQL. Promotion retains retry/backoff and service cooldown gates. One worker reserves urgent capacity; service traversal and account advisory locks address overlapping execution separately from HTTP priority.
- The common request lane preserves task context, queued cancellation and dynamic job/resource priority. The focused tests passed its currently covered cases.
- Trakt staging commits durable raw pages/cursors before application, sorts history oldest-first, uses per-record applied markers, checks activity fences before absence reconciliation and bounds safe worker yields. Its migrations remove stage/record state on terminal success/cancellation and account replacement; retention provides a final stale bound.
- Canonical tracking/rating writes and outbound intent share transactions. History removal targets exact provider history IDs and refuses ambiguous timestamps. These are useful existing boundaries for the list recommendations.
- Seerr scheduled observation publication has an explicit dual-account/lease guard, filters personal request scans and confirms missing IDs individually before declaring cancellation. Delivery should reuse those same guards.
- Queue task counts are independent of the bounded diagnostic sample, and representative jobs preserve current-generation totals. UI changes are unnecessary for the findings.

## Checks

36 focused existing non-DB tests passed (168 assertions) across eight files. No database test, browser session, live provider, server, check or build was run. A pure call to decideSync returned remote for the falsely acknowledged [A,B] snapshot versus actual [A], and local for the correctly acknowledged [A] snapshot.

## Prioritized findings

### JOBS-01 — P1: Queued Seerr delivery can wait forever on its own account lane

Confidence: strong-static. Category: correctness.

**Trigger:** Queue a Seerr request or management operation for connected account A. Before dispatch, change the linked Jellyfin account, or its Seerr mapping, to B while leaving the Seerr connection pointing at A. Dispatch now resolves B and enters saveConnection for the same Seerr connection.

**Impact and cause:** The handler awaits a lock that its own worker session holds. PostgreSQL does not see the JavaScript dependency as a database deadlock. The worker remains occupied and keeps its lease live; the transaction also holds the global connection-linking lock, blocking unrelated linking until interrupted.

**Evidence:**
- `src/lib/providers/actions.server.ts:78` — seerr.manage resolves getSeerr without the queued connection/generation; seerr.request does the same at line 322.
- `src/lib/providers/seerr/connection.server.ts:74` — Only callers supplying expected reject a changed mapping; otherwise lines 76-85 call saveConnection.
- `src/lib/providers/connections.server.ts:44` — saveConnection waits for queue-lane:<user>:<existing connection> on its own transaction after acquiring global connection-linking advisory lock 73001602.
- `src/lib/server/queue/index.ts:272` — The executing delivery already holds that same session advisory lane until its awaited handler completes; its heartbeat runs every 20 seconds at lines 299-303.

**Minimal correction:** Require action.connectionId and action.accountGeneration in both Seerr delivery handlers and pass them to getSeerr, as seerr.sync already does. Reject changed mappings instead of establishing/remapping an account from queued work; keep account linking in the existing foreground workflow.

**Verification:** Disposable DB/provider fixture: queue seerr.request and seerr.manage under A, then have the verified Jellyfin lookup return Seerr B before execution. Both jobs must terminate with a controlled account-changed failure, never call saveConnection or the remote mutation, release the worker lane, and permit an unrelated saveConnection.

### JOBS-02 — P1: List export acknowledges edits made after its transmitted snapshot

Confidence: strong-static. Category: correctness.

**Trigger:** Export [A]. While writeList/reorderList is in flight, add B or change order locally. The outer acknowledgement rereads [A,B] although the provider still has [A]. The next queued export or scheduled import reads [A].

**Impact and cause:** The newer local edit is falsely recorded as delivered. Reconciliation classifies [A] as a remote change and replaces [A,B] with [A], silently losing B or the newer ordering even under the default manual-conflict preference.

**Evidence:**
- `src/lib/sync/trakt-lists.server.ts:171` — exportTraktListToAdapter captures ordered local screen membership, then sends that snapshot at line 195 and awaits more remote requests.
- `src/lib/sync/trakt-lists.server.ts:108` — The outer executeTraktListExport rereads current listItems after delivery and acknowledges those current members, combined with the earlier list name/description, at lines 113-117.
- `src/lib/sync/list-values.server.ts:198` — Acknowledgement saves the supplied value as both remote and agreed.
- `src/lib/sync/values.server.ts:137` — A following remote observation wins whenever local equals the incorrectly saved agreed value.
- `src/lib/sync/list-values.server.ts:125` — A remote decision atomically replaces local list membership; applyListValue deletes all existing members at line 43.

**Minimal correction:** Capture one exact name/description/ordered-members snapshot and return the successfully delivered snapshot from the existing export helper for acknowledgement. Never derive the remote baseline by rereading mutable local state after network work. Preserve later local edits as divergence from that captured snapshot.

**Verification:** Disposable DB fixture with a gated fake Trakt transport: pause after export captured [A], commit local addition B and its queued intent, release transport, then run the next export/import. Assert B remains and is exported or conflicts; assert acknowledged remote equals the sent [A]. Pure decideSync reproduction already returned remote for the incorrect acknowledgement and local for a correct one.

### JOBS-03 — P1: Syncing a mixed-media list can remove its unsupported members from Coast

Confidence: strong-static. Category: correctness.

**Trigger:** With Trakt list sync enabled, create a regular Coast list containing a movie A and a game/book/music work B (or a movie collection), export it, then run the next import/export preflight without any local edits.

**Impact and cause:** Only A is transmitted but [A,B] is acknowledged. The next remote observation [A] is classified as a remote removal because local still equals agreed, so B is deleted from the Coast list. The existing mixed-list test covers movie/show/season identity, not different media categories.

**Evidence:**
- `src/lib/core/lists/service.server.ts:140` — Ordinary list items accept any existing canonical work; only playback playlists reject reading works.
- `src/lib/sync/trakt-lists.server.ts:174` — Export inner-joins media, dropping games/music/reading works, and line 185 additionally skips screen collection-kind entries.
- `src/lib/sync/trakt-lists.server.ts:108` — The acknowledgement query includes every listItems member, including all omitted work kinds.
- `src/lib/sync/list-values.server.ts:198` — All those members are saved as remote/agreed despite never reaching Trakt.
- `src/lib/sync/list-values.server.ts:43` — A subsequent remote-winning reconciliation deletes all local members before inserting the screen-only provider snapshot.

**Minimal correction:** Choose a conservative representability rule in the existing list sync boundary: skip/refuse full-list synchronization for lists containing unsupported members, or explicitly reconcile a screen-only projection while preserving unsupported local members. Do not record omitted members as provider agreement. Fixing only the concurrent snapshot race does not define safe mixed-list round trips.

**Verification:** Disposable DB test: list with movie plus game, music, reading and collection-kind members; execute export, acknowledge and then import the resulting provider list twice. Unsupported local members and their relative intended ordering must survive, or the entire export must be rejected without a baseline. Keep screen movie/show/season ordering tests.

### JOBS-04 — P2: List writes can succeed while their durable export intent is lost

Confidence: strong-static. Category: correctness.

**Trigger:** A process interruption or an outbox insert failure occurs after a list edit commits but before/during queueTraktListChange; alternatively only the first of multiple destination enqueue operations succeeds.

**Impact and cause:** The browser sees success, but the list edit has no durable delivery intent for one or all configured destinations. A later ordinary import with unchanged remote evidence selects local and records it without necessarily scheduling the missing export, so the edit can remain undelivered indefinitely.

**Evidence:**
- `src/lib/server/api/lists.server.ts:18` — Create/update/add/remove/reorder/move operations invoke canonical services and await their completed transactions through line 48.
- `src/lib/server/api/lists.server.ts:53` — Only afterwards is queueTraktListChange called; failures are logged and swallowed before returning a successful mutation response.
- `src/lib/sync/trakt-lists.server.ts:43` — queueTraktListChange inserts each connection's outbound job through separate enqueueAction transactions.
- `src/lib/sync/changes.server.ts:79` — enqueueInTransaction already provides the existing transactional outbox boundary used by canonical tracking/rating workflows.

**Minimal correction:** Place requested list export intent in the same existing database transaction as the canonical list mutation, using enqueueInTransaction and a focused orchestration wrapper/transaction parameter. Remove the best-effort enqueue from the HTTP dispatcher; preserve compaction and ownership checks.

**Verification:** Disposable DB fixture: force the applicable Trakt export insertion to fail during create/update/add/remove/reorder. Assert the canonical mutation and export intents all roll back together, or an existing durable retry intent remains. Repeat with two enabled Trakt connections to verify there is no partial destination commit.

### JOBS-05 — P2: Seerr delivery publishes personal state without the dual-account publication guard

Confidence: strong-static. Category: correctness.

**Trigger:** After getSeerr has verified both identities, disconnect the linked Jellyfin/Seerr account, disable an associated service/user, or invalidate the worker lease while adapter.create/manage/requestDetails is waiting. Then let the remote response return.

**Impact and cause:** The old response still updates local request status or conflict baselines after the account/service/worker has ceased being valid. Scheduled observations already reject this situation, while delivery has different publication semantics. A local guard cannot undo a remote request already accepted before disconnect, but can prevent stale local publication.

**Evidence:**
- `src/lib/providers/seerr/connection.server.ts:17` — assertSeerrAccount checks both linked identities/generations, both enabled services, user status and active job lease inside the committing transaction.
- `src/lib/providers/seerr/requests.server.ts:359` — refreshRequests uses that guard for each observation publication.
- `src/lib/providers/actions.server.ts:322` — seerr.request discards the returned scope, awaits adapter.create, then writes mediaRequests at lines 330-338 without a guarded transaction.
- `src/lib/providers/actions.server.ts:149` — seerr.manage also writes syncValues/mediaRequests after remote waits without the guard; conflict branches at lines 105-144 are similarly unguarded.
- `src/lib/application/provider-sources.server.ts:15` — A disconnect can change connection status while work runs; this workflow only cancels pending/failed outbox actions at lines 23-30.

**Minimal correction:** Retain the returned Seerr scope and use assertSeerrAccount inside one transaction for each completed delivery/conflict publication, alongside all related mediaRequests and syncValues writes. Pin queued identity as in JOBS-01; retain provider-side permission rechecks.

**Verification:** Disposable DB fake transport: gate request creation/management after getSeerr, invalidate each linked generation/status/service or job lease, release response, and assert no stale mediaRequests/syncValues publication. Verify normal successful request plus baseline writes commit atomically.

## Uncertainties and limits

- No database, browser, provider request, service, check or build was run. Database concurrency and end-to-end delivery reproductions remain to be executed in disposable fixtures; no live-provider pagination guarantees were inferred.
- Detailed Jellyfin traversal, music/reading synchronization and per-user source evidence were assigned to a separate reviewer; no claim of full Jellyfin coverage.
- Steam synchronization, Collection projection, recommendations, public webhooks and provider transport internals were followed only through owned scheduling/dispatch boundaries and relevant references; deeper domain correctness belongs to their reviewers.
- src/lib/application/integrations.server.ts is absent in the current tree; the relevant current workflow is application/provider-sources.server.ts.
- Seerr refreshRequests remains an uninterrupted multi-page traversal without durable checkpoint/yield calls, and full request history is loaded for missing-ID confirmation. Operational latency/memory impact was not measured.
- List export/preflight and baseline acknowledgement lease coverage differs from staged import guards. A stale-lease DB fixture is needed before expanding the confirmed findings.
- Legacy jobs table and its outbox_taste_one_active_idx were reported to the infrastructure reviewer, rather than duplicated as a scheduling finding.

## Minimal ordered recommendations

1. Pin Seerr request/manage jobs to their queued identities so account resolution cannot acquire the worker's own lane (JOBS-01).
2. Return and acknowledge the actual transmitted Trakt list snapshot (JOBS-02). Separately establish conservative handling for lists that cannot be represented in Trakt (JOBS-03); exact snapshot capture alone does not define safe partial-medium reconciliation.
3. Move list outbound intent into the canonical mutation transaction using the existing enqueueInTransaction pattern (JOBS-04).
4. Reuse assertSeerrAccount for delivery/conflict publication after network waits, and commit the request/baseline changes together (JOBS-05).
5. Add the targeted disposable-DB regressions above. Preserve existing account lanes, generation checks, HTTP arbitration, retry gates and the approved Queue UI. No new scheduler, production dependency or broad framework is warranted.

## Inventory

Substantively read (51 files):

- `docs/code-organization.md`
- `docs/architecture.md`
- `docs/performance.md`
- `docs/job-scheduling.md`
- `src/lib/server/queue/index.ts`
- `src/lib/server/queue/execution.ts`
- `src/lib/server/security/request-priority.ts`
- `src/lib/providers/actions.server.ts`
- `src/lib/providers/maintenance.server.ts`
- `src/lib/providers/job-policy.ts`
- `src/lib/providers/task-timing.ts`
- `src/lib/providers/job-timing.server.ts`
- `src/lib/providers/tasks.ts`
- `src/lib/providers/schedule.ts`
- `src/lib/providers/trakt/adapter.server.ts`
- `src/lib/providers/trakt/connection.server.ts`
- `src/lib/providers/seerr/adapter.server.ts`
- `src/lib/providers/seerr/connection.server.ts`
- `src/lib/providers/seerr/requests.server.ts`
- `src/lib/providers/connections.server.ts`
- `src/lib/sync/changes.server.ts`
- `src/lib/sync/conflicts.server.ts`
- `src/lib/sync/preference.server.ts`
- `src/lib/sync/history-removal.server.ts`
- `src/lib/sync/list-values.server.ts`
- `src/lib/sync/values.server.ts`
- `src/lib/sync/trakt-import.server.ts`
- `src/lib/sync/trakt-export.server.ts`
- `src/lib/sync/trakt-lists.server.ts`
- `src/lib/sync/trakt-staging.server.ts`
- `src/lib/sync/trakt-identity.server.ts`
- `src/lib/catalogue/trakt-identity.server.ts`
- `src/lib/application/provider-sources.server.ts`
- `src/lib/core/lists/service.server.ts`
- `src/lib/server/api/lists.server.ts`
- `src/lib/server/api/queue.server.ts`
- `src/lib/ui/queue.ts`
- `src/lib/ui/components/JobsSettings.svelte`
- `src/lib/ui/components/JobSchedule.svelte`
- `src/lib/server/storage/retention.server.ts`
- `src/lib/server/db/index.ts`
- `drizzle/0022_verified_trakt_identity.sql`
- `drizzle/0045_trakt_import_staging.sql`
- `tests/request-priority.test.ts`
- `tests/task-timing.test.ts`
- `tests/trakt-staging-db.test.ts`
- `tests/trakt-collection-lists-staging-db.test.ts`
- `tests/trakt-sync-db.test.ts`
- `tests/seerr-account-scope-db.test.ts`
- `tests/trakt-token-scope-db.test.ts`
- `tests/job-task-summary-db.test.ts`

Targeted scan/search or partial test/implementation inspection (16 files):

- `src/lib/server/db/schema.ts`
- `src/lib/server/security/provider-fetch.ts`
- `src/lib/server/auth/onboarding.ts`
- `tests/maintenance-runner-db.test.ts`
- `tests/task-timing-db.test.ts`
- `tests/provider-sync-db.test.ts`
- `tests/sync-preference-db.test.ts`
- `tests/trakt-history-db.test.ts`
- `drizzle/0016_collection_and_music.sql`
- `drizzle/0046_provider_job_snapshots.sql`
- `tests/ui-queue-actions.test.ts`
- `tests/queue-diagnostics.test.ts`
- `tests/job-outcomes.test.ts`
- `tests/sync-values.test.ts`
- `tests/trakt-history.test.ts`
- `tests/seerr-queries.test.ts`
