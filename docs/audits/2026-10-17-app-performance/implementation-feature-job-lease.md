# Feature job lease fencing and retained provider/query options

`FEATURE-JOB-LEASE-OBS-06` is an additional observation outside the original 94-finding baseline. The shared lease owner now accepts the existing raw SQL transaction, and feature withdrawal checks that lease inside every cleanup transaction after its account lock. This closes the demonstrated admission gap without changing feature policy, chunk sizes, checkpoints, provider behavior or direct-call behavior. PJ-07, PJ-09 and PJ-10 remain open. No schema, dependency, normal database or concurrent experiment changes were made.

## Change and shared ownership

Previously, `reconcileFeatures` took its existing account advisory lock and ran a cleanup chunk before `jobCheckpoint` checked the current attempt. A cancelled or replaced worker could therefore reach cleanup statements before it yielded. The cursor writes already require the correct running attempt; that does not fence the preceding domain transaction.

`src/lib/server/queue/execution.ts:17–39` remains the canonical `assertJobLease` owner. Its new raw-store branch binds the exact job identity and attempt, uses the same `coast_job_allowed` predicate, and optionally locks the running outbox row with `FOR UPDATE`. Missing context remains a no-op for direct callers; a missing current lease throws the existing `JobYield` control flow. The original Drizzle branch is byte unchanged and that equality was checked against HEAD in the actual proof.

The only new consumer is `src/lib/application/feature-transition.server.ts:32–34`: existing account advisory lock → existing policy predicate → current outbox lease lock → existing cleanup. Every iteration of the existing inner chunk loop goes through this point. No new policy rejection was added: `drizzle/0058_feature_controls.sql:36–38` explicitly permits `feature.reconcile`, and the actual installed function body and actual job result were checked. Feature withdrawal remains permitted when ordinary personal work has been disabled.

The 13 existing Drizzle invocation sites in 11 source files retain their existing branch and call pattern:

| Consumers | Source call sites |
| --- | --- |
| Reading catalogue persistence; music persistence | `catalogue/reading-files.server.ts:41`; `music/persistence.server.ts:99` |
| Jellyfin access and update admission; Seerr connection persistence | `providers/jellyfin/access-proof.server.ts:68`; `providers/jellyfin/updates.server.ts:27`; `providers/seerr/connection.server.ts:29` |
| Recommendations and taste persistence | `recommendations/providers.server.ts:86`; `social/taste-cache.server.ts:109` |
| Jellyfin personal import and playback persistence | `sync/jellyfin.server.ts:287`; `sync/jellyfin-playback.server.ts:27,86` |
| List and scalar value persistence | `sync/list-values.server.ts:140,251`; `sync/values.server.ts:169` |

Paths in this table are relative to `src/lib/`. This is a call-site coverage statement, not a claim that every application write already uses this helper. Raw SQL support now gives the existing shared owner the same fencing contract for the new consumer; it does not introduce a separate queue, transaction wrapper or medium-specific guard.

The reviewed queue controls do not introduce a reverse lease → account advisory-lock edge: `cancelAction` (`queue/index.ts:623`) updates waiting/failed work and resolves its notification; `promoteAction` (`:640`) locks its outbox row and updates purpose/priority; `retryAction` (`:650`) takes the existing provider-maintenance mutex, checks service conflicts and updates the outbox row. None calls account-locking cleanup after acquiring that row. This is bounded source inspection of these controls and the installed policy predicate, not a universal lock-order proof for all triggers or all workers. The valid attempt holds its lease row only until the existing cleanup chunk commits; no new time or byte budget was selected.

## Verification on the actual retained corpus

The source-pinned [actual probe](probes/feature-job-lease-actual.ts) ran on the approved private actual-data clone with one reserved SQL connection, explicit and verified `statement_timeout=30s` and `lock_timeout=5s`, an external-fetch trap, and an outer rollback. Only one existing feature job's state/attempt metadata was varied for the controlled schedules. Its real actor, payload, config, cutoff and retained checkpoint were kept unchanged. No invented user, catalogue, cleanup row or membership evidence was added.

| Schedule | Before | Current | Actual acceptance boundary |
| --- | --- | --- | --- |
| Cancelled job | Account lock, 4 domain statements, then `JobYield` | Account → policy → lease, `JobYield`, **0 domain statements** | Existing cancelled attempt is rejected before cleanup admission |
| Replaced attempt | Account lock, 4 domain statements, then `JobYield` | Account → policy → lease, `JobYield`, **0 domain statements** | Existing job identity with an obsolete attempt cannot reach cleanup |
| Valid retained checkpoint | Returns `{checked:4}` | Same complete outcome and affected-table digest | The actual cursor has already traversed all users, so neither variant enters a cleanup chunk |
| Direct call | 4 users, 16 domain statements, `{checked:4}` | Same statements, outcome and affected-table digest | Missing execution context preserves direct-call behavior |

All actual domain statements above matched **0 cleanup rows**. The proof therefore establishes the actual SQL admission boundary and complete unchanged direct/resume results, not positive playback/reading/social withdrawal side effects. The raw helper separately accepted the valid actual running lease. After rollback, **102 tables and 1,864,145 original row values** had exactly equal sorted-row SHA-256 multisets. No provider fetch was attempted. See [the sanitized receipt](evidence/implementation-feature-job-lease-actual.json).

