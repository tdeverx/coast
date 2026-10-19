# PJ-10 index matrix: positive private combination, no adoption

**Q1b plus I1 reduces measured task-history read work; neither Q1b alone nor I1 alone is adopted.** The combined private candidate returns the exact task response and lowers query-root shared visits **670→544 (18.8%)**, without temporary I/O. The unchanged Q0 does not admit I1 on this corpus. Query-only Q1b remains a rejected **4.8× buffer-work regression**. No production query, index, schema, migration, retention, dependency or provider behavior changed; PJ-10 stays open.

The [immutable actual receipt](evidence/task-history-index-matrix-actual.json) retains all four full sanitized plans and timing samples. The [exact executed probe](probes/task-history-index-matrix.ts) pins eight source files, the retained SQL/index and both previous negative receipts. [Machine report and artifact pins](task-history-index-matrix.json). Earlier [Q1](task-history-q1-current-index.md), [Q1b](task-history-q1b-current-index.md), [state-lane](task-history-lane-seek.md) and [grouped-maximum](implementation-feature-job-lease.md#pj-10-reject-the-grouped-task-history-query-trial) evidence remains unchanged.

## Four exact cells, one actual snapshot

Q0 is the exact current unfiltered canonical terminal query. Q1b is the already-reviewed per-connection kind maximum, null-connection fallback and final kind/scope maximum, admitted only under the actual immediate validated FK. It omits only impossible non-null orphan rows; it preserves current/null generation, raw/null four-kind fallback scope, unknown/dynamic task kinds, permanent history and descending timestamp/UUID terminal ties. Active window/count/eligibility/priority SQL, differing failed-row tie semantics, actionDetails and map/count composition remain unchanged.

I0 is the exact seven-index current catalogue. I1 is the [retained optional index](candidates/task-history-next/index.sql):

```sql
CREATE INDEX coast_audit_outbox_terminal_order_idx
 ON public.outbox_actions(connection_id,kind,updated_at DESC,id DESC)
 INCLUDE(account_generation)
 WHERE state IN ('succeeded','failed','cancelled');
```

The source comment describes the original secondary-clone proposal. Its bytes remain immutable; this experiment strips that comment and executes only the exact whitelisted CREATE statement under the revised isolation described below. No payload or raw-scope expression index is added.

| Private single plan | Q0/I0 | Q1b/I0 | Q0/I1 | Q1b/I1 |
| --- | ---: | ---: | ---: | ---: |
| Final terminal representatives |23|23|23|23|
| Query-root shared hits |670|3,191|670|544|
| Shared blocks read |0|0|0|0|
| Temporary read/write blocks |0/0|0/0|0/0|0/0|
| I1 admitted |No|No|No|Yes|
| History scan returned-row×loop sum, approximate |25,891|25,895|25,891|25,895|
| Sort output-row×loop sum, approximate |25,891|25,928|25,891|2,087|
| Largest reported individual sort |3,023KiB|635KiB|3,023KiB|288KiB|
| Heap Fetches reported by index-only nodes |0|0|0|93|
| EXPLAIN execution |29.047ms|18.498ms|28.321ms|4.487ms|

All four return the complete exact **23 hydrated task DTOs**, ordered terminal ID/scope tuples (including4 null scopes), unchanged active tuples/counts and taskCount/final order. The extracted baseline also equals the actual exported `listTaskActions` on the same existing administrator. No field stripping or output sorting hides a mismatch; actual identities, scope values and payloads remain private RAM and only opaque complete-output digests are retained.

The actual census has **25,891 terminal actions**, including2,054 null connections/null generations and no pending/running/failed, dangling-connection or obsolete-generation rows. Q1b's known9 connections across3 instances are the same retained corpus established by the prior census. Active/count acceptance is genuinely empty. No positive busy queue, differing failed representatives on timestamp ties, deliberate malformed/empty scope, unknown-kind or obsolete-generation cohort is claimed.

## What changes in the access path

Q0 still sequentially reads the history heap and sorts all25,891 rows, with or without I1. Q1b/I0 still performs9 per-connection bitmap heap/sort passes through the existing maintenance index, plus null fallback; the query alone increases visits to3,191.

**Q1b/I1 changes the connected branch to9 ordered Index Only Scan passes** on the new index. It reports345 shared hits and93 Heap Fetches for that node. The connected branch including its outer33-row sort totals346 hits; null fallback retains198 hits and a2,054-row sort. That explains the544 query-root hits. The per-connection history sorts disappear; final merge consumes40 representatives and emits23. Accountless fallback still needs the original payload-derived scope and therefore retains its bitmap heap path.

The candidate still scans approximately all retained terminal index/heap entries. It is **not** a bounded task snapshot, asymptotically history-independent read or a retention fix. Index-only admission also depends on actual visibility:93 heap fetches is an observed value, not a permanent zero-heap promise. I1 alone does not change Q0's observed plan; installing it without the query rewrite would pay storage/write costs without this measured Tasks benefit.

## Timings: three pairs only within the I1 phase

The buffer-work gate admits repeated readings only after I1 is actually used, root shared hit+read visits are lower than Q0/I0 and temporary I/O does not increase. The probe then alternates the **full listTaskActions owner**, preserving complete DTO/tuple equality after each read:

| Round / execution order | Q0/I1 full owner | Q1b/I1 full owner |
| --- | ---: | ---: |
|0: Q0 then Q1b|31.418ms|7.409ms|
|1: Q1b then Q0|34.405ms|6.696ms|
|2: Q0 then Q1b|**208.650ms**|16.255ms|

Descriptive three-sample medians are34.405ms and7.409ms. The208.650ms Q0 sample remains visible; its cause is uninstrumented. These are a small same-transaction, post-index sequence, not natural UI/job load, an SLA, a cold-start distribution or a causal before/after index-latency claim. Index construction and earlier reads warm caches. I0/I1 states were **not** alternated; do not portray the I1-phase query comparison as a randomized index benchmark. Single terminal EXPLAIN times above are separate from full-owner client timings. CPU, RSS, decoder/serialization cost and concurrency were not measured.

## Storage/build and revised isolation

| Actual private build observation | Value |
| --- | ---: |
| New index relation bytes |2,433,024|
| Existing outbox index bytes before I1 |7,872,512|
| All outbox index bytes while I1 exists |10,305,536|
| Outbox heap bytes |5,480,448|
| Client-observed CREATE elapsed |23.670ms|

This is one current25,891-row build with warmed reads, not a deployed build forecast or pure CPU duration. The extra index grows with retained terminal history and needs maintenance; there is no chosen history/byte/deadline policy.

The [older plan](next-task-history-plan.md) proposed a fresh secondary clone. Root instead approved a smaller reversible experiment on the **exact designated private audit clone**: initial read-only snapshot; one **write-capable REPEATABLE READ transaction** for Q0/Q1b I0, one ordinary non-concurrent CREATE, Q0/Q1b I1 and deliberate rollback; final read-only restoration snapshot. This avoids another database copy/drop lifecycle and keeps all four semantic comparisons on one snapshot and transaction timestamp. No database was created, dropped, recovered or overwritten.

**This was private DDL, not READ ONLY.** A normal CREATE INDEX takes a SHARE table lock. The lease was explicitly exclusive after the prior proof closed. Actual guards verify the exact clone name/loopback endpoint, PG17.11, source/index/negative pins, all15 outbox column types/nullability and validated id PK, exact seven valid/ready/live indexes, no pre-existing audit index, immediate validated nondeferrable FK with exact columns/actions, all four enabled immediate RI triggers, origin replication mode and no other observed client. All transactions verify30s statement/1s lock bounds, jit off and4MiB work_mem; one physical backend is maintained. Thirty seconds is this experiment's bound for hashes/build, not product policy. Client-absence checks are observations, not an exclusion mechanism against future connections.

The only new DDL is the pinned CREATE. The ORM hook rejects non-SELECTs. There is no domain DML, authored catalogue, job/control/provider call, forced scan setting, ANALYZE, VACUUM, existing-index drop or ledger migration. The unique rollback control flow completes and **all102 table logical multisets /1,864,145 rows, sequences, checked catalogue/column/constraint/index definitions and relation names match**, with the audit index absent. The pool closes and zero external fetches occur. Both old negative receipts and pinned source files still match.

Logical rollback does **not** erase physical WAL, page pruning/dead tuples, cache warming, cumulative statistics or I/O history. Those physical effects are not claimed restored. A fresh generated secondary clone remains the appropriate separately reviewed option if later write/HOT experiments require matched physical starting points or wider mutations.

## Remaining before any adoption

- **No production adoption.** The query-only option is still a4.8× work penalty on I0; query and index would need coordinated rollout. Preserve a safe current-query rollback path and require I1 availability before switching. No source shim or automatic fallback was added here.
- **Write and HOT costs remain open.** Inserts/terminal transitions, terminal recency changes, retries, deletes and connection SET NULL/rekey add another index obligation. Existing indexes remain for active scheduling/busy/succeeded-generation consumers. I1 adds no column names outside existing indexed definitions, but that does not prove HOT behavior or zero overhead; heap space, changed values and predicates matter. No DML/WAL/HOT schedule or natural frequency was measured.
- **Other consumers remain open.** `jobTimings` terminal lastRuns may benefit, but was not executed. Succeeded-only scheduling, active task plan/resource behavior and real busy-state counts are unverified. Existing functional task-summary/count/tie controls can supplement, not replace, missing actual cohorts.
- **Scale and visibility remain open.** No current replay of the older105,079-row deployed spill snapshot, future connection/kind distribution, large null-scope cohort or changed visibility map was performed. No read-model/history-retention redesign is implied. The raw-scope index I2 still has its own width/writer decision and was not introduced.
- **Normal schema rollout remains separate.** Any adopted index needs a reviewed migration and the existing [provenance/preflight process](migration-provenance.md), not a blind migrator or historical-hash rewrite. Build locking, retained-history disk and writer costs need a concrete operational decision. No normal/deployed migration or application change is authorized by this private result.

This report records a positive **private combined candidate** and the costs/gaps needed for a later decision. It does not close PJ-10, rerun broad app gates or invalidate the already completed normal functional trial: application source/test/build bytes were unchanged by this publication. Root owns shared status and final rollout choices. Independent read-only review of the exact executed probe/receipt found no material guard/restoration or claim-calibration blocker; it performed no tests or DB work.
