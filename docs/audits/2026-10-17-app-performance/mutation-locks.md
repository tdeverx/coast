# Mutation lock ordering

This follow-up reviews the implementation tree after the earlier DATA-01/02 changes, against audited HEAD `eb0673873462b71118d1c11678d128958a05ff07`. It identifies four distinct lock-order findings. LOCK-01/02 have scoped source changes and actual-data clone evidence. LOCK-03/04 remain source-confirmed order inversions with runtime consequences unverified; they have no implementation in this pass. No production database or external provider was mutated.

## Shared owner and contract

`drizzle/0058_feature_controls.sql:4-9` defines the existing admission order: shared `coast:configuration` advisory lock, then the subject user row `FOR SHARE`. `src/lib/server/features.ts` exposes this through `lockFeaturePolicyInTransaction`, used by both SQL/Drizzle feature-admission helpers. The new helper acquires these existing locks only. It does not evaluate a feature, reject disabled cleanup, change a feature choice, or add a database function.

Transactions which later reach feature admission must acquire that fence before the plain user/account advisory lock and domain locks. Existing checks still run at their original logical point, retaining their errors and conditional behavior. Existing `requireFeature`, `requireFeatureInTransaction`, and `requireWorkFeature` execute the same number of SQL calls after delegation. Each newly fenced transaction adds one bounded SQL round trip. An empty `createList` keeps its prior path without the added fence.

Global policy changes use an exclusive configuration advisory lock (`application/configuration.server.ts:16`). Personal settings take shared configuration, then the user row `FOR UPDATE` (`server/auth/index.ts:372-373`). The actual probe distinguishes these two writer protocols; they did not behave identically.

## LOCK-01 — account-first callers later enter policy admission

Ten pre-change acquisition sites reached policy after acquiring the account lock. The new lock-only fence is placed at their transaction entry. All media use the same owners; no card, route, or medium-specific patch was added.

| Owner | Pre-change account site | Later admission/consumers |
|---|---:|---|
| `core/reading/service.server.ts` `writeReadingInTransaction` | 40 | Book/comic progress, saved imports, rereads, public reading mutation and session movement |
| `reading/sessions.server.ts` `prepareReading` | 67 | Local and Jellyfin reader preparation; reader + book/comic admission |
| `core/lists/service.server.ts` `createList` | 39 | Initial work only; all supported work categories |
| Same owner, `addListItem` | 141 | Owned-list validation remains before work rejection; ordinary lists and playlists |
| `core/tracking/continue.server.ts` `changeContinue` | 54 | Add/remove/undo for whole movie/show/season/episode targets |
| `social/presence.server.ts` `startCheckin` | 31 | Presence/screen admission |
| Same owner, `completeCheckin` | 55 | Conditional expired check-in → concrete tracking admission |
| `playback/service.server.ts` `progressPlayback` | 467 | Screen tracking branch; audio uses a nonlocking predicate and listen persistence |
| `sync/values.server.ts` `reconcileProviderValue` | 161 | Jellyfin/Trakt imports, live history, outbound reconciliation, rating/tracking and supplied callbacks |
| `sync/conflicts.server.ts` `resolveConflict` | 183 | Accepted provider/imported tracking or rating state; list/request/no-op branches retain behavior |

### Actual-data result and limits

[`evidence/implementation-mutation-locks-real.json`](evidence/implementation-mutation-locks-real.json), produced by [`probes/real-mutation-locks.ts`](probes/real-mutation-locks.ts), uses an existing actual user and movie with the real `changeContinue` implementation, comparing the audited owner against the fixed owner with current shared dependencies. Every Continue transaction is rolled back. The actor, title, and catalogue are not invented. An initial attempt to select a populated actual list found none, so the probe stopped before any lock work and was changed to Continue; it did not seed a list.

The harness deliberately holds the real command, another policy/account transaction, and an exclusive policy writer. It observes exact backend edges through `pg_blocking_pids`, without retaining user IDs or backend PIDs in evidence. With a queued global policy writer, the audited command formed a directed three-party wait cycle and took approximately one second after release to finish. PostgreSQL resolved the queue cycle without a hard deadlock error. The fixed owner completed without the sampled cycle. These are controlled protocol timings, not natural application latency benchmarks or a claim of a one-second saving on every mutation.

A queued user-row exclusive writer was a negative control: both audited and fixed commands completed without a reproduced cycle. The original broader hypothesis that both writers would produce `40P01` was not supported. Do not describe LOCK-01 as a reproduced hard deadlock, or extrapolate the representative Continue result to runtime acceptance of every conditional branch in all ten owners. Source coverage establishes propagation; broader API and job schedules remain acceptance work.

The probe also changes a real subject's screen choice only inside a rolled-back transaction: the lock-only helper still admits cleanup, while the existing feature helper still rejects the disabled write. This verifies that the fence itself adds no feature rejection.

## LOCK-02 — token quota upgrades a shared user row

`server/public-api/tokens.server.ts:createApiToken` previously called policy admission at line26, then selected the same user `FOR UPDATE` at line27 to serialize the 20-token quota. Two creators could both acquire the shared user fence and then wait while upgrading it. The fix retains policy admission, takes the existing user/account advisory mutex, then performs a fresh nonexclusive active-user read. Quota, token hashing, expiry, scope validation, onboarding, revocation and disabled-user checks remain in their existing owner.

The actual probe calls the real `createApiToken` using an existing administrator. Both creators rendezvous after admission. The audited owner produces one success and one PostgreSQL `40P01`; both transactions roll back. The fixed owner succeeds twice without the upgrade deadlock. A separate committing test brings the same real account to 19 active tokens using temporary private-clone authentication rows, then races two real issuances: exactly one succeeds, one reports `token_limit`, and the active count is exactly20. Every temporary token is removed afterward; the full original token-row digest and count are restored. No credential value is written to the report, no external provider is called, and no new user/catalogue row is created.