The probe keeps baseline/current phases under savepoints in one outer transaction so `now()` is identical and every original row is restored. It does not reproduce autonomous worker chunk commits, heartbeats, concurrent cancellation or a naturally observed stale-worker incident. It does not claim a production latency gain. A real valid attempt with active cleanup rows remains an actual-data gap; the existing completed checkpoint was not modified to manufacture that cohort.

The meaningful controlled regressions in `tests/job-lease.test.ts` pass **6 tests / 20 assertions**: direct no-query behavior, exact raw parameters and optional lock, policy denial before lease lock, stale rejection before continuation, repeated chunk fencing, and replacement before a second chunk. The chunk fixture is supplementary source-contract verification, not real media evidence. [Test receipt](evidence/implementation-feature-job-lease-tests.json). Root separately reported the common gates at 753 unit tests, zero failures, check 0 errors/0 warnings and a successful build; this owner did not repeat broad gates.

## PJ-09: no value guard adopted without an eligible actual cohort

The [read-only census](evidence/implementation-provider-membership-census.json) found **3,618 actual Jellyfin show/season provider parents**, 26 with `expectedMembers`, and **0 with current membership evidence**. Sixteen of those 26 have equal expected/retained-child counts and all 26 already store the calculated `membershipComplete` value, but none is admitted by the finalizer's current account/evidence predicate. This does not establish 26 avoidable updates in the current finalizer. No provenance was invented and no app change was made.

Source review narrowed the possible future guard. `provider_items` (`server/db/schema.ts:334–346`) has no `updated_at`; the finalizer (`sync/jellyfin.server.ts:830–840`) changes only snapshot `membershipComplete`. Actual observation freshness is written earlier as `membershipEvidence.observedAt` (`:451`) and `last_seen_at` remains a separate observation. The revision trigger in `drizzle/0039_performance_benchmarks.sql` ignores identical rows after excluding `last_seen_at` and snapshot `coastUserData`; it does not generally exclude `membershipEvidence.observedAt`. Identical snapshot tuple writes are still a potential storage cost, but a no-op membership write must not be described as necessarily changing content revision or refreshing an observation timestamp.

The smallest future option is an exact value-difference condition within the existing membership projection, retaining account-generation/evidence predicates and parents touched through either parent or child. Acceptance must include true→false and false→true changes, unchanged values, show/season child identities, stale evidence, changed children, current source visibility and downstream Collection behavior. A set-based count plan remains a separate scale option. Eligible actual retained evidence and its plan are still required before claiming a measured benefit. [Reproducible census source](probes/provider-membership-census.ts).

Membership publication itself (`:830–840`), progress publication (`:219–238`) and final shared-library completion publication (`:884–895`) are outside this feature-job change. Their same-transaction account/generation/lease ownership needs a separately reviewed plan and actual cohort; this report does not close their finalization/cancellation questions.

## PJ-10: reject the grouped task-history query trial

The [read-only actual query comparison](evidence/implementation-task-history-options.json) preserves the exact current terminal `DISTINCT ON` SQL and a grouped-maximum candidate, with both full JSON plans. It used a repeatable read-only transaction, explicit verified 30s/5s limits and 4 MiB `work_mem`. The candidate groups by the **actual derived scope**, then joins the latest timestamp and preserves the descending UUID tie-breaker; null scope equality uses `IS NOT DISTINCT FROM`. It does not enumerate only configured service tasks.

On this private snapshot, all **25,891 actions** were terminal. Both queries returned exactly the same **23 complete identity/scope rows**, including **4 null scopes**, for every run. The corpus contains 2,054 null connections/generations and no obsolete-generation rows. Five alternating pairs gave descriptive medians of **25.943 ms before / 24.345 ms candidate**. This isolated sample is not evidence of a useful production speedup.

The actual plan rejects the intended resource argument: the candidate still sorts **all 25,891 rows** (2,942 KiB versus 3,023 KiB), adds a 217 KiB hash aggregate and another small sort/join, and doubles shared hits from **669 to 1,338**. The separate plan executions were 28.207 ms / 27.898 ms. No query, index, permanent-history retention, scheduler or API behavior was changed. [Exact query/probe source](probes/task-history-query-options.ts).

The original scan/spill finding remains valid on the separately captured deployed snapshot. A future bounded read model, or a targeted index whose admission and write-maintenance costs are justified, needs a concrete schema/ownership decision. It must preserve dynamic local task kinds, null and deleted-connection scopes, null/current/obsolete generations, timestamp ties, UUID order, active-state counts and permanent history. This trial alone does not cover positive obsolete-generation or timestamp-tie cohorts. A catalogue of known service tasks cannot replace those semantics.

## Drift controls and remaining work

Keep the canonical helper and all consumer inventory together when raw callers are added. New committing worker transactions should take their established account/connection lock first, call the shared lease guard, and then mutate; direct cleanup must continue to work. Do not replace `JobYield` with a provider failure or consume retry credit. Future edits to the original Drizzle branch require its own meaningful acceptance rather than relying on this byte-equality receipt.

Source pins, machine-readable status, exact scopes and all remaining gaps are in [implementation-feature-job-lease.json](implementation-feature-job-lease.json). The three actual probes are one-off source-pinned audit reproductions against a caller-provided guarded private clone, not general migration or production-worker commands. They expect the audit checkout/baseline and must not be pointed at normal or deployed databases. No durable raw private rows or credentials are retained in these reports.
