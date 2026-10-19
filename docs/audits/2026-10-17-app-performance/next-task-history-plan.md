# PJ-10 access-path plan and private trial status

**Updated status:** existing-index Q1 and refined Q1b were executed and rejected; the [complete Q0/Q1b × I0/I1 private matrix](task-history-index-matrix.md) then found positive read work only for **Q1b plus I1**. No production query/index/schema/migration was adopted. The original candidate SQL, DDL and failed receipts remain immutable. This plan now tracks completed trials and remaining acceptance, with source/artifact pins in `next-task-history-plan.json` and the matrix report.

## What the current schema permits

The current terminal owner is `listTaskActions` in `src/lib/server/queue/index.ts:583`. It chooses one `(kind, derived scope)` winner across all succeeded/failed/cancelled history, ordering by `updated_at DESC,id DESC`. Scope comes first from the joined connection's non-null `instance_id`, otherwise from raw payload `instanceId` for exactly four TMDB/IGDB kinds; everything else has null scope. A connection's status, enabled service, user state and list of configured task cards are not admission filters. Current/null generations are admitted for existing connections; missing connections admit any generation.

A history-table expression index cannot directly order by that joined scope. The existing maintenance index `(connection_id,kind,state,updated_at)` also puts state between kind and recency and lacks the UUID tie key and generation coverage. The succeeded-generation index serves a different scheduling family. Timestamp/UUID are NOT NULL; scope is text and nullable. `connection_id` has ON DELETE SET NULL, so deleted-account history must remain visible with fallback/null scope.

Both previous candidates stay rejected. Grouped maximum still sorted all25,891 rows and doubled shared hits669→1,338. State-lane discovery plus49latest seeks reread heap ranges through bitmap scans:670→4,068 hits plus214reads and a slower single plan. Neither exact candidate is proposed again.

## Original Q1 partitioning, then FK-admitted Q1b

Read `candidates/task-history-next/query.sql` (SHA256 `d58597211e21f76c90bf3e1c5aca0ee0a0fb52bcb0ae5bd446bce896eb392e28`).

1. For every actual connection (without extra status/user/service filters), perform one `DISTINCT ON(kind)` pass over its eligible terminal rows, ordered kind,updated_at DESC,id DESC. Scope is constant instance_id for this partition, so payload is unnecessary.
2. Preserve null-connection fallback rows directly. Original Q1 separately admitted non-null missing-connection IDs through a skinny anti-join, which found no rows while scanning history. [Actual immediate validated FK/RI admission](task-history-q1b-current-index.md) establishes that this non-null orphan case is unreachable for supported callers; refined Q1b omits only that CTE/UNION branch. Deleted connections still become null and retain the fallback.
3. Compute fallback scope with the exact canonical helper, retaining arbitrary/missing/empty text and the exact four-kind restriction. Select fallback representatives, then merge connected/fallback winners with the original final kind/scope/recency/UUID order.

This is distinct from the rejected lane query: no full-history lane discovery followed by per-state/per-kind rereads. It does not enumerate known service kinds. Choosing a total-order maximum per connection and then per shared scope equals the original scope maximum. But it can still scan every relevant index entry, adds an orphan admission pass and performs work for empty connections. It is not a bounded-task read model or a guaranteed asymptotic improvement.

These no-schema existing-index trials are complete: [Q1](task-history-q1-current-index.md) raises root visits670→3,861; [Q1b](task-history-q1b-current-index.md) removes the impossible orphan scan but still raises670→3,191. Both are rejected without timing repeats. Do not apply either query alone or rerun unchanged losing variants. The four-cell index matrix below preserves the unchanged Q0 control.

## Targeted I1: completed private rollback matrix, no adoption

Read `candidates/task-history-next/index.sql` (SHA256 `92e1c1446df2efd5b6f9639640df68911afb8b8a53c75d4e5990ce1cbffcba46`):

```sql
CREATE INDEX coast_audit_outbox_terminal_order_idx
 ON public.outbox_actions(connection_id,kind,updated_at DESC,id DESC)
 INCLUDE(account_generation)
 WHERE state IN ('succeeded','failed','cancelled');
```

The intended access path is a streaming kind/recency/UUID pass with generation available from the index; no entire payload is included. Existing visibility and planner choices decide whether it is actually index-only. The index can also serve the shared `jobTimings` terminal `lastRuns` lateral family, whose state-IN-three order has the same shape. Do not claim benefit for succeeded-only scheduling evidence or the active queue from that possibility.