## LOCK-03 — Steam connection precedes nested account admission

`providers/steam/sync.server.ts:assertAccount` locks the provider connection `FOR UPDATE` before fencing the job attempt. A first ownership observation in a chunk later calls `trackInTransaction`, which acquires policy then the account advisory lock. Other concrete commands acquire policy/account before their provider connection, but these callers are normally Jellyfin/Trakt/Seerr-specific. A real runtime counterpart taking the **same Steam connection** after account admission has not been established. A connection/account cycle is therefore a candidate requiring that missing edge, not a confirmed runtime deadlock. The existing real 1,144-game checkpoint probe refreshed existing ownership and did not exercise this new-ownership branch.

This is a separate source finding, not covered by LOCK-01 or the checkpoint proof. Proposed direction, conditional on proving that edge: acquire policy/account at the ownership chunk transaction entry, before `assertAccount`, preserving connection→outbox attempt fencing and immutable snapshot/cursor atomicity. Do not blindly add locks to metadata/network phases or acquire an account lock while holding a provider network lane without tracing it. `deleteUser` also takes the user row before cascading connection deletion, which suggests a distinct user-row/connection interaction worth proving against Steam's later policy subject lock. Before implementation, establish a real counterpart and exact wait graph on actual rows, then verify new-ownership admission, stale attempt/reconnect behavior and cleanup. No source change made here.

## LOCK-04 — social row locks precede nested policy admission

`social/service.server.ts:changeFriend` locks/updates a friendship and resolves its notification before its acceptance branch requests policy on both participants. `recommend` acquires policy before locking that friendship. `respondRecommendation` locks the friendship and recommendation before its save branch enters tracking policy. These are domain-row/policy order inversions distinct from the plain account census.

Smallest proposed direction: take lock-only admission before the domain locks on the paths that can later require it. Participant identities must be resolved and revalidated coherently; preserve friendship ownership/state checks, acceptance privacy, notification delivery, and disabled-feature dismiss/remove cleanup. A multi-subject fence must not introduce an opposite user-row upgrade order. Prove the concrete wait graph using existing actual friendship/recommendation rows; if those rows do not exist, state the data gap instead of seeding fictional social activity as actual acceptance. No implementation or runtime reproduction yet.

## Complete pre-change plain-account census

These 39 sites across23 files are retained in `mutation-locks-findings.json` with current line references. The classification is a reviewed TypeScript call-graph result, not a universal guarantee about every database side effect.

| Classification | Owners/sites |
|---|---|
| Ten inverted entries, now fenced | The ten LOCK-01 rows above |
| Twelve already policy-first | `reading/sessions.moveReading`; `music/persistence.logMusic`; `core/lists/sequence.restartPlaylist`; `core/ratings.rateInTransaction`; `core/tracking/rewatch.setRewatch`; `core/tracking.trackInTransaction`, `bulkTrackInTransaction`; `experiments/planning.createPlan`; `providers/seerr/requests.requestMedia`; `server/public-api/webhooks.createWebhook`; `server/public-api/mutations.publicMutation`; `playback.preparePlayback` |
| Seventeen without a later policy acquisition in the reviewed TS graph | `sharing.createShare`; `core/lists.updateList`, `deleteList`, `removeListItem`, `reorderList`, `moveListItem`; `social/presence.cancelCheckin`; `application/feature-transition.reconcileFeatures`; `sync/trakt-lists.exportTraktListToAdapter`, `deleteListWithExports`; `sync/history-removal.removeHistory`; `sync/values.acknowledgeProviderValue`; `sync/conflicts.refreshConflictStatus`; `sync/list-values.reconcileProviderList`, `acknowledgeProviderList`; `sync/jellyfin-playback.unchangedJellyfinPlayback`, `seedEmptyJellyfinPlayback` |

LOCK-02 adds one new policy-first account site, so the current plain-account census has40 sites across24 files. Namespaced locks such as `synced-user:`, `sharing:`, provider lanes, metadata identities, friendship pairs and maintenance admission are separate resources and were not counted as the plain account lock.

### SQL edges and remaining coverage boundaries

The repository SQL search finds `coast_lock_feature_policy` defined in0058, with no SQL function/trigger references to it. In the private actual clone, `pg_proc` inspection finds only that function with either its name or shared advisory acquisition in the body, and zero attached noninternal policy guard triggers. The probe records this aggregate inventory. Plain `coast_feature_enabled`/`coast_category_enabled` predicates are nonlocking SQL functions and must not be counted as policy-lock acquisition.

This inspection narrows the present clone's implicit-policy edge risk. It is not a certificate for an independently modified deployed database, dynamically constructed SQL, all future triggers, cascades, or every non-policy row lock. The17 sites are not blanket-edited or globally labelled safe. Future trigger/function changes require recapturing `pg_get_functiondef`/`pg_get_triggerdef` dependencies and reviewing affected write paths before changing their classification.

## Verification and drift control

Run the guarded actual probe using the documented private-clone runner, never normal/deployed application databases. Preserve both the global writer positive case and user-row negative control; a missing hard deadlock does not erase an observed wait cycle. Preserve token concurrency plus exact20-cap, authentication-row restoration, rollback boundaries and zero external calls. Source review should check new account-lock entries for nested admission and callbacks, including SQL-trigger edges. Full app check/build and existing domain suites are owned by the root implementation pass; this appendix does not claim those results.

No retries, new indexes, schema changes, dependency additions, broad feature-policy changes, or changes to the17 reviewed account-only owners were introduced.
