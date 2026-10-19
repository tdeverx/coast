# Planned no-op repairs — two accepted, membership guard rejected

This batch follows the existing [DATA-07 plan](data-api.md#data-07--p2p3-several-unchanged-operations-still-perform-physical-updates-timestamps-and-downstream-work) and [PJ-09 plan](providers-jobs.md#pj-09--p2-scale-candidate-final-shared-library-membership-update-rewrites-matching-parents-and-correlates-child-counts). Each agent executed its own native default/candidate verification against actual retained data before reporting a decision. No production dependency, UI redesign, normal mutation, commit, push or PR is added. Accepted fixes are in the existing main working tree, uncommitted.

| Planned owner | Decision | Verified before → after |
| --- | --- | --- |
| Game updatePlaythrough | Applied | Four equivalent saved-value commands: 6 → 3 statements, 1 → 0 tuple updates; projection/webhook invocations 1 → 0. Current timestamp and state retained. |
| Up Next membership | Applied | 30 outcomes: 82 → 66 statements; projection eligibility reads 24 → 8. Genuine membership changes keep existing statement counts. |
| Provider membershipComplete | Keep current; proposed guard rejected | Exact four connection scopes have no eligible rows or buffer reduction. Broader real-parent diagnostic increases buffers 8,741 → 43,956 and warm median 13.463 → 29.519 ms. |

## Game commands

The guard lives after unchanged input validation, feature-policy fences and owned-row FOR UPDATE admission. It compares normalized status/progress and derived start/completion timestamps, then returns the current row before UPDATE, Collection projection or webhook preparation. Missing start-date repair remains a genuine change. [Exact patch and manifest](candidates/game-playthrough-noop/README.md), [actual receipt](candidates/game-playthrough-noop/actual.json), [maintained probe](probes/game-playthrough-noop-real.ts).

Twelve comparisons use the one actual persisted playthrough: four saved-value no-ops, five disclosed reversible real-row change controls, invalid commands and another actual owner. Complete true-change outputs/state/revisions retain one update/publication invocation. No-op output differs only by intentionally retaining the current updatedAt rather than advancing it. All 102 tables / 1,864,145 row values restore to the original digest. There are no actual sessions or active recipient cohorts; projection/webhook invocation proof is not delivery, recipient-count or concurrency proof. WAL insertion samples are server-wide descriptive observations, not attributable savings.

## Up Next commands

INSERT/DELETE RETURNING at the shared owner gates projection preparation on an actual membership change. Queued=true retains the existing feature/work validation and conflict behavior. No preflight query, cache or alternate endpoint owner is introduced. Extra cost is at most one mapped UUID on a successful membership write. [Exact patch and manifest](candidates/up-next-noop/README.md), [actual receipt](candidates/up-next-noop/actual.json), [summary](candidates/up-next-noop/summary.json), [maintained probe](probes/up-next-noop-real.ts).

Thirty outcomes cover four actual users and an actual work, absence, enqueue/retry/dequeue, validation/withdrawal and errors. Every compared canonical state, revision, outbox/event set and return/error matches. All 102 tables / 1,864,145 rows and sequences restore. The whole-state-plus-sequences digest uses a different serialization from the older canonical row-only digest; each before/after pair equals itself. No saved Up Next membership or enabled projection connection exists naturally, so positive lifecycle tests are controlled rollback commands on real records, not observed usage/performance cohorts. No latency, CPU, heap, WAL or connected-provider improvement is inferred.

## Provider membership decision

The simplest target-local guard preserves every generation/account/evidence/touched-parent predicate and its concurrent recheck behavior. It is tested once rather than extended into a new access-design search. The actual data has 3,618 parents, 26 declarations and zero eligible membership-evidence parents. Four exact scopes stay empty with 40,682 root visits. The separate 26-parent read diagnostic shows all stored flags already match, but the candidate changes the access path and performs materially more work. Changed rows would also repeat the correlated count. [Full decision and measurements](candidates/provider-membership-guard/README.md).

Keep the current runtime. The planned guard comparison is finished with a negative result; no further alternative is required merely to produce a patch. Positive finalization and concurrency remain unverified rather than invented. PJ-09 stays open in the canonical ledger; its tested option is explicitly rejected.

## Shared rules and verification

[performance.md](../../performance.md#command-no-ops-and-keep-current-decisions) records the command admission and stopping rules. [Combined gates](evidence/implementation-found-21-gates.json) pass tests, typecheck, production build/navigation drift, inventories and style. Guarded database/provider skips remain coverage gaps, not actual-data evidence. The accepted owners add no UI change or deployment. DATA-07 remains partial because other metadata/freshness/no-op owners and named actual recipient/concurrency acceptance remain. Canonical totals remain 22 open / 38 partial; agent completion is not finding completion.

The adjacent [prior query investigation](implementation-found-20.md) is closed with no additional adoption. Its newly discovered interest-order candidate is reverted and listed for follow-up, outside this pass's existing-plan implementation. Already implemented DATA-04 union hydration was checked against its current source hash and existing complete actual-data proof; it was not reimplemented or retested unnecessarily.