The [executed matrix](task-history-index-matrix.md) compares Q0/I0, Q1b/I0, Q0/I1 and Q1b/I1 on one actual snapshot. Q0 does not admit I1 and stays670hits; Q1b plus I1 admits ordered index-only connected passes and lowers total visits to544, with93HeapFetches and a2,433,024-byte index. The null fallback still reads payload. Three alternating full-owner query pairs run only within I1; the report retains all samples including the208.650ms Q0 outlier. No forced scans, ANALYZE or VACUUM were used. This remains history-proportional work and a private combined candidate, not an index-only or production adoption.

I1 adds permanent-history disk and insert/update/delete maintenance. Terminal transitions, terminal updated_at changes, failed retry removal and connection deletion/rekey all gain another index obligation. Keep existing maintenance/success-generation indexes because their active/busy/scheduling consumers remain. Running heartbeat changes only locked_at; do not claim a new zero-cost HOT guarantee without inspecting actual paths. No full payload index avoids copying checkpoint/outcome JSON and new payload-width hazards.

## Deferred option I2, not a routine recommendation

If the actual null-connection residual dominates after I1, an accountless expression index on kind/local-scope/recency/UUID could stream its DISTINCT step. Exact private DDL is retained in `candidates/task-history-next/local-scope-index.sql` only as a reviewable option. Raw payload scope has no SQL width/type bound; an expression B-tree could reject oversized future keys and can affect payload-update/HOT behavior. It would not cover all missing non-null connections. Do not silently cast scope to UUID, normalize it, truncate it, add a new policy budget or include whole JSON payload. This option needs separate writer/width evidence and a design decision before adoption.

## Exact semantic acceptance

Compare complete ordered terminal ID/scope tuples, the unchanged active ID/count/scope tuples and complete `listTaskActions` DTO/taskCount/order in RAM. Preserve every unknown/local kind and permanent old last result; no date, recent-N or configured-card filter. Preserve null scope ordering (ASC NULLS LAST), deleted connections through their SET NULL fallback, null/current/obsolete generations, raw fallback scope text, timestamp/UUID ties and per-state counts. For Q1b, non-null orphan references are outside the verified immediate-FK state; reject FK drift instead of adding a compatibility branch.

Failed rows deliberately participate in both active and terminal reads. Their tie policies differ: active failed uses updated_at DESC then created_at/id ASC; terminal uses updated_at/id DESC. Two IDs can survive on an exact timestamp tie, with taskCount attached only to the active representative. Do not merge them by kind/scope or replace counts with terminal group size. Keep active SQL, pending eligibility/priority, running locked_at order and actionDetails unchanged.

The saved actual corpus has25,891 terminal rows,23representatives and4null scopes, but no active/dangling/obsolete-generation positive cases. That is an actual-data gap, not permission to invent performance records. Use separate authored correctness controls for those edges and ties, explicitly labelled supplementary. The older deployed105,079-row/spill receipt is useful prior evidence, not a fresh runtime claim or an available new clone.

## Safety and decision boundary

Q1/I0 and Q1b/I0 were read-only. For I1, root explicitly reviewed a smaller method than the original secondary-clone proposal: one write-capable REPEATABLE READ transaction on the exact designated private clone, one non-concurrent CREATE INDEX, all four cells on one snapshot/time, then deliberate rollback. Actual guards verify source/schema/index/FK/RI/origin/endpoint/backend and budgets; all102 table logical values/sequences/catalogue/old-index definitions restore and the new index is absent. The pool closes. This private DDL can leave physical WAL/pruning/cache/statistics/I/O effects despite logical rollback. Future write/HOT work may still require matched secondary clones. No normal/deployed schema, provider, job, retention or global configuration change occurred.

Source review alone establishes no gain. Stop on any complete-output mismatch. Retain clear negative work results without repeats. If an index/query combination helps, report size/build and future maintenance costs before proposing production source or migration changes. This plan intentionally omits durable snapshots, generated columns, recursive loose scans and history-pruning redesigns.

Root retained the original proposal and then separately approved these private trials. The positive [Q1b+I1 result](task-history-index-matrix.md) does not close PJ-10. Write/HOT costs, other timing/scheduling consumers, actual busy/failed cohorts, larger-history/visibility behavior and normal migration/provenance acceptance remain open. No automatic production source/index application follows. Report publication changes no app/test/build bytes and does not invalidate the completed normal functional trial.
