# Coast core structure and feature audit

Reviewed 15 October 2026 against the **current working tree**, including pending and untracked implementations. Baseline: `codex/material-rollback` at `6bf96184ca0f86a4b9563f3d36785d5d947902f4`. This is broader than a review of that commit. Existing local changes were preserved.

**57 deduplicated findings** from 59 reported findings: 5 P1, 41 P2, 11 P3. Twelve dedicated specialists reviewed separate feature areas; root reviewed structure, followed cross-feature leads and consolidated the evidence.

The directory layout and naming are broadly coherent. The higher-value work is to make ownership, identity, account generations, transaction boundaries and cancellation rules consistent across the implementations already present. This audit does **not** call for another architecture or a broad file-moving rewrite.

Only audit documents were added to the retained repository sources; verification also generated ignored build/tool output. No application/test/config/dependency/roadmap changes, commits, pushes, merges or deployments were made. Disposable synthetic databases were created and dropped for verification; dev/live data and providers were not used.

The subsequent fix pass is tracked separately in the [57-finding implementation ledger](implementation.md). The audit below remains the original baseline report.

## Read first

- **Database liveness:** [CROSS-03](#cross-03) reproduces a ten-connection pool circular wait; [JOBS-01](#jobs-01) traces a Seerr worker waiting on its own lane lock. These are distinct mechanisms. Neither finding attributes a historical live outage.
- **Data preservation:** [JOBS-02](#jobs-02) and [JOBS-03](#jobs-03) can acknowledge unsent list state or overwrite unsupported members. [DOMAIN-01](#domain-01) can give an already isolated provider item a new canonical UUID on repeated ingestion.
- **Privacy and permissions:** [AUTH-01](#auth-01) finds user reset deleting admin-owned bitrate limits and opt-outs. [DOMAIN-02](#domain-02) finds private playlist context reintroduced into otherwise permitted profile progress.
- **Cross-medium consistency:** music copies, album editions, Steam AppIDs and Reading source/medium gates need exact identity ownership. These are separate repairs, with explicit boundaries in the detailed entries.
- **Lifecycle and tooling:** controller cancellation, response deadlines, migration generation and preview isolation have concrete gaps despite passing type/build checks.

## Structure to retain

- `routes` compose pages and HTTP boundaries; `application` owns cross-domain workflows; `core` owns transactional canonical writes; `catalogue` owns metadata; providers and sync retain their distinct transport/reconciliation responsibilities.
- Shared shelves, client resources, operation generations, provider pacing and the durable queue are already useful mechanisms. Correct inconsistent callers instead of inventing alternatives.
- All **497** source TypeScript/Svelte/JavaScript files were inventoried. The runtime import graph from **114** client roots found no direct or transitive server-only target in the resolved literal imports. Library component names and obvious server suffixes matched conventions. Computed imports are outside that proof.
- The code inventory reported **zero unused modules**, and the UI inventory verified **63 components**. This does not prove every exported helper or database declaration is used.
- Three runtime dependency groups were identified. Deferred sync/controller coordination is not itself an initialization defect; the reader dispatcher/helper dependency has a small ownership correction in STRUCT-02.

## Verification

| Check | Result |
| --- | --- |
| Type check | 0 errors, 0 warnings |
| Default tests | 393 passed, 534 skipped, 0 failed |
| Full disposable database suites | 483 passed, **2 failed**, across 60 suites |
| Production build | Passed |
| Module and UI inventories | Passed |
| Targeted concurrency probe | Single-operation control passed; ten concurrent same-account transactions exhausted pool until one synthetic waiter was cancelled |

The two database failures are stale assertions about unified Search ordering and the expanded six-medium taste profile set; see [DISCOVERY-04](#discovery-04). They still make that suite red and should be corrected through meaningful current-contract assertions. They were not suppressed or edited during this audit.

Specialists also ran focused pure suites and mocked reproductions; their results overlap the default suite and must not be added into an inflated total. Confirmed mechanisms include late controller responses, audio retry fast paths, duplicate music renderer keys, slow-drip response timeout behavior, migration generation drift and pool starvation. Individual entries state what was actually reproduced.

No real browser/device/screen-reader, live provider, VRChat, registry or live-server acceptance was performed this turn. Visual consistency was inspected in source and existing pure chart/component tests; cross-browser behavior, full keyboard/focus behavior, physical playback and real remote semantics remain unverified. Passing checks do not invalidate static race/data-loss findings.

## Priority and confidence

- **P1:** prioritize before broad rollout or unrelated feature work because the reachable path threatens data preservation or application liveness.
- **P2:** concrete functional, privacy, correctness or performance defect with a bounded trigger; address in focused feature changes.
- **P3:** lower-impact contract, tooling, documentation or maintainability correction.
- **Confirmed** means the reported invariant or control flow was directly demonstrated or is directly contradictory in source; it does not certify all downstream production effects. **Strong-static** has an explicit reachable caller and consequence, with a targeted runtime regression still needed.

UI-02 was calibrated from specialist P1 to P2: a deliberate preview action affects the signed-in administrator’s own settings/session; no authorization bypass was established. Original reports retain their independent assessment.

## Deduplication

| Canonical flag | Original reports | Reason |
| --- | --- | --- |
| JELLYFIN-01 | JELLYFIN-01, DOMAIN-03 | One numeric progress intent is dropped/converted at the same export boundary. |
| LIFECYCLE-01 | READING-02, PLAYBACK-02 | One missing stop/close publication invariant, retaining both controller implementations and observed effects. |

Trakt list snapshot races and unsupported-medium loss remain separate: one needs correct in-flight acknowledgement, the other needs projection-safe reconciliation. Music reconciliation, edition membership, source ID normalization and renderer keys also remain separate. Similar symptoms or shared files are not sufficient grounds to combine flags. Every canonical entry below links its original report(s); the [structured report](findings.json) preserves all evidence and original IDs.

## Specialist reports and coverage

| Report | Scope | Reported flags |
| --- | --- | --- |
| [00-structure](00-structure.md) | Repository structure | 2 |
| [01-auth](01-auth.md) | AUTH — authentication, onboarding, invitations, settings and access policy | 5 |
| [02-jobs-sync](02-jobs-sync.md) | JOBS | 5 |
| [03-jellyfin](03-jellyfin.md) | JELLYFIN | 5 |
| [04-domain](04-domain.md) | DOMAIN | 8 |
| [05-discovery](05-discovery.md) | DISCOVERY | 4 |
| [06-reading](06-reading.md) | READING | 4 |
| [07-playback-sharing](07-playback-sharing.md) | PLAYBACK | 4 |
| [08-social-parties](08-social-parties.md) | social-parties | 4 |
| [09-api](09-api.md) | Public API, webhooks and browser API dispatch consistency | 2 |
| [10-ui](10-ui.md) | Shared UI, shelves, materials and preview composition | 3 |
| [11-music-gaming](11-music-gaming.md) | Music, gaming and shared provider contracts | 6 |
| [12-infrastructure](12-infrastructure.md) | Infrastructure: database, common primitives, storage, diagnostics, benchmarks, lifecycle and verification | 4 |
| [13-cross-boundary](13-cross-boundary.md) | Root cross-boundary validation | 3 |

The individual coverage manifests explicitly list substantive relevant-section reading for **497 of 497** source files at consolidation time. Automated inventory covers all source files; other scanned coverage and remaining files are identified in [findings.json](findings.json). This is a coverage ledger, not a claim that every line or runtime combination was verified.

The initial [methodology](methodology.md), [structure inventory](structure-inventory.json), [baseline digests](baseline.json) and [check results](checks.json) are retained. Historical migration snapshots and incidental generated/fixture values were not all compared line by line.

## Findings index

| Flag | Priority | Finding | Confidence |
| --- | --- | --- | --- |
| [CROSS-03](#cross-03) | P1 | Reading API transactions can exhaust the pool while waiting for a query on that same pool | confirmed |
| [DOMAIN-01](#domain-01) | P1 | Repeated conflicting Jellyfin metadata creates a new canonical work each scan | confirmed |
| [JOBS-01](#jobs-01) | P1 | Queued Seerr delivery can wait forever on its own account lane | strong-static |
| [JOBS-02](#jobs-02) | P1 | List export acknowledges edits made after its transmitted snapshot | strong-static |
| [JOBS-03](#jobs-03) | P1 | Syncing a mixed-media list can remove its unsupported members from Coast | strong-static |
| [API-01](#api-01) | P2 | Exhausted webhook events cannot be recovered with manual Retry | confirmed |
| [AUTH-01](#auth-01) | P2 | Restoring personal preferences erases administrator bitrate limits and privacy opt-outs | strong-static |
| [AUTH-02](#auth-02) | P2 | Trakt authentication failure during onboarding has no usable reconnect path | strong-static |
| [AUTH-03](#auth-03) | P2 | The public setup action hashes passwords after setup without a rate limit | strong-static |
| [CROSS-01](#cross-01) | P2 | Source-based Reading gates block Open Library comics in Comics-only mode | strong-static |
| [CROSS-02](#cross-02) | P2 | Reading file import requires remote metadata for already registered secondary identities | strong-static |
| [DISCOVERY-01](#discovery-01) | P2 | Unified Search repeats registered games as unavailable provider results | strong-static |
| [DISCOVERY-02](#discovery-02) | P2 | Discover's local cache survives source and content changes | confirmed |
| [DISCOVERY-03](#discovery-03) | P2 | Recommendation candidate cutoff can discard every relevant genre or author match | strong-static |
| [DOMAIN-02](#domain-02) | P2 | Shared progress exposes the owner’s private playlist name and entry context | confirmed |
| [DOMAIN-04](#domain-04) | P2 | The metadata refresh menu action never gets a refresh target | strong-static |
| [DOMAIN-05](#domain-05) | P2 | Release-date actions use stale fallback dates after metadata enrichment | strong-static |
| [DOMAIN-06](#domain-06) | P2 | New provider episodes leave stored show and season completion stale | strong-static |
| [DOMAIN-07](#domain-07) | P2 | Available filmography pages hydrate the full registered filmography before paging | strong-static |
| [INFRA-01](#infra-01) | P2 | Buffered provider responses have no completion deadline | confirmed |
| [INFRA-02](#infra-02) | P2 | Migration snapshots lag applied SQL and regenerate existing schema | confirmed |
| [INFRA-03](#infra-03) | P2 | Older successful image workflows can move preview backwards | strong-static |
| [JELLYFIN-01](#jellyfin-01) | P2 | Manual progress changes lose their numeric outbound value | confirmed |
| [JELLYFIN-02](#jellyfin-02) | P2 | Music copies overwrite canonical observations in provider item order | strong-static |
| [JELLYFIN-03](#jellyfin-03) | P2 | Companion reset accepts a user baseline started before lost events | strong-static |
| [JELLYFIN-04](#jellyfin-04) | P2 | Companion session DTO drops shared-stream deduplication identity | confirmed |
| [JELLYFIN-05](#jellyfin-05) | P2 | Music and reading scans publish negative coverage after unstable pagination | strong-static |
| [JOBS-04](#jobs-04) | P2 | List writes can succeed while their durable export intent is lost | strong-static |
| [JOBS-05](#jobs-05) | P2 | Seerr delivery publishes personal state without the dual-account publication guard | strong-static |
| [LIFECYCLE-01](#lifecycle-01) | P2 | Closing a reader or stopping playback does not invalidate all pending preparation | confirmed |
| [MEDIUM-01](#medium-01) | P2 | Album membership loses track occurrences and mixes release editions | strong-static |
| [MEDIUM-02](#medium-02) | P2 | Equivalent Jellyfin GUID spellings become separate music identities | strong-static |
| [MEDIUM-03](#medium-03) | P2 | Merged music copies collide with keyed card renderers | confirmed |
| [MEDIUM-04](#medium-04) | P2 | Steam AppID aliases overwrite account playtime and achievement state | strong-static |
| [PLAYBACK-01](#playback-01) | P2 | Personal playback can publish scrobbles into a replacement source account | strong-static |
| [PLAYBACK-03](#playback-03) | P2 | Audio Try again resumes the failed session instead of preparing a replacement | confirmed |
| [PLAYBACK-04](#playback-04) | P2 | Slow shared cleanup overlaps maintenance ticks and delays ordinary scheduling | confirmed |
| [READING-01](#reading-01) | P2 | Failed final bookmark drain silently closes and discards retry state | confirmed |
| [READING-03](#reading-03) | P2 | Session preparation can insert an old bookmark after Reread reset | strong-static |
| [READING-04](#reading-04) | P2 | Reading item replacement can revoke the initiating party participant | strong-static |
| [SOCIAL-01](#social-01) | P2 | A failed party source stays unavailable after the host changes its edition | confirmed |
| [SOCIAL-02](#social-02) | P2 | Recommendation send and response lock the same rows in opposite orders | strong-static |
| [SOCIAL-03](#social-03) | P2 | The paged Taste page rebuilds and transfers both complete libraries | strong-static |
| [SOCIAL-04](#social-04) | P2 | Saving a music relationship hides its actual progress in friend comparisons | strong-static |
| [UI-01](#ui-01) | P2 | Ordinary menu buttons remain open because keepOpen defaults to true | strong-static |
| [UI-02](#ui-02) | P2 | The isolated Header preview can change the real user’s presence settings and sign them out | strong-static |
| [API-02](#api-02) | P3 | Explicit public HEAD exports reject existing readable resources | confirmed |
| [AUTH-04](#auth-04) | P3 | Deleting a disabled administrator incorrectly trips the last-active-admin guard | strong-static |
| [AUTH-05](#auth-05) | P3 | The first-run HTTP journey no longer supplies the required setup fields | confirmed |
| [DISCOVERY-04](#discovery-04) | P3 | Two database assertions still encode the previous Search/taste contracts | confirmed |
| [DOMAIN-08](#domain-08) | P3 | Creating a playlist with an initial reading work bypasses its membership rule | strong-static |
| [INFRA-04](#infra-04) | P3 | Taste-outbox uniqueness index targets runtime-unused jobs table | confirmed |
| [MEDIUM-05](#medium-05) | P3 | Normal canonical music links discard stored artist navigation | strong-static |
| [MEDIUM-06](#medium-06) | P3 | Removing an IGDB parent does not remove the old verified variant link | strong-static |
| [STRUCT-01](#struct-01) | P3 | Dense compound source has no consistent authoring guard | confirmed |
| [STRUCT-02](#struct-02) | P3 | Reader engines depend on their dispatcher for a shared cancellation helper | confirmed |
| [UI-03](#ui-03) | P3 | The design guide contradicts the current mobile navigation and material inventory | confirmed |

## Detailed findings

### CROSS-03

**P1 · correctness · confirmed — Reading API transactions can exhaust the pool while waiting for a query on that same pool**

**Trigger:** Ten concurrent same-account reading API writes: first holds account lock, other nine hold pool connections waiting for that lock, and first needs another pooled connection for config.

**Impact:** The first cannot release the account lock and the waiters cannot release their connections. Unrelated DB requests also queue behind the exhausted pool. Reproduced until a test waiter was cancelled; no claim that a specific live outage was caused by this.

**Evidence:**

- [src/lib/server/db/index.ts:27](../../../src/lib/server/db/index.ts#L27) — Application pool is bounded to ten connections.
- [src/lib/server/public-api/mutations.server.ts:40](../../../src/lib/server/public-api/mutations.server.ts#L40) — Public writes already fetch config outside their transaction, then take the account advisory lock at line43.
- [src/lib/server/public-api/mutations.server.ts:62](../../../src/lib/server/public-api/mutations.server.ts#L62) — Reading write invokes updateReading inside the existing locked transaction.
- [src/lib/core/reading/service.server.ts:37](../../../src/lib/core/reading/service.server.ts#L37) — Transaction helper calls global getConfig rather than using its transaction or the prefetched config.
- [src/lib/server/config.ts:66](../../../src/lib/server/config.ts#L66) — Default getConfig database is getSql(), so this read needs another free pooled connection.

**Correction:** Remove independent pool acquisition inside the transaction: pass already resolved config into the transactional reading service or read config on the same transaction, following existing transaction-aware service patterns. Inspect analogous nested global reads without increasing the pool as a workaround.

**Verification:** Retain a bounded isolated regression with ten same-account operations plus unrelated read, verify all settle without external cancellation and no extra connection is required; preserve token/idempotency/account locking and disabled-medium checks.

**Original audit:** [CROSS-03](13-cross-boundary.md).

### DOMAIN-01

**P1 · correctness · confirmed — Repeated conflicting Jellyfin metadata creates a new canonical work each scan**

**Trigger:** Two existing movies own conflicting TMDB/IMDb identifiers. Import a Jellyfin movie advertising both with isolateConflictingProviderIds=true, then import that same instance/item again during shared library refresh.

**Impact:** The second and every subsequent refresh create another UUID while the scoped external-ID mapping remains attached to the first isolated UUID. The provider item and future user-access/import paths move to the newer work; personal state and lists retained under the previous UUID stop matching the accessible item. This breaks canonical identity stability and accumulates duplicate records.

**Evidence:**

- [src/lib/catalogue/service.server.ts:94](../../../src/lib/catalogue/service.server.ts#L94) — Third-party identifiers are iterated before the appended instance-scoped Jellyfin identifier.
- [src/lib/catalogue/service.server.ts:119](../../../src/lib/catalogue/service.server.ts#L119) — Conflict isolation discards the selected mediaId, keeps only the Jellyfin identifier and breaks without looking up that identifier.
- [src/lib/catalogue/service.server.ts:158](../../../src/lib/catalogue/service.server.ts#L158) — An unresolved identity creates another media/work; later external-ID insertion uses onConflictDoNothing at line 204.
- [src/lib/sync/jellyfin.server.ts:350](../../../src/lib/sync/jellyfin.server.ts#L350) — Shared library ingestion enables conflict isolation and updates providerItems.mediaId to the newly returned work at line 371; knownItems reuse is only for userScope at line 571.
- [tests/provider-db.test.ts:193](../../../tests/provider-db.test.ts#L193) — Existing isolation test checks its first ingestion, without a repeated ingestion assertion.

**Correction:** Resolve and retain an existing instance-scoped Jellyfin identity before choosing an isolated identity. When provider aliases conflict, discard only the conflicting aliases, keep the established scoped work, and preserve the current ordered identity locks.

**Verification:** The exact identity-resolution block was executed in memory with mappings tmdb:one->A, imdb:two->B, jellyfin:instance:local->ISOLATED. It returned mediaId undefined and only the Jellyfin ID, selecting the new-record branch. Add a disposable DB regression that repeats the isolated ingestion and checks identical UUID, one scoped mapping, stable provider item, and retained personal tracking.

**Original audit:** [DOMAIN-01](04-domain.md).

### JOBS-01

**P1 · correctness · strong-static — Queued Seerr delivery can wait forever on its own account lane**

**Trigger:** Queue a Seerr request or management operation for connected account A. Before dispatch, change the linked Jellyfin account, or its Seerr mapping, to B while leaving the Seerr connection pointing at A. Dispatch now resolves B and enters saveConnection for the same Seerr connection.

**Impact:** The handler awaits a lock that its own worker session holds. PostgreSQL does not see the JavaScript dependency as a database deadlock. The worker remains occupied and keeps its lease live; the transaction also holds the global connection-linking lock, blocking unrelated linking until interrupted.

**Evidence:**

- [src/lib/providers/actions.server.ts:78](../../../src/lib/providers/actions.server.ts#L78) — seerr.manage resolves getSeerr without the queued connection/generation; seerr.request does the same at line 322.
- [src/lib/providers/seerr/connection.server.ts:74](../../../src/lib/providers/seerr/connection.server.ts#L74) — Only callers supplying expected reject a changed mapping; otherwise lines 76-85 call saveConnection.
- [src/lib/providers/connections.server.ts:44](../../../src/lib/providers/connections.server.ts#L44) — saveConnection waits for queue-lane:<user>:<existing connection> on its own transaction after acquiring global connection-linking advisory lock 73001602.
- [src/lib/server/queue/index.ts:272](../../../src/lib/server/queue/index.ts#L272) — The executing delivery already holds that same session advisory lane until its awaited handler completes; its heartbeat runs every 20 seconds at lines 299-303.

**Correction:** Require action.connectionId and action.accountGeneration in both Seerr delivery handlers and pass them to getSeerr, as seerr.sync already does. Reject changed mappings instead of establishing/remapping an account from queued work; keep account linking in the existing foreground workflow.

**Verification:** Disposable DB/provider fixture: queue seerr.request and seerr.manage under A, then have the verified Jellyfin lookup return Seerr B before execution. Both jobs must terminate with a controlled account-changed failure, never call saveConnection or the remote mutation, release the worker lane, and permit an unrelated saveConnection.

**Original audit:** [JOBS-01](02-jobs-sync.md).

### JOBS-02

**P1 · correctness · strong-static — List export acknowledges edits made after its transmitted snapshot**

**Trigger:** Export [A]. While writeList/reorderList is in flight, add B or change order locally. The outer acknowledgement rereads [A,B] although the provider still has [A]. The next queued export or scheduled import reads [A].

**Impact:** The newer local edit is falsely recorded as delivered. Reconciliation classifies [A] as a remote change and replaces [A,B] with [A], silently losing B or the newer ordering even under the default manual-conflict preference.

**Evidence:**

- [src/lib/sync/trakt-lists.server.ts:171](../../../src/lib/sync/trakt-lists.server.ts#L171) — exportTraktListToAdapter captures ordered local screen membership, then sends that snapshot at line 195 and awaits more remote requests.
- [src/lib/sync/trakt-lists.server.ts:108](../../../src/lib/sync/trakt-lists.server.ts#L108) — The outer executeTraktListExport rereads current listItems after delivery and acknowledges those current members, combined with the earlier list name/description, at lines 113-117.
- [src/lib/sync/list-values.server.ts:198](../../../src/lib/sync/list-values.server.ts#L198) — Acknowledgement saves the supplied value as both remote and agreed.
- [src/lib/sync/values.server.ts:137](../../../src/lib/sync/values.server.ts#L137) — A following remote observation wins whenever local equals the incorrectly saved agreed value.
- [src/lib/sync/list-values.server.ts:125](../../../src/lib/sync/list-values.server.ts#L125) — A remote decision atomically replaces local list membership; applyListValue deletes all existing members at line 43.

**Correction:** Capture one exact name/description/ordered-members snapshot and return the successfully delivered snapshot from the existing export helper for acknowledgement. Never derive the remote baseline by rereading mutable local state after network work. Preserve later local edits as divergence from that captured snapshot.

**Verification:** Disposable DB fixture with a gated fake Trakt transport: pause after export captured [A], commit local addition B and its queued intent, release transport, then run the next export/import. Assert B remains and is exported or conflicts; assert acknowledged remote equals the sent [A]. Pure decideSync reproduction already returned remote for the incorrect acknowledgement and local for a correct one.

**Original audit:** [JOBS-02](02-jobs-sync.md).

### JOBS-03

**P1 · correctness · strong-static — Syncing a mixed-media list can remove its unsupported members from Coast**

**Trigger:** With Trakt list sync enabled, create a regular Coast list containing a movie A and a game/book/music work B (or a movie collection), export it, then run the next import/export preflight without any local edits.

**Impact:** Only A is transmitted but [A,B] is acknowledged. The next remote observation [A] is classified as a remote removal because local still equals agreed, so B is deleted from the Coast list. The existing mixed-list test covers movie/show/season identity, not different media categories.

**Evidence:**

- [src/lib/core/lists/service.server.ts:140](../../../src/lib/core/lists/service.server.ts#L140) — Ordinary list items accept any existing canonical work; only playback playlists reject reading works.
- [src/lib/sync/trakt-lists.server.ts:174](../../../src/lib/sync/trakt-lists.server.ts#L174) — Export inner-joins media, dropping games/music/reading works, and line 185 additionally skips screen collection-kind entries.
- [src/lib/sync/trakt-lists.server.ts:108](../../../src/lib/sync/trakt-lists.server.ts#L108) — The acknowledgement query includes every listItems member, including all omitted work kinds.
- [src/lib/sync/list-values.server.ts:198](../../../src/lib/sync/list-values.server.ts#L198) — All those members are saved as remote/agreed despite never reaching Trakt.
- [src/lib/sync/list-values.server.ts:43](../../../src/lib/sync/list-values.server.ts#L43) — A subsequent remote-winning reconciliation deletes all local members before inserting the screen-only provider snapshot.

**Correction:** Choose a conservative representability rule in the existing list sync boundary: skip/refuse full-list synchronization for lists containing unsupported members, or explicitly reconcile a screen-only projection while preserving unsupported local members. Do not record omitted members as provider agreement. Fixing only the concurrent snapshot race does not define safe mixed-list round trips.

**Verification:** Disposable DB test: list with movie plus game, music, reading and collection-kind members; execute export, acknowledge and then import the resulting provider list twice. Unsupported local members and their relative intended ordering must survive, or the entire export must be rejected without a baseline. Keep screen movie/show/season ordering tests.

**Original audit:** [JOBS-03](02-jobs-sync.md).

### API-01

**P2 · correctness · confirmed — Exhausted webhook events cannot be recovered with manual Retry**

**Trigger:** A webhook fails eight HTTP deliveries, permanently fails at claim nine, then an administrator repairs the receiver and presses Retry.

**Impact:** The retried event fails at the attempt guard without contacting the repaired receiver; its immutable event cannot be recovered through the advertised Jobs operation.

**Evidence:**

- [src/lib/server/public-api/webhooks.server.ts:49](../../../src/lib/server/public-api/webhooks.server.ts#L49) — Every attempts >8 invocation throws before HTTP delivery, including an administrator's renewed attempt.
- [src/lib/server/queue/index.ts:238](../../../src/lib/server/queue/index.ts#L238) — Claiming increments the persistent lifetime attempts counter.
- [src/lib/server/queue/index.ts:626](../../../src/lib/server/queue/index.ts#L626) — retryAction restores pending/manual state and next_attempt_at but leaves attempts unchanged.
- [tests/webhooks-db.test.ts:30](../../../tests/webhooks-db.test.ts#L30) — Existing coverage checks exhaustion but does not exercise retryAction followed by a repaired receiver.

**Correction:** Renew a bounded delivery budget for a manually retried exhausted webhook within the existing retry/action lifecycle; preserve event identity, audit evidence and claim fencing rather than removing the cap or indiscriminately resetting active attempts.

**Verification:** Disposable DB: fail eight deliveries, claim exhaustion, invoke real retryAction after mocked receiver recovery, process again and assert original event ID/body delivered once and action succeeded. Retain automatic exhaustion coverage.

**Original audit:** [API-01](09-api.md).

### AUTH-01

**P2 · security · strong-static — Restoring personal preferences erases administrator bitrate limits and privacy opt-outs**

**Trigger:** An ordinary user with an administrator-set 4 Mbps personal ceiling calls POST /api/v1/settings/reset. A user who previously disabled demand sharing or chose private social visibility can trigger the same loss by clicking Restore defaults.

**Impact:** The personal playback limit rises to the installation ceiling (for example 4 to 120 Mbps) without administrator authority. The reset also removes privacy settings, can expose previously private sections to accepted friends, and re-enables missing-demand disclosure to administrators. Removing a sharing grant revokes it rather than granting sharing, so this is not an escalation to sharing permission.

**Evidence:**

- [src/lib/server/auth/index.ts:357](../../../src/lib/server/auth/index.ts#L357) — Any authenticated user can reset settings; the SQL preserves only profile and removes every other settings key.
- [src/lib/server/auth/index.ts:260](../../../src/lib/server/auth/index.ts#L260) — allowPlaybackSharing and personal/shared bitrate controls are administrator-only account patch fields.
- [src/lib/server/api/settings.server.ts:19](../../../src/lib/server/api/settings.server.ts#L19) — POST settings/reset dispatches directly to the ordinary-user reset operation.
- [src/lib/sharing/policy.ts:9](../../../src/lib/sharing/policy.ts#L9) — An absent personal ceiling defaults to the full server limit; absent shared ceiling defaults to 20 Mbps.
- [src/lib/playback/service.server.ts:198](../../../src/lib/playback/service.server.ts#L198) — New playback reads current account settings and applies playbackLimits.personal.
- [src/routes/settings/[[section]]/+page.svelte:461](../../../src/routes/settings/[[section]]/+page.svelte#L461) — Reset is described as appearance, notifications, playback and conflict resolution; privacy exposure changes and removal of administrator controls are not explained.
- [src/lib/collection/demand.server.ts:45](../../../src/lib/collection/demand.server.ts#L45) — Removing shareDemand:false opts the account back into administrator demand visibility.
- [drizzle/0023_swift_the_captain.sql:92](../../../drizzle/0023_swift_the_captain.sql#L92) — Removing social privacy settings falls back to friends audience, including when previously private.

**Correction:** Reset an explicit allowlist of documented personal preference keys using JSONB key removal. Always retain administrator-managed sharing/bitrate fields. Preserve privacy/social/shareDemand unless the product explicitly adds those fields to the reset description and confirmation.

**Verification:** In a disposable DB set personalBitrateMbps=4, sharedBitrateMbps=8, allowPlaybackSharing=true, shareDemand=false and social.audience=private; call reset as that ordinary user and verify policy/privacy keys survive while resettable appearance/subtitle/conflict preferences inherit defaults. Verify subsequent playback remains capped at 4 Mbps.

**Original audit:** [AUTH-01](01-auth.md).

### AUTH-02

**P2 · correctness · strong-static — Trakt authentication failure during onboarding has no usable reconnect path**

**Trigger:** Trakt initial tracking/list import returns 401 after the account has linked, leaving its provider_connections status connected. The user follows the displayed Connect Trakt recovery action.

**Impact:** The user receives Disconnect the current Trakt account before linking another, but cannot access the required disconnect action. Initial imports remain required, so an ordinary new account cannot recover through the supplied UI without administrator intervention.

**Evidence:**

- [src/lib/server/auth/onboarding.ts:174](../../../src/lib/server/auth/onboarding.ts#L174) — An initial-import provider.authentication failure forces reconnect=true and traktLinked=false.
- [src/routes/onboarding/+page.svelte:39](../../../src/routes/onboarding/+page.svelte#L39) — The recovery UI offers Connect Trakt through the onboarding trakt action.
- [src/lib/server/auth/onboarding.ts:106](../../../src/lib/server/auth/onboarding.ts#L106) — The onboarding action delegates to the normal startTraktDevice flow.
- [src/lib/providers/trakt/connection.server.ts:82](../../../src/lib/providers/trakt/connection.server.ts#L82) — startTraktDevice rejects any existing connected connection and requires disconnect first.
- [src/lib/server/queue/index.ts:372](../../../src/lib/server/queue/index.ts#L372) — Provider failure changes the outbox action state/payload; it does not disconnect the connection.
- [src/hooks.server.ts:68](../../../src/hooks.server.ts#L68) — Pending onboarding users are redirected away from Settings and receive 403 for ordinary APIs, including the disconnect route.

**Correction:** Add an owner-scoped onboarding reconnect path through the existing disconnect/source-change workflow, or adapt the existing device-link operation to replace an authentication-failed pending-onboarding connection safely. Retain account-generation invalidation, pinned import evidence and source cleanup; do not broadly exempt provider APIs from onboarding gates.

**Verification:** Extend the disposable onboarding fixture with a still-connected Trakt connection and failed initial import carrying provider.authentication. Exercise the actual recovery action with a local fake Trakt service, complete device authorization, verify stale jobs cannot qualify, then verify both replacement initial imports finish and onboarding completes.

**Original audit:** [AUTH-02](01-auth.md).

### AUTH-03

**P2 · security · strong-static — The public setup action hashes passwords after setup without a rate limit**

**Trigger:** After initial configuration, an anonymous direct HTTP client repeatedly posts valid registration-shaped forms to /setup with the expected Origin header. SvelteKit executes actions before page loaders; enhanced JSON actions also directly execute the action.

**Impact:** Requests cannot create a second first administrator because the transactional lock/check is sound, but each request still invokes an intentionally expensive password hash. The route bypasses login/registration throttling and provides an avoidable unauthenticated CPU/memory pressure path on a small self-hosted server. No load test or resource-exhaustion claim was made.

**Evidence:**

- [src/hooks.server.ts:56](../../../src/hooks.server.ts#L56) — /setup is public regardless of whether installation setup is already complete.
- [src/routes/setup/+page.server.ts:8](../../../src/routes/setup/+page.server.ts#L8) — Only the page loader rejects an already configured installation.
- [src/routes/setup/+page.server.ts:12](../../../src/routes/setup/+page.server.ts#L12) — The POST action has no setup-state or client-rate guard and calls createFirstAdmin after valid registration parsing.
- [src/lib/server/auth/index.ts:107](../../../src/lib/server/auth/index.ts#L107) — Argon2id with memoryCost 19456 and timeCost 2 runs before the transaction checks that users already exist at line 114.
- [src/lib/server/auth/index.ts:124](../../../src/lib/server/auth/index.ts#L124) — The ordinary login path, unlike setup, applies its rate guard before password work.

**Correction:** Reject already-configured setup POSTs before parsing/hashing in the existing action, and apply the existing client-rate limiter before password work while setup is legitimately open. Keep the authoritative locked existence check inside createFirstAdmin for concurrency.

**Verification:** Use an isolated test with a hash spy: when setupRequired is false, repeated valid setup POSTs must produce zero hash calls. When setup is open, requests above the existing client quota must be rejected before hashing; concurrent allowed first-admin attempts must still create exactly one administrator.

**Original audit:** [AUTH-03](01-auth.md).

### CROSS-01

**P2 · correctness · strong-static — Source-based Reading gates block Open Library comics in Comics-only mode**

**Trigger:** Comics enabled, Books disabled; unresolved exact Open Library comic preview or newly linked Jellyfin comic file

**Impact:** Supported graphic novels are rejected/skipped before classification; prior exact file editions can still work

**Evidence:**

- [src/lib/server/experimental.ts:12](../../../src/lib/server/experimental.ts#L12) — Every Open Library detail route requires Books regardless of resolved kind.
- [src/lib/sync/jellyfin-reading.server.ts:25](../../../src/lib/sync/jellyfin-reading.server.ts#L25) — Open Library/ISBN identities are considered only when Books is enabled.
- [src/lib/providers/reading.server.ts:95](../../../src/lib/providers/reading.server.ts#L95) — Metadata details already resolve real kind and apply its authoritative final gate.
- [docs/reading.md:13](../../../docs/reading.md#L13) — Metadata source is explicitly not equivalent to medium.

**Correction:** Use existing aggregate Reading gate before resolution and actual saved/resolved kind gate afterward

**Verification:** Comics-only Open Library preview and exact Jellyfin comic import, plus refusal of real books

**Original audit:** [CROSS-01](13-cross-boundary.md).

### CROSS-02

**P2 · correctness · strong-static — Reading file import requires remote metadata for already registered secondary identities**

**Trigger:** Existing comic saved primarily from Comic Vine with Open Library alias; new Jellyfin file/copy has only alias; metadata unavailable

**Impact:** Redundant fetches and avoidable file availability failure despite known canonical identity

**Evidence:**

- [src/lib/sync/jellyfin-reading.server.ts:18](../../../src/lib/sync/jellyfin-reading.server.ts#L18) — Exact file-edition lookup is local but only covers previously linked file IDs.
- [src/lib/sync/jellyfin-reading.server.ts:31](../../../src/lib/sync/jellyfin-reading.server.ts#L31) — Fallback saved-work lookup checks primary kind/externalId rather than alias registry.
- [src/lib/catalogue/reading.server.ts:39](../../../src/lib/catalogue/reading.server.ts#L39) — Canonical import registers multiple exact provider identities and resolves them at lines59–62.

**Correction:** Resolve exact registered aliases in a bounded local query before optional remote metadata; preserve conflict/feature/access checks

**Verification:** Provider-unavailable fixture must attach new file to registered canonical UUID without metadata fetch; reject unknown/conflicting identities

**Original audit:** [CROSS-02](13-cross-boundary.md).

### DISCOVERY-01

**P2 · correctness · strong-static — Unified Search repeats registered games as unavailable provider results**

**Trigger:** Search for a registered game also returned by configured IGDB, especially a Steam-owned game; multiple IGDB instances amplify duplication.

**Impact:** The same game appears in Available and Unavailable, or twice in Unavailable, with different links. An imported game outside the 60 local results is also incorrectly shown as unavailable through its remote result.

**Evidence:**

- [src/lib/server/queries/search.ts:117](../../../src/lib/server/queries/search.ts#L117) — Reads canonical local game cards with viewer ownership.
- [src/lib/server/queries/search.ts:131](../../../src/lib/server/queries/search.ts#L131) — Maps every IGDB result to a card with raw externalId and a remote detail URL, without looking up game_external_ids.
- [src/routes/search/+page.svelte:21](../../../src/routes/search/+page.svelte#L21) — Concatenates play.items and play.discover without canonical deduplication.
- [src/lib/games/presentation.ts:26](../../../src/lib/games/presentation.ts#L26) — Remote cards without available default to false.
- [src/lib/server/queries/discovery.ts:66](../../../src/lib/server/queries/discovery.ts#L66) — Discover already batches IGDB-to-local identity resolution and restores local ownership.

**Correction:** Resolve bounded IGDB external IDs against game_external_ids in one batch, prefer canonical viewer-scoped cards, and deduplicate the combined game results. Reuse Discover's existing approach without importing new metadata for search cards.

**Verification:** Disposable fixture: registered game with IGDB identity and viewer Steam ownership; stub IGDB search to return it. Assert one canonical card, correct available flag and /games/<UUID> link. Repeat with two IGDB instances and a registered result outside the local first page.

**Original audit:** [DISCOVERY-01](05-discovery.md).

### DISCOVERY-02

**P2 · correctness · confirmed — Discover's local cache survives source and content changes**

**Trigger:** Load Listen/Play in a Discover row, change availability/provider permissions or a relevant feature gate while the shelf remains mounted, refresh route data, then revisit that medium.

**Impact:** Rows can keep withdrawn titles and stale available flags indefinitely for the mounted shelf. Retrying/refetching through source.load also reuses the old success. Playback authorization still needs to be checked separately; this finding does not establish an access-control bypass.

**Evidence:**

- [src/lib/ui/shelves/discovery.svelte.ts:23](../../../src/lib/ui/shelves/discovery.svelte.ts#L23) — Cache key contains only surface/kind/page; no user or content/source revision.
- [src/lib/ui/shelves/discovery.svelte.ts:35](../../../src/lib/ui/shelves/discovery.svelte.ts#L35) — Any cached success returns immediately; even explicit load cannot refresh it.
- [src/lib/ui/shelves/discovery.svelte.ts:53](../../../src/lib/ui/shelves/discovery.svelte.ts#L53) — New initial data replaces only the originally supplied surface; other cached surfaces remain.
- [src/lib/ui/shelves/discovery.svelte.ts:61](../../../src/lib/ui/shelves/discovery.svelte.ts#L61) — Feature withdrawal handling only covers Reading, leaving selected disabled Listen/Play content.

**Correction:** Use existing contentRevisionKey with the viewer and relevant tracking/social revisions, clear affected cached/current content on context change, refetch only activated shelves, and reset disabled Listen/Play selections consistently with Reading.

**Verification:** Compiled current Svelte rune module with injected fake API: load Listen, return to Watch, publish refreshed initial props/context, revisit Listen. Observed exactly one API call and original available:true item retained. Add a focused source test asserting a second request and withdrawn result clearing after revision/gate changes; unchanged session replacement should remain cached.

**Original audit:** [DISCOVERY-02](05-discovery.md).

### DISCOVERY-03

**P2 · correctness · strong-static — Recommendation candidate cutoff can discard every relevant genre or author match**

**Trigger:** Catalogue has >2,000 eligible works and a user's taste cache is absent/stale with no provider matches; positive genre/author/series matches sort beyond the UUID cutoff.

**Impact:** General or More like rows can be empty despite matching titles, or omit the best matches. Results depend on UUID insertion values instead of the evidence these rows promise. New users and users immediately after taste changes are affected.

**Evidence:**

- [src/lib/recommendations/query.server.ts:44](../../../src/lib/recommendations/query.server.ts#L44) — General/seed candidate set includes all eligible works in the category, with no positive genre/author/series predicate.
- [src/lib/recommendations/query.server.ts:53](../../../src/lib/recommendations/query.server.ts#L53) — Limits to 2,000 ordered only by provider score, valid taste score and UUID.
- [src/lib/recommendations/query.server.ts:55](../../../src/lib/recommendations/query.server.ts#L55) — Positive genre/author/series evidence is first scored after that limit.
- [src/lib/recommendations/query.server.ts:56](../../../src/lib/recommendations/query.server.ts#L56) — Nonpositive candidates are then removed; none discarded earlier can fill the page.

**Correction:** Retain bounded candidates, but admit/rank them using positive evidence before truncation. Reuse indexed feature/genre candidate selection already used by taste-cache.server.ts; preserve provider and valid taste matches without genre overlap. Do not replace the bound with an unbounded application scoring pass.

**Verification:** Disposable DB repro: favourite Drama seed; 2,000 eligible lower-UUID Comedy movies; one higher-UUID Drama movie; no provider sets or taste scores. General recommendations should include the Drama movie but current query selects and rejects only the Comedy rows, yielding total=0. Also cover author/series-only reading matches and stale taste revisions.

**Original audit:** [DISCOVERY-03](05-discovery.md).

### DOMAIN-02

**P2 · security · confirmed — Shared progress exposes the owner’s private playlist name and entry context**

**Trigger:** Owner creates and starts a privately named playlist, saves progress for its next movie with that playlist sequence, and shares screen progress with a visitor. Visitor opens /progress?username=OWNER&view=watching&scope=all; the leak also works with collection visibility disabled.

**Impact:** An authorized progress visitor receives the private playlist title, playlist UUID and entry UUID, revealing list membership outside the owner-only list APIs. Sequence decoration also bypasses the final field redaction performed by mediaViews.

**Evidence:**

- [src/lib/server/queries/progress.ts:54](../../../src/lib/server/queries/progress.ts#L54) — A cross-profile watching request requires progress visibility, without permission to inspect private lists.
- [src/lib/server/queries/continuations.ts:136](../../../src/lib/server/queries/continuations.ts#L136) — All started playlists for the owner are read, returning their private names, list IDs and entry IDs in sequenceNext.
- [src/lib/server/queries/progress.ts:170](../../../src/lib/server/queries/progress.ts#L170) — The cross-profile planner invokes owner-only continuationIds and retains its playlist context.
- [src/lib/server/queries/progress.ts:90](../../../src/lib/server/queries/progress.ts#L90) — After viewer-aware card hydration, applySequenceEntry attaches private source/entry IDs and the playlist title becomes captionSubtitle.
- [docs/behaviour.md:95](../../../docs/behaviour.md#L95) — Documents ownership enforcement for every custom-list content request.

**Correction:** Keep private playlist planning/context owner-only. For another viewer, select permitted title-level progress without exporting private playlist source, entry IDs or captions; apply viewer redaction after any remaining sequence decoration.

**Verification:** Executed the current readProgressData and applySequenceEntry bodies in memory with a redacted public card and a private playlist context. The only permission check was progress/screen; output included caption Confidential playlist name and sequence {kind:playlist,id:private-list,entryId:private-entry}. Add a disposable DB test with owner-only lists, visible progress and hidden collection, plus the equivalent route/API request.

**Original audit:** [DOMAIN-02](04-domain.md).

### DOMAIN-04

**P2 · correctness · strong-static — The metadata refresh menu action never gets a refresh target**

**Trigger:** An administrator opens the actions menu of a registered TMDB movie, show, collection, season or episode.

**Impact:** refreshTarget is always null for ordinary database-backed screen cards, hiding the existing manual metadata-refresh action even when the title or parent show has a valid TMDB identity.

**Evidence:**

- [src/lib/server/queries/media-actions.ts:20](../../../src/lib/server/queries/media-actions.ts#L20) — Menu items and requestTarget come from mediaViewsForIds.
- [src/lib/server/queries/media-actions.ts:74](../../../src/lib/server/queries/media-actions.ts#L74) — refreshTarget requires target.tmdbId to be truthy.
- [src/lib/server/queries/media.ts:273](../../../src/lib/server/queries/media.ts#L273) — mediaViews selects only mediaId for TMDB identities and stores presence in a Set; its card return does not assign tmdbId.
- [src/lib/server/queries/media.ts:765](../../../src/lib/server/queries/media.ts#L765) — Only detailsData adds tmdbId afterward; mediaActionData does not use that path.
- [src/lib/ui/components/MediaActions.svelte:770](../../../src/lib/ui/components/MediaActions.svelte#L770) — Administrator Refresh title/show details is rendered only when the menu query returns refreshTarget.

**Correction:** Populate the real external TMDB ID in the established card projection, or resolve refreshable identities explicitly in the menu query. Reuse the existing local batched identity read; do not make a provider call while opening menus.

**Verification:** Seed TMDB identities for movie/show/collection and a show identity for a season/episode; assert mediaActionData.refreshTarget resolves each direct/parent target and stays null for a native title. Existing menu tests do not seed a TMDB identity or assert refreshTarget.

**Original audit:** [DOMAIN-04](04-domain.md).

### DOMAIN-05

**P2 · correctness · strong-static — Release-date actions use stale fallback dates after metadata enrichment**

**Trigger:** Create a title/episode with missing or incorrect release date through catalogue recovery/provider ingestion, then enrich its existing UUID with a correct TMDB date. An administrator release-date override presents the same discrepancy.

**Impact:** The UI can show a known release/air year while its date action is unavailable. A bulk air-date watch can skip all enriched episodes or use an obsolete original date. Collection, demand and projection release filters also read concrete fallback dates, so enrichment does not reliably change release eligibility.

**Evidence:**

- [src/lib/catalogue/maintenance.server.ts:49](../../../src/lib/catalogue/maintenance.server.ts#L49) — Missing TMDB catalogue identities are intentionally created with title/IDs only, leaving media.releaseDate null.
- [src/lib/catalogue/service.server.ts:158](../../../src/lib/catalogue/service.server.ts#L158) — The concrete media releaseDate is set only when the canonical record is first created.
- [src/lib/catalogue/service.server.ts:239](../../../src/lib/catalogue/service.server.ts#L239) — Subsequent complete/detail metadata writes update metadataSnapshots, without updating the fallback media date.
- [src/lib/server/queries/media-actions.ts:24](../../../src/lib/server/queries/media-actions.ts#L24) — releaseDate and hasReleaseDate use media.releaseDate rather than the date resolved for the visible title.
- [src/lib/core/tracking/service.server.ts:555](../../../src/lib/core/tracking/service.server.ts#L555) — Bulk onReleaseDate reads the same fallback column and removes leaves whose fallback date is null or future.

**Correction:** Use one local effective release-date projection with the existing override/provider policy for operational date predicates and returned menu dates. Preserve provider snapshots and overrides; avoid fixing this by unconditionally overwriting higher-priority metadata or hydrating every candidate card.

**Verification:** In a disposable DB, ingest an undated episode, reingest the same identity with a past date and complete=true, then compare resolved card year/menu hasReleaseDate and bulk onReleaseDate event timestamp. Repeat with a corrected future date and administrator override. Assert date eligibility agrees across these paths.

**Original audit:** [DOMAIN-05](04-domain.md).

### DOMAIN-06

**P2 · correctness · strong-static — New provider episodes leave stored show and season completion stale**

**Trigger:** Finish all currently known regular episodes of a show/season. A provider metadata refresh then adds another already released, unwatched regular episode without a personal tracking mutation.

**Impact:** The parent can remain watched with old totals, appear in Collection completed filters, and be excluded from incomplete demand despite its new next episode. Other queries such as Library dynamically inspect episode membership, causing contradictory completion between surfaces until another episode tracking write refreshes the parent.

**Evidence:**

- [src/lib/catalogue/service.server.ts:183](../../../src/lib/catalogue/service.server.ts#L183) — Canonical episode insertion adds subtype membership without refreshing any existing parent tracking rows.
- [src/lib/catalogue/service.server.ts:303](../../../src/lib/catalogue/service.server.ts#L303) — TMDB show refresh imports all seasons/episodes and marks metadata complete, without an aggregate refresh afterward.
- [src/lib/core/tracking/service.server.ts:347](../../../src/lib/core/tracking/service.server.ts#L347) — Parent totals/completion are recalculated only through refreshAncestors after personal tracking changes.
- [src/lib/core/media/service.server.ts:89](../../../src/lib/core/media/service.server.ts#L89) — Manual episode addition explicitly recalculates parent totals/watched for this same membership-growth case.
- [src/lib/collection/query.server.ts:203](../../../src/lib/collection/query.server.ts#L203) — Collection completed predicates trust tracking_state.watched; ordinary cards also use stored completedEpisodes/totalEpisodes at media.ts:445.

**Correction:** Refresh existing parent completion/total projections when canonical episode membership grows, preserving historical play counts, drop choices and watch events. Reuse the established aggregate rules and coordinate with current tracking transactions; the manual-add path provides an existing minimal pattern.

**Verification:** Seed a one-episode show and season, mark the episode watched, then ingest a second released episode through ingestMetadata. Assert show/season totalEpisodes=2 and watched=false, while playCount/history remain intact and Collection completed/demand agree with Library. Repeat with a special episode, which must not change regular completion.

**Original audit:** [DOMAIN-06](04-domain.md).

### DOMAIN-07

**P2 · performance · strong-static — Available filmography pages hydrate the full registered filmography before paging**

**Trigger:** Open or paginate Library/Available credits for a prolific person whose hundreds or thousands of credits are already registered.

**Impact:** Every 24-card request loads full personal/metadata/artwork projections for the entire registered filmography, then discards almost all of them. Database work, allocations and concurrent hydration scale with total credits rather than the visible page. No production latency or memory threshold is claimed.

**Evidence:**

- [src/lib/catalogue/details.server.ts:95](../../../src/lib/catalogue/details.server.ts#L95) — Library/available scope resolves all matching registered credit identities.
- [src/lib/catalogue/details.server.ts:111](../../../src/lib/catalogue/details.server.ts#L111) — Every matching work is passed to mediaViewsForIds solely to test its available flag.
- [src/lib/catalogue/details.server.ts:128](../../../src/lib/catalogue/details.server.ts#L128) — Counting and slicing to 24 visible credits happen only after the full card hydration.
- [src/lib/server/queries/media.ts:518](../../../src/lib/server/queries/media.ts#L518) — mediaViewsForIds executes all 500-card batch hydrations concurrently; each hydration loads personal state, metadata, artwork and availability.

**Correction:** Filter registered credit identities using the existing viewer-scoped permitted-availability SQL before counting/slicing, then hydrate only the selected 24 works. Keep provider/person response caching, kind-aware external IDs and visitor permissions unchanged.

**Verification:** Use a disposable fixture with 1,000 registered credits and several viewer-specific grants. Instrument hydration calls and assert no more than the visible 24 IDs are hydrated per request, while totals/page clamping and film/show identity collisions retain identical results.

**Original audit:** [DOMAIN-07](04-domain.md).

### INFRA-01

**P2 · correctness · confirmed — Buffered provider responses have no completion deadline**

**Trigger:** An approved provider emits small chunks inside each idle timeout but takes much longer than timeoutMs to finish a metadata/JSON body.

**Impact:** Operation and same-origin followers can remain blocked far beyond configured timeout; durable workers/service locks can be occupied beyond normal recovery periods. Mocked30ms request completed after174ms.

**Evidence:**

- [src/lib/server/security/provider-fetch.ts:125](../../../src/lib/server/security/provider-fetch.ts#L125) — limitedBody starts a new timeout for each individual reader.read and clears it at161.
- [src/lib/server/security/provider-fetch.ts:250](../../../src/lib/server/security/provider-fetch.ts#L250) — Original configured DNS/header timer is cleared when the wrapped response is returned,before body consumption finishes.
- [src/lib/server/security/provider-fetch.ts:317](../../../src/lib/server/security/provider-fetch.ts#L317) — Buffered calls await the full body while holding the common per-origin lane at324.

**Correction:** Keep an overall deadline through buffered response consumption and cancel its upstream body on expiry,while preserving byte limits,caller abort,priority/cooldown,and long media-stream idle timeouts.

**Verification:** Abort-aware mocked body emits chunks inside idle limit beyond total deadline;expect TimeoutError,cancelled upstream and progress of a queued same-origin request. Retain stream and caller-cancellation cases.

**Original audit:** [INFRA-01](12-infrastructure.md).

### INFRA-02

**P2 · verification · confirmed — Migration snapshots lag applied SQL and regenerate existing schema**

**Trigger:** Developer runs the exposed db:generate command for the next schema change or with no change.

**Impact:** Generated migration tries to recreate existing tables/columns and fails when applied unless manually repaired;fresh-chain DB tests alone do not detect generation baseline drift.

**Evidence:**

- [package.json:20](../../../package.json#L20) — db:generate uses standard drizzle-kit generation.
- [drizzle/meta/_journal.json:307](../../../drizzle/meta/_journal.json#L307) — Journal includes0043 through0051,but latest saved snapshot is0042_snapshot.json.
- [drizzle/0047_reading_experiments.sql:1](../../../drizzle/0047_reading_experiments.sql#L1) — reading_works is already created in the applied chain,yet absent from0042 generation baseline.
- [drizzle/0051_shared_request_leases.sql:1](../../../drizzle/0051_shared_request_leases.sql#L1) — share_request_leases is already created in the chain,yet regenerated by the current schema diff.
- [src/lib/server/db/schema.ts:1024](../../../src/lib/server/db/schema.ts#L1024) — Current model declares reading_works and later additions;in-memory generator produced69 statements including ten duplicate table creations.

**Correction:** Synchronize the latest generation snapshot with schema already represented by0043-0051,retain applied SQL/custom function history,and add a focused no-op generation check. Do not apply duplicate generated SQL.

**Verification:** Current-schema generation diff should be empty;isolated temporary schema change should generate only that change. Replay normal migration chain in a disposable DB during implementation.

**Original audit:** [INFRA-02](12-infrastructure.md).

### INFRA-03

**P2 · correctness · strong-static — Older successful image workflows can move preview backwards**

**Trigger:** Older run A completes its builds after newer B has published,or an older workflow is rerun.

**Impact:** preview may point to older application/schema code after newer code was available;Compose preview users can pull an unintended older revision. No live rollback was observed.

**Evidence:**

- [.github/workflows/verify-and-publish-preview.yml:125](../../../.github/workflows/verify-and-publish-preview.yml#L125) — Each publish waits only for its own image matrix;earlier verify/image stages can overlap between runs.
- [.github/workflows/verify-and-publish-preview.yml:129](../../../.github/workflows/verify-and-publish-preview.yml#L129) — Only publishing is serialized;serialization does not order builds by source revision.
- [.github/workflows/verify-and-publish-preview.yml:152](../../../.github/workflows/verify-and-publish-preview.yml#L152) — Every completed publishing run unconditionally includes mutable preview tag.
- [.github/workflows/verify-and-publish-preview.yml:173](../../../.github/workflows/verify-and-publish-preview.yml#L173) — Manifest creation writes every tag without checking whether revision is still intended current main.

**Correction:** Fence preview updates to the still-current intended revision inside serialized publication;preserve appropriate immutable SHA/version publications and both native architecture checks.

**Verification:** Simulate or exercise A-starts-first/B-publishes-first completion order and old-run rerun;preview must not regress while immutable references remain available.

**Original audit:** [INFRA-03](12-infrastructure.md).

### JELLYFIN-01

**P2 · correctness · confirmed — Manual progress changes lose their numeric outbound value**

**Trigger:** Single or group reset, or a numeric progress API edit, for a mapped Jellyfin work; especially automatic reconciliation disabled

**Impact:** Queued explicit progress delivery is skipped or near position1 sends an incorrect value; nonzero edits also retain incorrect zero backfill intent. Normal player reports use a separate delivery path.

**Evidence:**

- [src/lib/sync/changes.server.ts:324](../../../src/lib/sync/changes.server.ts#L324) — trackWithExports passes a value only for favourite, leaving progress undefined
- [src/lib/sync/changes.server.ts:198](../../../src/lib/sync/changes.server.ts#L198) — Missing progress value records zero intent
- [src/lib/sync/changes.server.ts:231](../../../src/lib/sync/changes.server.ts#L231) — The same missing value instead queues boolean true
- [src/lib/sync/changes.server.ts:342](../../../src/lib/sync/changes.server.ts#L342) — Bulk progress reset also omits a numeric value
- [src/lib/sync/jellyfin.server.ts:860](../../../src/lib/sync/jellyfin.server.ts#L860) — Boolean true becomes position1; current-value comparison at866 drops ordinary numeric edits and resets
- [src/lib/ui/components/MediaActions.svelte:285](../../../src/lib/ui/components/MediaActions.svelte#L285) — Reset playback position supplies positionSeconds0 through this path
- [src/lib/server/public-api/mutations.server.ts:51](../../../src/lib/server/public-api/mutations.server.ts#L51) — Public numeric progress mutations call trackWithExports
- [src/lib/ui/components/MediaActions.svelte:285](../../../src/lib/ui/components/MediaActions.svelte#L285) — The ordinary Reset playback position command sends action=progress and positionSeconds=0.
- [src/lib/sync/changes.server.ts:319](../../../src/lib/sync/changes.server.ts#L319) — trackWithExports passes a value only for favourite, omitting the progress position and duration.
- [src/lib/sync/changes.server.ts:198](../../../src/lib/sync/changes.server.ts#L198) — The helper creates a zero/zero progress intent from omitted values, while line 231 emits value=true.
- [src/lib/sync/changes.server.ts:342](../../../src/lib/sync/changes.server.ts#L342) — The bulk-reset path calls the same helper without a progress value or duration.
- [src/lib/sync/jellyfin.server.ts:858](../../../src/lib/sync/jellyfin.server.ts#L858) — Delivery converts payload true to one second and returns without writing when that differs from current canonical progress.

**Correction:** Pass committed numeric position/duration, including explicit zero for bulk reset, and derive intent and job payload from the same progress value

**Verification:** Disposable fixture: mapped title at position120; single reset and group reset must queue numeric0 and deliver ticks0 with reconciliation off; public edit position300 must retain300 and deliver300 both immediately and after late mapping. Existing adapter tests do not cover this orchestration.

**Consolidation note:** One malformed outbound progress contract reported independently by Jellyfin and domain reviewers; retained once.

**Original audit:** [JELLYFIN-01](03-jellyfin.md), [DOMAIN-03](04-domain.md).

### JELLYFIN-02

**P2 · correctness · strong-static — Music copies overwrite canonical observations in provider item order**

**Trigger:** Two accessible audio copies share one recording identifier, or albums share one release group, with differing personal states; copies may be on different pages or changed individually by delta

**Impact:** Later sorted copy can clear imported favourite/resume/count; historical listens and playCount can disagree. Real decideSync classifies agreed count3 followed by copy count0 as a remote edit.

**Evidence:**

- [src/lib/music/persistence.server.ts:27](../../../src/lib/music/persistence.server.ts#L27) — Verified recording/release-group identifiers merge external items into one work
- [src/lib/sync/jellyfin.server.ts:721](../../../src/lib/sync/jellyfin.server.ts#L721) — Each music provider item is immediately imported separately
- [src/lib/sync/jellyfin.server.ts:457](../../../src/lib/sync/jellyfin.server.ts#L457) — Favourite reconciliation shares canonical work ID across copies
- [src/lib/sync/jellyfin.server.ts:466](../../../src/lib/sync/jellyfin.server.ts#L466) — Each accepted copy overwrites canonical playCount; progress is likewise per copy at469

**Correction:** Persist account-scoped observations beside music access and reconcile one bounded canonical-work observation using an explicit merge rule, following the existing screen approach and retaining retry-safe listen identities

**Verification:** Disposable fixture with two IDs/one recording on different pages: A favourite/count3/resume40, B false/0/0. Reverse order and repeat scans; canonical observation and listens must remain stable. Test a delta touching only B and genuine removal of A.

**Original audit:** [JELLYFIN-02](03-jellyfin.md).

### JELLYFIN-03

**P2 · correctness · strong-static — Companion reset accepts a user baseline started before lost events**

**Trigger:** User import commits early pages and yields; an earlier item's state changes; plugin restart/overflow loses that event; reset reuses the yielded import

**Impact:** Import resumes after the stale page yet satisfies recovery; missed watched/favourite/progress or access changes can persist until the next full interval

**Evidence:**

- [src/lib/providers/jellyfin/updates.server.ts:58](../../../src/lib/providers/jellyfin/updates.server.ts#L58) — Existing user sync returned without a fresh/follow-up requirement; only shared library jobs get a follow-up-full flag
- [src/lib/providers/jellyfin/updates.server.ts:73](../../../src/lib/providers/jellyfin/updates.server.ts#L73) — Reset uses that request path for personal baselines
- [src/lib/sync/jellyfin.server.ts:203](../../../src/lib/sync/jellyfin.server.ts#L203) — Matching scan/progress preserves old start time and cursor/phase
- [src/lib/providers/jellyfin/updates.server.ts:110](../../../src/lib/providers/jellyfin/updates.server.ts#L110) — Existing job success satisfies baseline and allows healthy status
- [src/lib/providers/task-timing.ts:71](../../../src/lib/providers/task-timing.ts#L71) — Healthy companion extends user import cadence to the full interval

**Correction:** Require a complete user traversal begun after a durable reset fence, using existing serialized follow-up/restart mechanics while preserving personal bootstrap cursors

**Verification:** Disposable fixture: yield a full user scan after page1, modify page1 state, apply epoch reset, resume. Earlier pages must be re-read and companion remain reconciling until the post-reset traversal succeeds.

**Original audit:** [JELLYFIN-03](03-jellyfin.md).

### JELLYFIN-04

**P2 · correctness · confirmed — Companion session DTO drops shared-stream deduplication identity**

**Trigger:** Shared Coast playback appears in a healthy companion-fed current-session snapshot

**Impact:** Observed provider row cannot match the native shared playback and is counted/rendered again; stream history can retain the duplicate too

**Evidence:**

- [../coast-plugin/Coast/Api/ChangesController.cs:35](../../../../coast-plugin/Coast/Api/ChangesController.cs#L35) — Produced session whitelist at35–52 omits DeviceId
- [src/lib/providers/jellyfin/streams.ts:16](../../../src/lib/providers/jellyfin/streams.ts#L16) — Omitted DeviceId becomes null in persisted stream presentation
- [src/lib/sharing/streams.server.ts:29](../../../src/lib/sharing/streams.server.ts#L29) — Provider observations excluded solely by snapshot deviceId equality
- [src/lib/application/streams.server.ts:44](../../../src/lib/application/streams.server.ts#L44) — Count adds provider observations after device exclusion to native shared count; cards similarly merge at54–66

**Correction:** Include existing DeviceId in the companion sanitized contract and assert parity with native session normalization; retain sensitive-field stripping

**Verification:** Feed the actual companion DTO shape through applyCompanionPage for a shared playback with matching provider device ID; assert exactly one stream/count and no duplicate history, while token/path/IP fields remain absent

**Original audit:** [JELLYFIN-04](03-jellyfin.md).

### JELLYFIN-05

**P2 · correctness · strong-static — Music and reading scans publish negative coverage after unstable pagination**

**Trigger:** Earlier music/book item is deleted or re-sorted between offset pages or between committed yields, leaving a still-present item skipped

**Impact:** A valid-looking completed traversal withdraws prior positive availability for unseen but still accessible works; pure mocked adapter accepted201→200 totals and omitted still-present track101

**Evidence:**

- [src/lib/sync/jellyfin.server.ts:718](../../../src/lib/sync/jellyfin.server.ts#L718) — Music loop advances offsets without cross-page total/repeat checks
- [src/lib/sync/jellyfin.server.ts:742](../../../src/lib/sync/jellyfin.server.ts#L742) — Reading loop and per-item resumes have the same missing consistency fence
- [src/lib/providers/jellyfin/music.server.ts:152](../../../src/lib/providers/jellyfin/music.server.ts#L152) — Adapter validates each page independently, not traversal total/history
- [src/lib/providers/jellyfin/reading.server.ts:22](../../../src/lib/providers/jellyfin/reading.server.ts#L22) — Reading adapter also validates only each individual page
- [src/lib/sync/jellyfin.server.ts:788](../../../src/lib/sync/jellyfin.server.ts#L788) — Full user completion marks every older unseen availability row unavailable
- [src/lib/sync/jellyfin.server.ts:552](../../../src/lib/sync/jellyfin.server.ts#L552) — Screen path already rejects changed traversal totals

**Correction:** Persist per-stage totals/seen-item evidence and reuse screen consistency/restart behavior before negative publication, preserving bounded pages and reading checkpoints

**Verification:** Disposable fixtures for music and reading: delete earlier row after page1, change total, repeat prior ID across resume; retain old positives and leave coverage incomplete until a clean full restart succeeds

**Original audit:** [JELLYFIN-05](03-jellyfin.md).

### JOBS-04

**P2 · correctness · strong-static — List writes can succeed while their durable export intent is lost**

**Trigger:** A process interruption or an outbox insert failure occurs after a list edit commits but before/during queueTraktListChange; alternatively only the first of multiple destination enqueue operations succeeds.

**Impact:** The browser sees success, but the list edit has no durable delivery intent for one or all configured destinations. A later ordinary import with unchanged remote evidence selects local and records it without necessarily scheduling the missing export, so the edit can remain undelivered indefinitely.

**Evidence:**

- [src/lib/server/api/lists.server.ts:18](../../../src/lib/server/api/lists.server.ts#L18) — Create/update/add/remove/reorder/move operations invoke canonical services and await their completed transactions through line 48.
- [src/lib/server/api/lists.server.ts:53](../../../src/lib/server/api/lists.server.ts#L53) — Only afterwards is queueTraktListChange called; failures are logged and swallowed before returning a successful mutation response.
- [src/lib/sync/trakt-lists.server.ts:43](../../../src/lib/sync/trakt-lists.server.ts#L43) — queueTraktListChange inserts each connection's outbound job through separate enqueueAction transactions.
- [src/lib/sync/changes.server.ts:79](../../../src/lib/sync/changes.server.ts#L79) — enqueueInTransaction already provides the existing transactional outbox boundary used by canonical tracking/rating workflows.

**Correction:** Place requested list export intent in the same existing database transaction as the canonical list mutation, using enqueueInTransaction and a focused orchestration wrapper/transaction parameter. Remove the best-effort enqueue from the HTTP dispatcher; preserve compaction and ownership checks.

**Verification:** Disposable DB fixture: force the applicable Trakt export insertion to fail during create/update/add/remove/reorder. Assert the canonical mutation and export intents all roll back together, or an existing durable retry intent remains. Repeat with two enabled Trakt connections to verify there is no partial destination commit.

**Original audit:** [JOBS-04](02-jobs-sync.md).

### JOBS-05

**P2 · correctness · strong-static — Seerr delivery publishes personal state without the dual-account publication guard**

**Trigger:** After getSeerr has verified both identities, disconnect the linked Jellyfin/Seerr account, disable an associated service/user, or invalidate the worker lease while adapter.create/manage/requestDetails is waiting. Then let the remote response return.

**Impact:** The old response still updates local request status or conflict baselines after the account/service/worker has ceased being valid. Scheduled observations already reject this situation, while delivery has different publication semantics. A local guard cannot undo a remote request already accepted before disconnect, but can prevent stale local publication.

**Evidence:**

- [src/lib/providers/seerr/connection.server.ts:17](../../../src/lib/providers/seerr/connection.server.ts#L17) — assertSeerrAccount checks both linked identities/generations, both enabled services, user status and active job lease inside the committing transaction.
- [src/lib/providers/seerr/requests.server.ts:359](../../../src/lib/providers/seerr/requests.server.ts#L359) — refreshRequests uses that guard for each observation publication.
- [src/lib/providers/actions.server.ts:322](../../../src/lib/providers/actions.server.ts#L322) — seerr.request discards the returned scope, awaits adapter.create, then writes mediaRequests at lines 330-338 without a guarded transaction.
- [src/lib/providers/actions.server.ts:149](../../../src/lib/providers/actions.server.ts#L149) — seerr.manage also writes syncValues/mediaRequests after remote waits without the guard; conflict branches at lines 105-144 are similarly unguarded.
- [src/lib/application/provider-sources.server.ts:15](../../../src/lib/application/provider-sources.server.ts#L15) — A disconnect can change connection status while work runs; this workflow only cancels pending/failed outbox actions at lines 23-30.

**Correction:** Retain the returned Seerr scope and use assertSeerrAccount inside one transaction for each completed delivery/conflict publication, alongside all related mediaRequests and syncValues writes. Pin queued identity as in JOBS-01; retain provider-side permission rechecks.

**Verification:** Disposable DB fake transport: gate request creation/management after getSeerr, invalidate each linked generation/status/service or job lease, release response, and assert no stale mediaRequests/syncValues publication. Verify normal successful request plus baseline writes commit atomically.

**Original audit:** [JOBS-05](02-jobs-sync.md).

### LIFECYCLE-01

**P2 · correctness · confirmed — Closing a reader or stopping playback does not invalidate all pending preparation**

**Trigger:** Playback: prepare media, stop before its API response arrives, then resolve that response. Reading: open a reader, close it while its stopPlayback await is pending, then resolve that await.

**Impact:** Playback can install a late session after Stop. Reading can send a stale party item command after Close and leave loading stuck; the reading case is not a claim that the closed reader visibly reopens. Both controller races were reproduced with compiled current code and mocked asynchronous dependencies.

**Evidence:**

- [src/lib/reading/client.svelte.ts:40](../../../src/lib/reading/client.svelte.ts#L40) — After installing a session, awaited playback stop/import are followed by item publication without rechecking opening generation or current session.
- [src/lib/reading/client.svelte.ts:43](../../../src/lib/reading/client.svelte.ts#L43) — The old opening finally clears loading only when its generation still matches.
- [src/lib/reading/client.svelte.ts:45](../../../src/lib/reading/client.svelte.ts#L45) — Attaching a party session does not invalidate an older pending explicit open.
- [src/lib/reading/client.svelte.ts:51](../../../src/lib/reading/client.svelte.ts#L51) — Close invalidates generation but never settles loading itself.
- [src/lib/playback/synced/client.svelte.ts:104](../../../src/lib/playback/synced/client.svelte.ts#L104) — Reader.loading contributes to the party buffering heartbeat.
- [src/lib/playback/client.svelte.ts:48](../../../src/lib/playback/client.svelte.ts#L48) — stopPlayback delegates to the controller without cancelling or invalidating preparation.
- [src/lib/playback/client.svelte.ts:110](../../../src/lib/playback/client.svelte.ts#L110) — The preparation request has no AbortSignal or operation-generation capture.
- [src/lib/playback/client.svelte.ts:122](../../../src/lib/playback/client.svelte.ts#L122) — The response unconditionally publishes its session and sets role to playback, even after stop/teardown.
- [src/lib/ui/components/PersistentPlayer.svelte:195](../../../src/lib/ui/components/PersistentPlayer.svelte#L195) — The controller close path clears the present session but has no pending-prepare invalidation.
- [src/routes/share/+page.svelte:34](../../../src/routes/share/+page.svelte#L34) — Share-route teardown stops playback and resets API routing, so a late shared preparation can repopulate the root player after leaving the route.

**Correction:** Use the existing operation-generation pattern consistently in both controllers: invalidate pending preparation on stop/close, recheck after every asynchronous handoff before publishing session/party state, and clean up any superseded server session. Preserve independent UI control and playback behavior; no new global state framework is required.

**Verification:** Run both reported delayed-response fixtures and require no late active session, no stale party command and settled loading state. Also test prepare-A/prepare-B ordering and server-session cleanup using existing controller tests.

**Consolidation note:** Merged by the missing cancellation/publication invariant; both implementations and distinct observed effects are retained, rather than treating the two controllers as one code path.

**Original audit:** [READING-02](06-reading.md), [PLAYBACK-02](07-playback-sharing.md).

### MEDIUM-01

**P2 · correctness · strong-static — Album membership loses track occurrences and mixes release editions**

**Trigger:** Persist two releases with the same release-group ID but different tracklists/order, or one album with the same recording UUID at two positions. Then open, queue or manually log the album.

**Impact:** The last observed occurrence wins ordering, repeated recording occurrences disappear, and standard/deluxe releases become a union that may match no real album. Logging an ordinary edition also logs bonus tracks learned from another edition/server, changing personal playcounts and downstream history.

**Evidence:**

- [src/lib/music/persistence.server.ts:27](../../../src/lib/music/persistence.server.ts#L27) — Albums merge on MusicBrainz release-group and tracks on recording identity.
- [src/lib/music/persistence.server.ts:41](../../../src/lib/music/persistence.server.ts#L41) — Distinct work editions are stored, but their membership is not retained there.
- [src/lib/music/persistence.server.ts:47](../../../src/lib/music/persistence.server.ts#L47) — Every provider occurrence upserts one parent/child/kind relationship and overwrites its position.
- [src/lib/server/db/schema.ts:244](../../../src/lib/server/db/schema.ts#L244) — The relationship primary key cannot represent the same recording at multiple album positions.
- [src/lib/music/queue.server.ts:8](../../../src/lib/music/queue.server.ts#L8) — Album playback expands the global work relationship set, without selecting a release edition.
- [src/lib/music/persistence.server.ts:117](../../../src/lib/music/persistence.server.ts#L117) — Album logging uses the same global membership set, so edition-only tracks become user listens.

**Correction:** Retain ordered membership with an edition/occurrence identity beside the existing workEditions boundary; derive canonical browse/queue/logging from one explicit deterministic edition rather than unioning every release. Preserve shared recording activity and batch retry safety.

**Verification:** Disposable fixture: persist two album provider IDs with one release-group UUID, one track shared at different positions and a deluxe-only recording. Assert a selected standard queue/log excludes the bonus recording and retains its own order. Add a second occurrence of one recording and assert it remains a distinct queue entry without duplicate retry effects.

**Original audit:** [MEDIUM-01](11-music-gaming.md).

### MEDIUM-02

**P2 · correctness · strong-static — Equivalent Jellyfin GUID spellings become separate music identities**

**Trigger:** Browse a track/album whose Jellyfin ID is compact lowercase, then request the same item through the documented hyphenated or uppercase GUID form. The item lacks a verified MusicBrainz recording/release-group ID.

**Impact:** One provider item acquires two canonical works, separate progress/favourites/listens, duplicate availability and potentially split album membership. With a shared MusicBrainz ID it still creates duplicate provider mappings/editions. The injected adapter reproduction confirms different returned identity strings; DB effects follow statically from raw lookup keys.

**Evidence:**

- [src/lib/providers/jellyfin/paging.ts:2](../../../src/lib/providers/jellyfin/paging.ts#L2) — The existing canonical comparison key removes hyphens and lowercases Jellyfin GUIDs.
- [src/lib/providers/jellyfin/music.server.ts:173](../../../src/lib/providers/jellyfin/music.server.ts#L173) — Single lookup accepts an equivalent upstream GUID through normalized validation.
- [src/lib/providers/jellyfin/music.server.ts:174](../../../src/lib/providers/jellyfin/music.server.ts#L174) — It then overwrites the upstream ID with the raw caller-supplied spelling.
- [src/lib/music/persistence.server.ts:26](../../../src/lib/music/persistence.server.ts#L26) — Lock and provider mapping lookup use the raw item.id; without a verified MusicBrainz ID a new work UUID is allocated.
- [src/lib/music/persistence.server.ts:40](../../../src/lib/music/persistence.server.ts#L40) — Provider items and work editions also retain raw GUID spellings as distinct unique keys.

**Correction:** Normalize Jellyfin music IDs, parent IDs and artist IDs consistently at the provider/persistence boundary using the existing jellyfinItemKey helper. Resolve any previously stored equivalent spelling before allocation; preserve existing work UUIDs rather than manufacturing a new mapping.

**Verification:** Pure adapter regression: compact and uppercase/hyphenated lookups for one upstream GUID return the same normalized ID. Disposable DB regression: persist/browse all accepted spellings without MusicBrainz IDs and assert one work, provider item, edition and personal progress identity.

**Original audit:** [MEDIUM-02](11-music-gaming.md).

### MEDIUM-03

**P2 · correctness · confirmed — Merged music copies collide with keyed card renderers**

**Trigger:** Two editions/copies on one or several connected Jellyfin libraries resolve to the same verified MusicBrainz work and appear on the same music page/row.

**Impact:** The read model sends duplicate keys to Svelte keyed each blocks; development raises a duplicate-key error and production keyed updates cannot reliably preserve the separate cards. This affects supported canonical merging, not just random identical server IDs.

**Evidence:**

- [src/lib/music/presentation.ts:31](../../../src/lib/music/presentation.ts#L31) — Different source items sharing workId get exactly the same canonical href.
- [src/lib/server/queries/music.ts:65](../../../src/lib/server/queries/music.ts#L65) — The browse read model concatenates all provider copies without assigning entry identities or collapsing works.
- [src/lib/server/queries/media-rows.ts:40](../../../src/lib/server/queries/media-rows.ts#L40) — Home/presentation music rows likewise concatenate copies.
- [src/routes/music/+page.svelte:67](../../../src/routes/music/+page.svelte#L67) — Music grid keys its each block by item.href.
- [src/lib/ui/components/Shelf.svelte:102](../../../src/lib/ui/components/Shelf.svelte#L102) — Shared shelves default to item.entryId or href.

**Correction:** Preserve current source-copy presentation by giving each result an existing-style entryId scoped to connection and provider item, and use that entryId on the standalone grid as Shelf already supports. If the product instead wants one work card, collapse it in the bounded read model and keep count/pagination semantics explicit.

**Verification:** Pure reproduction already yields 2 cards and only 1 href key. Add a presenter/read-model case with two sources and one workId, then render both the Music grid and a Shelf in a disposable UI fixture; assert unique keys and correct source actions after reorder/refresh.

**Original audit:** [MEDIUM-03](11-music-gaming.md).

### MEDIUM-04

**P2 · correctness · strong-static — Steam AppID aliases overwrite account playtime and achievement state**

**Trigger:** An IGDB mapping with two Steam aliases is imported before ownership, then an account owns both AppIDs. Return different playtime/stat availability or same-named achievement API keys for those two apps.

**Impact:** The final owned-game response order determines displayed totals and hasStats. Reordering an otherwise identical complete response can change minutes or suppress achievement polling. Achievement schemas/progress from separate apps are also combined or overwritten instead of retained as exact provider observations.

**Evidence:**

- [src/lib/providers/igdb/adapter.server.ts:46](../../../src/lib/providers/igdb/adapter.server.ts#L46) — One IGDB work can carry multiple verified Steam store AppIDs; pure mapping reproduction accepts both 10 and 20.
- [src/lib/providers/steam/sync.server.ts:63](../../../src/lib/providers/steam/sync.server.ts#L63) — Each owned AppID resolves to its canonical game and overwrites account/game minutes, hasStats and recent playtime.
- [src/lib/server/db/schema.ts:1282](../../../src/lib/server/db/schema.ts#L1282) — game_account_state has only an account/game key, omitting the exact Steam AppID.
- [src/lib/providers/steam/sync.server.ts:140](../../../src/lib/providers/steam/sync.server.ts#L140) — Achievement traversal selects exact owned AppIDs but may select several for the same game state.
- [src/lib/providers/steam/sync.server.ts:156](../../../src/lib/providers/steam/sync.server.ts#L156) — Schema cache lookup uses gameId/provider, so one AppID can reuse another AppID's achievement definitions.
- [src/lib/providers/steam/sync.server.ts:162](../../../src/lib/providers/steam/sync.server.ts#L162) — Definition identity omits AppID; progress upserts then overwrite a shared definition's account state.

**Correction:** Retain exact AppID on Steam account observations and achievement identities, then deliberately project those observations to the canonical game display. Do not infer which AppID's totals or schema are authoritative from provider response order; keep existing no-fabricated-session behavior.

**Verification:** Disposable fixture: import one IGDB game with Steam IDs 10/20, return owned totals 100/30 with different hasStats values in both orders, and assert equal deliberate aggregate/projected results plus exact observation preservation. Give both apps an achievement named FIRST with different state/schema and assert independent account progress.

**Original audit:** [MEDIUM-04](11-music-gaming.md).

### PLAYBACK-01

**P2 · correctness · strong-static — Personal playback can publish scrobbles into a replacement source account**

**Trigger:** Start personal audio/video under Jellyfin account A. Keep the player active while linking account B to the same Coast connection. Allow a subsequent progress/pause/end report from A playback. Buffered playback makes this possible even if B cannot stream the old item.

**Impact:** New reports survive the old-action cancellation and are stamped with B generation. The worker sends A session/item IDs using B credentials. If B can access that item and Jellyfin accepts the report, its progress/history can be changed. At minimum stale session requests are sent under the wrong account. No cross-account disclosure or live upstream mutation was demonstrated.

**Evidence:**

- [src/lib/server/db/schema.ts:818](../../../src/lib/server/db/schema.ts#L818) — Personal sessions retain the connection ID and provider IDs, but no account-generation binding.
- [src/lib/playback/service.server.ts:438](../../../src/lib/playback/service.server.ts#L438) — Progress admission checks session ID, Coast user and expiry, then rejects shares; it never checks the originating account generation.
- [src/lib/playback/service.server.ts:486](../../../src/lib/playback/service.server.ts#L486) — Audio reports enqueue provider actions using the old session connection ID; video does the same at line 520.
- [src/lib/sync/changes.server.ts:391](../../../src/lib/sync/changes.server.ts#L391) — Playback intent inserts a fresh jellyfin.scrobble action against that connection ID.
- [drizzle/0016_collection_and_music.sql:234](../../../drizzle/0016_collection_and_music.sql#L234) — The outbox insertion trigger binds the action to the connection generation current at insertion, rather than the playback origin.
- [drizzle/0022_verified_trakt_identity.sql:18](../../../drizzle/0022_verified_trakt_identity.sql#L18) — An account switch rotates the connection generation and cancels existing actions, but does not invalidate playback sessions.
- [src/lib/sync/jellyfin.server.ts:925](../../../src/lib/sync/jellyfin.server.ts#L925) — Scrobble execution reloads the session by user/connection and resolves current Jellyfin credentials at line 941.
- [src/lib/playback/service.server.ts:588](../../../src/lib/playback/service.server.ts#L588) — Media relay also resolves current credentials from an unversioned personal session.

**Correction:** Pin the selected connection accountGeneration in personal playback sessions; recheck it when publishing preparation, relaying, accepting progress and executing scrobbles. Reject/retire stale sessions before inserting outbound intent. Use the existing account lock/generation boundary so account replacement cannot race the check; do not stamp stale intent with the new account generation.

**Verification:** Disposable DB/provider fixture: start A; replace external_user_id/credentials on the same connection with B so the trigger rotates generation; submit old-session progress and inspect outbox plus fixture requests. Assert no B-generation scrobble or B-authenticated relay is emitted, and a fresh B session works. Cover replacement during delayed PlaybackInfo as well.

**Original audit:** [PLAYBACK-01](07-playback-sharing.md).

### PLAYBACK-03

**P2 · correctness · confirmed — Audio Try again resumes the failed session instead of preparing a replacement**

**Trigger:** Let direct or HLS audio enter the persistent player error state, then press Try again. This also affects a shared audio session already retired by the error endpoint.

**Impact:** Retry neither replaces the source/session nor clears the error through the session-reset effect. An unrecoverable decode/source failure remains on the same element; a retired shared session cannot be revived by play(). Closing and reopening is required.

**Evidence:**

- [src/lib/ui/components/PersistentPlayer.svelte:330](../../../src/lib/ui/components/PersistentPlayer.svelte#L330) — Audio retry calls playMedia(session.mediaId,{mediaType:audio,fromStart:false}).
- [src/lib/playback/client.svelte.ts:83](../../../src/lib/playback/client.svelte.ts#L83) — Those arguments satisfy the same-item playback shortcut; it calls controller.resume at line 96 and never prepares another session.
- [src/lib/ui/components/PersistentPlayer.svelte:433](../../../src/lib/ui/components/PersistentPlayer.svelte#L433) — Controller resume calls media.play on the existing failed element.
- [src/lib/ui/components/PersistentPlayer.svelte:550](../../../src/lib/ui/components/PersistentPlayer.svelte#L550) — The displayed Try again button invokes this switchEdition path.

**Correction:** Distinguish explicit recovery from ordinary same-item resume. Have the existing retry path request a fresh session while retaining resume position; bypass the shortcut only for that recovery, and clear the error when the replacement is published.

**Verification:** Compiled-current-client mock using the exact audio retry arguments yielded resumes=1, preparationRequests=0, session=failed. Add a client/controller fixture that faults audio, clicks recovery, asserts a new preparation/session and cleared error. Cover direct and HLS audio plus shared-session retirement.

**Original audit:** [PLAYBACK-03](07-playback-sharing.md).

### PLAYBACK-04

**P2 · performance · confirmed — Slow shared cleanup overlaps maintenance ticks and delays ordinary scheduling**

**Trigger:** Leave several cleanup_pending sessions for a connected Jellyfin source whose stop endpoint times out or responds slowly. A cleanup pass takes longer than the one-minute maintenance interval.

**Impact:** Later ticks enter cleanup while earlier ticks are still waiting. Pending sessions can receive duplicate stop attempts, and each tick postpones normal scheduling until its cleanup returns. Per-origin pacing limits concurrent remote calls but does not coalesce these maintenance callers. No production leak, OOM, sustained backlog size or measured outage duration is claimed.

**Evidence:**

- [src/lib/sharing/leases.server.ts:107](../../../src/lib/sharing/leases.server.ts#L107) — A lifecycle pass serially releases up to 20 expired viewers, each awaiting remote stop.
- [src/lib/sharing/leases.server.ts:111](../../../src/lib/sharing/leases.server.ts#L111) — It then selects up to 20 pending stopped sessions and awaits each provider retry; failures remain pending.
- [src/lib/sharing/leases.server.ts:69](../../../src/lib/sharing/leases.server.ts#L69) — Each cleanup can wait for dispatch leases and then call the provider before completing.
- [src/lib/providers/maintenance.server.ts:277](../../../src/lib/providers/maintenance.server.ts#L277) — maintenanceTick awaits cleanup before provider scheduling and retention.
- [src/lib/providers/maintenance.server.ts:290](../../../src/lib/providers/maintenance.server.ts#L290) — A new asynchronous tick starts every 60 seconds without an in-flight guard; startup also launches a tick at line 298.
- [src/lib/server/security/provider-fetch.ts:180](../../../src/lib/server/security/provider-fetch.ts#L180) — Provider fetches allow a 15-second default response deadline, so a count-bounded serial cleanup batch need not complete within one minute.

**Correction:** Coalesce cleanup into one process-local in-flight pass and let normal scheduling proceed without awaiting network cleanup. Preserve durable cleanup_pending retry flags and the existing owner/dispatch fences; use a modest per-pass time/work budget if needed instead of increasing transport concurrency.

**Verification:** A bounded mock ran the current maintenanceTick/startProviderMaintenance source unchanged with fake interval callbacks and deferred cleanup. Startup plus two simulated minute ticks produced cleanupCalls=3 and scheduledCalls=0; releasing the promises produced scheduledCalls=3. Add this fake-clock regression and assert only one cleanup pass runs while ordinary scheduling continues. Separately use a disposable provider fixture with multiple delayed stops to test the chosen batch budget.

**Original audit:** [PLAYBACK-04](07-playback-sharing.md).

### READING-01

**P2 · correctness · confirmed — Failed final bookmark drain silently closes and discards retry state**

**Trigger:** Final /location request fails transiently while closing the reader.

**Impact:** Latest bookmark can be lost with no error and no retained retry position; reopening resumes an older page/CFI.

**Evidence:**

- [src/lib/reading/client.svelte.ts:53](../../../src/lib/reading/client.svelte.ts#L53) — Close begins the final recordReading drain, then clears session/location/file before awaiting it and closing the server session.
- [src/lib/reading/client.svelte.ts:63](../../../src/lib/reading/client.svelte.ts#L63) — Location failures are caught without rejecting the writer promise; error reporting is conditional on the session which close has already cleared.

**Correction:** Make final draining return failure and retain the latest unsaved session/location for a visible retry before silently retiring it; keep the existing one-writer coalescing loop.

**Verification:** Mock final /location rejection, close, and assert pending position/error survives and session is not silently retired; restore API, retry and assert final page persists without older writes overtaking it.

**Original audit:** [READING-01](06-reading.md).

### READING-03

**P2 · correctness · strong-static — Session preparation can insert an old bookmark after Reread reset**

**Trigger:** Prepare in one tab reads old page, another tab commits Reread, then first tab inserts its copied location.

**Impact:** Usable post-reread session resumes old page/CFI; numbered-page initialization can overwrite newly reset page-zero progress.

**Evidence:**

- [src/lib/reading/sessions.server.ts:54](../../../src/lib/reading/sessions.server.ts#L54) — Previous bookmark selection and insertion are independent operations with no transaction/user lock.
- [src/lib/core/reading/service.server.ts:39](../../../src/lib/core/reading/service.server.ts#L39) — Personal writes and Reread serialize on the existing user advisory lock.
- [src/lib/core/reading/service.server.ts:62](../../../src/lib/core/reading/service.server.ts#L62) — Reread resets/closes sessions currently visible to this transaction; a later insert can escape it.

**Correction:** After network work, select previous bookmark and insert session inside one transaction holding the existing per-user lock shared with Reread.

**Verification:** Disposable DB barrier after prepare bookmark read/before insert; commit Reread between them. Preparation must serialize before reset and be closed by it, or serialize afterward and receive null location.

**Original audit:** [READING-03](06-reading.md).

### READING-04

**P2 · correctness · strong-static — Reading item replacement can revoke the initiating party participant**

**Trigger:** Guest heartbeat lands between host/controller closing reading A and switching room to prepared reading B.

**Impact:** Host can successfully publish B while remaining unjoined and then be dropped from the party; delegated controller may instead lose command permissions mid-switch.

**Evidence:**

- [src/lib/reading/client.svelte.ts:37](../../../src/lib/reading/client.svelte.ts#L37) — Opening replacement closes old reading session before publishing new party item.
- [src/lib/playback/synced/service.server.ts:114](../../../src/lib/playback/synced/service.server.ts#L114) — Room-state calls mark participants unjoined when attached reading session has closed.
- [src/lib/playback/synced/service.server.ts:214](../../../src/lib/playback/synced/service.server.ts#L214) — Reading item switch installs source but preserves joined=false from an intervening room read.
- [src/lib/playback/synced/client.svelte.ts:107](../../../src/lib/playback/synced/client.svelte.ts#L107) — Following heartbeat drops local room when caller is no longer joined.

**Correction:** Handover participant source before retiring old session, or complete only still-authorized reattachment under existing room transaction; retain expiry/revocation checks.

**Verification:** Disposable room: prepare B, close host A, guest roomState, host item B with fresh revision, heartbeat. Assert initiating member remains joined to B. Repeat authorized non-host and explicitly removed actor cases.

**Original audit:** [READING-04](06-reading.md).

### SOCIAL-01

**P2 · correctness · confirmed — A failed party source stays unavailable after the host changes its edition**

**Trigger:** A joined guest cannot prepare edition A of work W. The host selects edition B (or another duration/reading format) of the same W that the guest could access.

**Impact:** The guest adopts the new room descriptor but never prepares the replacement source, keeps sending unavailable=true and can hold Pause together. Manual Retry/rejoin is required despite a new playable descriptor.

**Evidence:**

- [src/lib/playback/synced/client.svelte.ts:103](../../../src/lib/playback/synced/client.svelte.ts#L103) — The next heartbeat reports unavailable solely from equality with unavailableMediaId, independent of source edition/duration/format.
- [src/lib/playback/synced/client.svelte.ts:114](../../../src/lib/playback/synced/client.svelte.ts#L114) — Source preparation is skipped whenever the next mediaId equals the previously failed mediaId.
- [src/lib/playback/synced/client.svelte.ts:123](../../../src/lib/playback/synced/client.svelte.ts#L123) — A failed source preparation records only next.mediaId.

**Correction:** Remember the failed source descriptor (work, medium, edition, duration and reading format) and suppress retries only while that descriptor is unchanged; clear the failure when it changes. Preserve bounded automatic retries for an unchanged failure.

**Verification:** Extend the existing compiled synced-client fixture: fail preparation for W/A, deliver heartbeat W/B, assert one new source preparation and attachment; subsequent unchanged failed W/A polls must remain suppressed. Repeat for reading format/duration changes.

**Original audit:** [SOCIAL-01](08-social-parties.md).

### SOCIAL-02

**P2 · correctness · strong-static — Recommendation send and response lock the same rows in opposite orders**

**Trigger:** A sender repeats a pending recommendation while its recipient saves or dismisses it: send holds friendship F, response holds recommendation R, then each waits for the other's row.

**Impact:** PostgreSQL detects a deadlock and aborts one valid user operation; the existing route/client does not transparently retry this database deadlock. Transactional rollback protects stored state but the user sees a failed send or response.

**Evidence:**

- [src/lib/social/service.server.ts:102](../../../src/lib/social/service.server.ts#L102) — recommend locks the accepted friendship before inserting/updating the pending recommendation.
- [src/lib/social/service.server.ts:105](../../../src/lib/social/service.server.ts#L105) — ON CONFLICT DO UPDATE locks an existing pending recommendation row.
- [src/lib/social/service.server.ts:114](../../../src/lib/social/service.server.ts#L114) — respondRecommendation locks the recommendation first.
- [src/lib/social/service.server.ts:116](../../../src/lib/social/service.server.ts#L116) — The response then requests the friendship lock held first by recommend.

**Correction:** Use one lock order for both operations, preserving the friendship authorization lock. Read immutable recommendation identities as needed, then lock friendship before locking/rechecking the recommendation, or serialize both on the same narrowly scoped key.

**Verification:** In a disposable database, create a pending recommendation and use two transactions/barriers to force F-then-R against R-then-F. Verify no deadlock after the fix, one durable response, and concurrent friendship removal still prevents unauthorized delivery.

**Original audit:** [SOCIAL-02](08-social-parties.md).

### SOCIAL-03

**P2 · performance · strong-static — The paged Taste page rebuilds and transfers both complete libraries**

**Trigger:** Two friends have large imported screen/music/game libraries, then open Taste & overlap or change a page/filter.

**Impact:** Database result size, feature hydration and response payload grow with both complete libraries; application overlap work additionally grows quadratically. The visible 60-card pagination does not bound this workload. No production latency threshold is claimed.

**Evidence:**

- [src/lib/social/insights.server.ts:8](../../../src/lib/social/insights.server.ts#L8) — The candidates query unions all relationship/history/progress evidence for both users, without a sample or page bound.
- [src/lib/social/insights.server.ts:32](../../../src/lib/social/insights.server.ts#L32) — Metadata feature hydration receives every candidate ID, including evidence later discarded by the meaningful filter.
- [src/lib/social/insights.server.ts:41](../../../src/lib/social/insights.server.ts#L41) — Progress comparisons perform b.find for each work; onlyFriend also performs a.some per work on line 42.
- [src/routes/taste/[friendId]/+page.server.ts:17](../../../src/routes/taste/[friendId]/+page.server.ts#L17) — Every page/filter load rebuilds the complete comparison.
- [src/routes/taste/[friendId]/+page.server.ts:19](../../../src/routes/taste/[friendId]/+page.server.ts#L19) — Only overlap card hydration is sliced to 60; the complete comparison with every overlap ID and comparison is returned on line 20.

**Correction:** Use ID maps/sets for linear overlap matching, return exact counts plus only the requested overlap IDs/progress page, and bound the taste feature evidence using an explicit documented sampling policy compatible with the existing bounded taste-profile method. Keep exact aggregate totals separate from sampled scoring and retain every visibility predicate.

**Verification:** Disposable fixtures with increasing libraries should verify identical exact overlap counts, bounded returned IDs/progress/features, stable deterministic paging, explicit sparse/sampled taste semantics, and private-section/category exclusion. Measure query rows, response bytes and CPU separately.

**Original audit:** [SOCIAL-03](08-social-parties.md).

### SOCIAL-04

**P2 · correctness · strong-static — Saving a music relationship hides its actual progress in friend comparisons**

**Trigger:** A music track has music_progress.position_seconds > 0 and no completed listen, and its owner collects/favourites/saves it, creating a tracking_state row with position_seconds=0.

**Impact:** Taste & overlap reports 0% instead of the concrete music position, counts the saved track as planned instead of active, or drops progress-only evidence when an empty projection already exists.

**Evidence:**

- [src/lib/social/insights.server.ts:17](../../../src/lib/social/insights.server.ts#L17) — COALESCE prefers tracking_state.position_seconds over music_progress.position_seconds.
- [src/lib/server/db/schema.ts:499](../../../src/lib/server/db/schema.ts#L499) — tracking_state.position_seconds is non-null with default zero, so an existing relationship projection never falls through to the music position.
- [src/lib/core/tracking/service.server.ts:71](../../../src/lib/core/tracking/service.server.ts#L71) — Canonical tracking creates the shared relationship projection with defaults.
- [src/lib/social/insights.server.ts:31](../../../src/lib/social/insights.server.ts#L31) — The same precedence controls whether otherwise progress-only evidence survives the SQL predicate.
- [src/lib/social/insights.server.ts:39](../../../src/lib/social/insights.server.ts#L39) — Active/planned statistics and progress comparisons use the incorrectly selected position.

**Correction:** Choose progress from the concrete medium: music_progress for music, tracking_state for screen. Reuse that same expression in both SELECT and eligibility predicates and keep the progress visibility check.

**Verification:** Disposable social fixture: accepted friends with shared progress; track with music_progress 30/120 and tracking_state favourite=true, position_seconds=0, no music_listens. Assert 25% comparison and active=1; make progress private and verify the value is withheld. Also test an empty tracking projection.

**Original audit:** [SOCIAL-04](08-social-parties.md).

### UI-01

**P2 · correctness · strong-static — Ordinary menu buttons remain open because keepOpen defaults to true**

**Trigger:** Open a media action menu, select Mark watched → Right now on a concrete movie/episode, and let the mutation settle; or activate another non-navigation item button that does not move focus outside the menu.

**Impact:** The command completes while the menu remains open and focused. Native link items close through the existing action path, so pointer/keyboard behavior varies by whether a command is rendered as a button or anchor. Repeated commands remain immediately reachable despite the documented dismissal policy.

**Evidence:**

- [src/lib/ui/components/Button.svelte:33](../../../src/lib/ui/components/Button.svelte#L33) — keepOpen defaults to true for every item button.
- [src/lib/ui/components/Button.svelte:92](../../../src/lib/ui/components/Button.svelte#L92) — Every ordinary item button consequently receives data-menu-keep-open unless explicitly overridden.
- [src/lib/ui/controls/menu.svelte.ts:254](../../../src/lib/ui/controls/menu.svelte.ts#L254) — The shared action handler returns without closeAll when that attribute is present.
- [src/lib/ui/components/MediaActions.svelte:686](../../../src/lib/ui/components/MediaActions.svelte#L686) — The concrete Right now tracking action does not override keepOpen. Many ordinary playback, relationship and tracking actions use the same pattern.
- [docs/design.md:84](../../../docs/design.md#L84) — The design contract says ordinary actions dismiss menus, with rating/volume controls staying open.

**Correction:** Default ordinary item buttons to dismissal and explicitly retain keepOpen for continuous rating/volume, deliberate multi-select interactions, and any failed-action/error UX that needs to remain open. Keep menu triggers marked open and preserve existing nested-menu focus restoration.

**Verification:** Add a rendered menu interaction test covering pointer and Enter activation of an ordinary item, nested ordinary item, ordinary link, intentionally retained checkbox/rating/volume control, and disabled explanatory item. Assert menu closure and correct focus restoration for ordinary actions, with retained controls still open.

**Original audit:** [UI-01](10-ui.md).

### UI-02

**P2 · correctness · strong-static — The isolated Header preview can change the real user’s presence settings and sign them out**

**Trigger:** An administrator opens /ui-preview/demo?component=Header (or the Header example in Components), opens Account menu → Activity status, and chooses a status or toggles Share activity. Clicking Sign out submits the real logout form. With mediaModal enabled, clicking a preview MediaCard can open the real root quick view.

**Impact:** A page explicitly described as isolated demo data can persist real activity/presence privacy changes, invalidate production route state, or terminate the administrator’s session. This is an isolation/correctness defect, not an authorization bypass: the server still uses the actual authenticated account.

**Evidence:**

- [src/routes/ui-preview/Demo.svelte:261](../../../src/routes/ui-preview/Demo.svelte#L261) — Header example renders a synthetic admin; its parent provides preview API/playback contexts.
- [src/routes/ui-preview/Demo.svelte:204](../../../src/routes/ui-preview/Demo.svelte#L204) — Preview capture only cancels anchor default navigation; it does not stop native form submission or component handlers.
- [src/lib/ui/components/Header.svelte:76](../../../src/lib/ui/components/Header.svelte#L76) — Status choices and Share activity call imported global chooseStatus/sharePresence without checking preview.
- [src/lib/social/status.svelte.ts:12](../../../src/lib/social/status.svelte.ts#L12) — Global updater calls the live API client, bypassing the synthetic client, and writes into the global userStatus.
- [src/lib/server/api/session.server.ts:9](../../../src/lib/server/api/session.server.ts#L9) — POST session/presence and session/status write authenticated user settings through the real status service.
- [src/lib/ui/components/Header.svelte:92](../../../src/lib/ui/components/Header.svelte#L92) — Preview Header also retains a native POST /logout form.
- [src/lib/ui/components/MediaCard.svelte:165](../../../src/lib/ui/components/MediaCard.svelte#L165) — With experimental mediaModal enabled, card click handlers also call global pushState despite the parent preventing the anchor default; this can mount the real root modal for a fixture ID.

**Correction:** Keep preview status and account actions local or route them through the existing injected client and a local preview state; guard the native logout submit in preview. Make MediaCard respect preview/defaultPrevented before global navigation. Preserve production Header/Card presentation and behavior.

**Verification:** In an isolated browser fixture, intercept and fail any non-fixture POST. Exercise Header status/sharing/logout in both direct and embedded previews; assert no live request, no global userStatus mutation, no route refresh/logout, and no real root modal from preview card selection. Separately confirm ordinary Header actions still use the real authenticated client.

**Consolidation note:** Root calibrated from P1 to P2: the defect requires an administrator to deliberately exercise an isolated demo control and affects that administrator’s own session/settings; no authorization bypass or automatic visitor-triggered account mutation is established.

**Original audit:** [UI-02](10-ui.md).

### API-02

**P3 · correctness · confirmed — Explicit public HEAD exports reject existing readable resources**

**Trigger:** A client sends HEAD to a public read resource with a valid token (or to the public OpenAPI document).

**Impact:** Reachability/authorization/header probes return method failure on resources whose GET succeeds; isolated actual-handler reproduction returned GET 200 versus HEAD 405 for /me.

**Evidence:**

- [src/routes/api/public/v1/[...path]/+server.ts:3](../../../src/routes/api/public/v1/[...path]/+server.ts#L3) — HEAD explicitly uses publicApiHandler instead of normal GET-derived behavior.
- [src/lib/server/public-api/handler.server.ts:32](../../../src/lib/server/public-api/handler.server.ts#L32) — Every method other than GET enters publicMutation, which has no HEAD operation.
- [src/lib/server/public-api/handler.server.ts:29](../../../src/lib/server/public-api/handler.server.ts#L29) — The unauthenticated OpenAPI representation exception also matches only GET.

**Correction:** Use normal GET-derived HEAD handling or dispatch HEAD through the same read authorization path with no response body, including the OpenAPI document.

**Verification:** Actual-route GET/HEAD parity tests with valid, missing and insufficient-scope credentials; assert matching status/relevant headers, empty HEAD body and openapi.json parity.

**Original audit:** [API-02](09-api.md).

### AUTH-04

**P3 · correctness · strong-static — Deleting a disabled administrator incorrectly trips the last-active-admin guard**

**Trigger:** Administrator A is the sole active administrator and B is another administrator account already disabled. A tries to delete B from Accounts.

**Impact:** Deletion is refused with Keep at least one administrator account even though A remains active. Operators must first demote B or create another active administrator to perform ordinary cleanup.

**Evidence:**

- [src/lib/server/auth/index.ts:240](../../../src/lib/server/auth/index.ts#L240) — deleteUser selects target id/role without considering its disabled status.
- [src/lib/server/auth/index.ts:242](../../../src/lib/server/auth/index.ts#L242) — Every admin-role target is subject to count(active admins)<=1, even when the target is already disabled and would not lower that count.
- [src/lib/server/auth/index.ts:291](../../../src/lib/server/auth/index.ts#L291) — updateUser correctly applies its last-active-admin guard only when the target was active and is losing active-admin status.

**Correction:** Under the existing administrator lock, count active administrators excluding the target and reject only if deleting the target would leave none; alternatively apply the current count check only to active admin targets. Preserve the self-delete restriction.

**Verification:** Disposable account tests should allow deleting disabled admin B while active admin A remains and retain rejection when deletion would actually remove the last active administrator.

**Original audit:** [AUTH-04](01-auth.md).

### AUTH-05

**P3 · verification · confirmed — The first-run HTTP journey no longer supplies the required setup fields**

**Trigger:** Run COAST_HTTP_TEST_URL HTTP journeys against a fresh disposable Coast installation without an already seeded coast-browser-test user.

**Impact:** The advertised first-run journey cannot establish its initial cookie, and subsequent tracking/page tests fail downstream. An existing account can hide the stale setup contract, so the fallback weakens first-run coverage.

**Evidence:**

- [tests/http-journeys.test.ts:21](../../../tests/http-journeys.test.ts#L21) — The first-run setup POST contains only username and password.
- [src/routes/setup/+page.server.ts:16](../../../src/routes/setup/+page.server.ts#L16) — Setup now validates the complete registrationSchema before calling createFirstAdmin.
- [src/lib/auth/registration.ts:6](../../../src/lib/auth/registration.ts#L6) — displayName and passwordConfirmation are required registration fields.
- [tests/http-journeys.test.ts:33](../../../tests/http-journeys.test.ts#L33) — After setup validation fails, the fixture attempts login with the same not-yet-created account.

**Correction:** Add displayName and matching passwordConfirmation to the setup payload, and keep login credentials as a separate payload. Make fresh bootstrap and existing-installation login expectations explicit so validation failure cannot masquerade as successful first-run coverage.

**Verification:** The current exact fixture object fails a harmless v.safeParse(registrationSchema, fixture) check for both missing fields. After repair, run the HTTP journey against a fresh disposable server/database and verify setup itself supplies the session cookie before later tests.

**Original audit:** [AUTH-05](01-auth.md).

### DISCOVERY-04

**P3 · verification · confirmed — Two database assertions still encode the previous Search/taste contracts**

**Trigger:** Run the existing disposable database suite on the current working tree.

**Impact:** The parent audit's full DB run reports these two failures. The Search assertion does not demonstrate a source/privacy leak; the meaningful !available assertion follows it. The taste count assertion prevents the same test reaching its stale-cache ranking assertions.

**Evidence:**

- [tests/domain-application-db.test.ts:1024](../../../tests/domain-application-db.test.ts#L1024) — Requires the other user's unavailable shared show to be absent, relying on old cutoff ordering rather than the unified catalogue contract.
- [src/lib/server/queries/media.ts:143](../../../src/lib/server/queries/media.ts#L143) — Authenticated search ranks SQL relevance before UUID, rather than metadata updatedAt; it does not hide shared unavailable metadata.
- [tests/taste-cache-db.test.ts:22](../../../tests/taste-cache-db.test.ts#L22) — Expects exactly four user_taste_profiles.
- [src/lib/social/taste-cache.server.ts:61](../../../src/lib/social/taste-cache.server.ts#L61) — Creates movie/show/game/music/book/comic profiles, including empty profiles.

**Correction:** Assert no availability/source grant for the other viewer rather than arbitrary absence from shared metadata results. Update taste expectations to the six supported profile media (prefer explicit medium identities) and retain later score/revision/privacy checks.

**Verification:** Parent-run log /private/tmp/coast-core-full-db.log reports failures at domain-application-db.test.ts:1024 and taste-cache-db.test.ts:22 (4 expected, 6 actual). Rerun both suites with disposable DB after test updates. This section did not run DB tests itself.

**Original audit:** [DISCOVERY-04](05-discovery.md).

### DOMAIN-08

**P3 · correctness · strong-static — Creating a playlist with an initial reading work bypasses its membership rule**

**Trigger:** POST /api/v1/lists with {name:Reading playlist,playlist:true,mediaId:BOOK_OR_COMIC_UUID}.

**Impact:** Creation succeeds with a member that the ordinary Add path forbids. Playback expansion ignores that reading member, producing a visible playlist item with no valid playback entry. This is a validation consistency issue, not a cross-user authorization bypass.

**Evidence:**

- [src/lib/core/lists/service.server.ts:38](../../../src/lib/core/lists/service.server.ts#L38) — createList validates only that the initial work exists and inserts it directly at line 46.
- [src/lib/core/lists/service.server.ts:140](../../../src/lib/core/lists/service.server.ts#L140) — addListItem checks the work category and rejects books/comics in playback playlists.
- [src/lib/server/api/lists.server.ts:19](../../../src/lib/server/api/lists.server.ts#L19) — POST /lists passes the create payload to createList, exposing the inconsistent initial-member path.

**Correction:** Apply the same category rule when creating a playlist with an initial member. Share the small existing validation if useful; preserve atomic create-with-initial-item behavior.

**Verification:** Add a disposable DB regression asserting book/comic initial playlist creation fails without leaving a list, while ordinary reading lists and screen/audio playlist initial members still succeed.

**Original audit:** [DOMAIN-08](04-domain.md).

### INFRA-04

**P3 · architecture · confirmed — Taste-outbox uniqueness index targets runtime-unused jobs table**

**Trigger:** Maintaining the documented taste-job invariant or inspecting the named index as assurance of outbox deduplication.

**Impact:** The advertised database invariant does not constrain actual job rows;parallel unused schema obscures ownership. Existing locked scheduling means ordinary duplicate execution is not established.

**Evidence:**

- [src/lib/server/db/schema.ts:709](../../../src/lib/server/db/schema.ts#L709) — Separate jobs declaration has no discovered production read/write caller;JSONB codec test inserts it.
- [src/lib/server/db/schema.ts:728](../../../src/lib/server/db/schema.ts#L728) — outbox_taste_one_active_idx is attached to jobs rather than outboxActions.
- [drizzle/0042_superb_major_mapleleaf.sql:46](../../../drizzle/0042_superb_major_mapleleaf.sql#L46) — Applied SQL creates named unique index ON jobs.
- [src/lib/social/taste-cache.server.ts:47](../../../src/lib/social/taste-cache.server.ts#L47) — Real taste scheduling inserts outbox_actions;manual admission uses advisory lock at34.
- [docs/experimental-features.md:68](../../../docs/experimental-features.md#L68) — Documentation incorrectly attributes active taste-job admission to a partial unique index.

**Correction:** Move the intended index to actual outbox via new migration and align schema,or explicitly document advisory-lock-only admission and remove misleading dead constraint. Review unused jobs table and codec test together before removal;do not create a second runtime.

**Verification:** Inspect index relation/predicate on disposable migrated DB and test intended active taste-job invariant on outbox_actions including terminal-state transitions;retain scheduler lock tests.

**Original audit:** [INFRA-04](12-infrastructure.md).

### MEDIUM-05

**P3 · correctness · strong-static — Normal canonical music links discard stored artist navigation**

**Trigger:** Browse an album/track with valid artist credits and follow its ordinary musicCard link after musicLibrary persists it.

**Impact:** Provider detail routes preserve album-artist versus performer navigation, but the default canonical detail path always drops it. An album with only album-artist credits may also lose its visible subtitle because persistence falls back to performing artists, not album artists.

**Evidence:**

- [src/lib/music/persistence.server.ts:42](../../../src/lib/music/persistence.server.ts#L42) — Artist and album-artist credits are persisted with separate roles and instance-scoped artist identities.
- [src/lib/music/presentation.ts:31](../../../src/lib/music/presentation.ts#L31) — Persisted album/track cards route users to the canonical music page.
- [src/routes/music/work/[id]/+page.server.ts:15](../../../src/routes/music/work/[id]/+page.server.ts#L15) — Canonical toItem explicitly returns artists:[] and albumArtists:[] without reading persisted credits.
- [src/routes/music/work/[id]/+page.server.ts:24](../../../src/routes/music/work/[id]/+page.server.ts#L24) — The route supplies connectionId:'' to the shared presenter.
- [src/lib/ui/pages/music.svelte.ts:20](../../../src/lib/ui/pages/music.svelte.ts#L20) — Artist links are built only from those role-specific artist arrays, so canonical pages lose all artist destinations.

**Correction:** Hydrate persisted role-specific music credits in the canonical read model and map navigable artist links through the viewer's enabled owned connection for that artist instance. Preserve plain credit text when no permitted source exists, using the established shared presenter and interface.

**Verification:** Disposable loader fixture: persist an album with only albumArtists and a track with distinct performers, follow musicCard.href, and assert expected subtitle/credit roles and authorised artist links. Disconnect the source and assert credit text remains without generating /music/work/{providerArtistId} links.

**Original audit:** [MEDIUM-05](11-music-gaming.md).

### MEDIUM-06

**P3 · correctness · strong-static — Removing an IGDB parent does not remove the old verified variant link**

**Trigger:** Use the game's explicit Refresh metadata action (games/import -> igdbDetails) after importing a verified parent, and return a successful full expanded IGDB response for that identity with the parent relation removed.

**Impact:** The local game indefinitely borrows artwork/overview and taste features from a parent that the current provider response no longer verifies. A successful refresh cannot return the game to independent presentation.

**Evidence:**

- [src/lib/providers/igdb/adapter.server.ts:153](../../../src/lib/providers/igdb/adapter.server.ts#L153) — Explicit details refresh requests the expanded fields including parent_game/version_parent; this finding concerns a successful full response, not an incremental observation.
- [src/lib/providers/igdb/adapter.server.ts:70](../../../src/lib/providers/igdb/adapter.server.ts#L70) — A current parsed response without parent_game/version_parent maps parent to undefined.
- [src/lib/core/games/service.server.ts:194](../../../src/lib/core/games/service.server.ts#L194) — Import upserts a variant only when a parent exists; no corresponding deletion handles an authoritative parent removal.
- [src/lib/core/games/service.server.ts:204](../../../src/lib/core/games/service.server.ts#L204) — Presentation continues borrowing the old parent's fields from the surviving row.
- [src/lib/social/work-features.server.ts:10](../../../src/lib/social/work-features.server.ts#L10) — Taste metadata also keeps selecting features from that surviving parent row.

**Correction:** Within the same metadata import transaction, remove the existing variant relation owned by this provider when the authoritative full response has no distinct parent. Keep the game UUID, Steam ownership and private tracking intact.

**Verification:** Extend the existing verified variant DB fixture: import child+parent, reimport the same child with no parent, assert the variant row disappears and gameDetails/workTasteFeatures use the child's own metadata; also test changing to a different verified parent.

**Original audit:** [MEDIUM-06](11-music-gaming.md).

### STRUCT-01

**P3 · maintainability · confirmed — Dense compound source has no consistent authoring guard**

**Trigger:** Reviewing or modifying control flow and multi-branch queries across feature implementations

**Impact:** Harder local reasoning and diffs; no runtime failure claimed from formatting alone

**Evidence:**

- [src/lib/server/queue/index.ts:48](../../../src/lib/server/queue/index.ts#L48) — Queue eligibility is a large compound expression; 61 modules have multiple >240-character source lines.
- [package.json:13](../../../package.json#L13) — Verification scripts cover types/build/tests/inventory but no formatting/lint convention.

**Correction:** Agree one convention and separate formatting from behavior changes; extract only concrete shared responsibilities

**Verification:** Formatting-only diff and existing behavioral checks

**Original audit:** [STRUCT-01](00-structure.md).

### STRUCT-02

**P3 · architecture · confirmed — Reader engines depend on their dispatcher for a shared cancellation helper**

**Trigger:** Isolating renderer code for tooling/testing or evolving engine loading

**Impact:** Avoidable runtime dependency group; no eager-loading/initialization defect asserted

**Evidence:**

- [src/lib/reading/reader/engine.ts:5](../../../src/lib/reading/reader/engine.ts#L5) — Shared cancellation helper and lazy format dispatcher are colocated.
- [src/lib/reading/reader/pdf.ts:4](../../../src/lib/reading/reader/pdf.ts#L4) — PDF engine imports the dispatcher at runtime for readerLoad.
- [src/lib/reading/reader/epub.ts:5](../../../src/lib/reading/reader/epub.ts#L5) — EPUB engine imports the same dispatcher while dispatcher imports EPUB dynamically.

**Correction:** Move only cancellation helper into an adjacent pure module, preserving lazy dispatch and type contracts

**Verification:** Reader close/abort tests and selected-format lazy chunk checks

**Original audit:** [STRUCT-02](00-structure.md).

### UI-03

**P3 · documentation · confirmed — The design guide contradicts the current mobile navigation and material inventory**

**Trigger:** A maintainer follows the current source-of-truth design guide while changing shared navigation or material usage.

**Impact:** The guide can prompt an accidental restoration of obsolete mobile navigation or invalid material names, conflicting with the requirement to preserve approved UX. Passing token/fixture tests do not resolve which visual contract the documentation intends.

**Evidence:**

- [docs/design.md:68](../../../docs/design.md#L68) — States primary navigation uses text-only pills on desktop and mobile.
- [src/lib/ui/components/Header.svelte:184](../../../src/lib/ui/components/Header.svelte#L184) — Below 640px the actual Header hides text labels and displays navigation icons.
- [docs/design.md:74](../../../docs/design.md#L74) — Names six shared treatments and says the six recipes are preserved.
- [src/lib/ui/materials/presets.ts:118](../../../src/lib/ui/materials/presets.ts#L118) — Actual supported material variants are four: clear, glassLight, glassDark and glassProminent, each with a paired fallback.

**Correction:** Reconcile the two guide statements with the approved current UI and actual four-variant API; record approval status accurately. Do not change mobile visuals or reintroduce recipes solely to make the older prose true.

**Verification:** Review the current narrow Header and Materials reference against the approved UI, then check that documented variant names match keyof glassPresets.materials and that mobile prose matches the resulting approved behavior.

**Original audit:** [UI-03](10-ui.md).

## Suggested implementation order

1. **Protect data and keep the system live.** Correct Seerr lane-lock reentrancy, nested pooled reads, canonical Jellyfin conflict identity reuse and both Trakt list invariants. Add bounded reproductions that assert data remains present and operations settle. Keep corrections separate where locks/identity/export have different owners.
2. **Enforce ownership and publication.** Preserve admin-owned settings on reset, filter private list context, generation-fence personal playback/Seerr publication, and make list writes and outbound intent atomic. Apply the existing locked/generation-aware patterns; do not add a second queue.
3. **Complete medium identity contracts.** Correct music edition/occurrence membership, GUID normalization and card entry keys; preserve exact Steam AppID observations; resolve Reading gates/aliases locally. Any necessary schema change needs its own migration and isolated regression. This audit is not authorization for new dependencies or an architectural expansion.
4. **Stabilize client and worker lifecycle.** Fix stop/close races, source-specific party retry, audio recovery, final reading persistence and reading source replacement. Bound buffered provider calls and prevent maintenance overlap while preserving long-stream idle behavior.
5. **Align read models and shared UI.** Fix positive-evidence candidate selection, permission/revision-aware Discover caches, canonical Search deduplication, bounded insights/credits, normal action dismissal, preview isolation and meaningful date/refresh behavior. Preserve the approved layout and existing loaders/shelves.
6. **Restore trustworthy maintenance checks.** Align migration snapshots without rewriting applied SQL, fence mutable image publication, repair the two stale DB assertions and fresh setup fixture, document actual materials/navigation/index ownership, and then agree formatting. Do not let cosmetic renames obscure behavioral patches.

## Existing roadmap items and unverified leads

- The activity-feed hydration path that can exceed a 60-work batch was already on the roadmap. It is not counted again as a new social defect. Preserve feed order and privacy when that parked work is selected.
- A hypothesis that ordinary Trakt maintenance deduplicates a fresh onboarding import was not retained: fresh connections default the relevant sync options off, and a normal reachable trigger was not established.
- Shared resource cancellation/latest-response behavior and list remount invalidation were inspected; the speculative stale-list bug was rejected because keyed callers replace the source.
- Some older request dialogs/pollers suppress stale delivery but do not abort their transport. Without a demonstrated visibility/resource failure, these are lifecycle follow-ups rather than additional accepted flags.
- The separate `jobs` schema/index is misleading, but existing advisory admission locking means duplicate taste execution was not established. INFRA-04 is an ownership/documentation/schema issue, not a fabricated duplicate-job incident.
- The remaining API history page-ceiling/OpenAPI refinements, physical playback acceptance, browser accessibility/cross-browser material verification and live-provider edge cases need focused acceptance work. No live outage, RAM leak, database corruption, account takeover or successful unauthorized external action is inferred from passing/failing mocked tests alone.

## Scope preservation

The audit is complete when the individual reports, deduplicated evidence and coverage/verification limits are available; it does not silently implement the recommendations. Existing local work remains untouched. No automatic roadmap rewrite or Git operation is part of this result.
