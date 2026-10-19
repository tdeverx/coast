# PJ-10 Q1 on current indexes: exact results, worse read work

**Rejected; no application query, index, schema or retention change.** The new connection-partitioned Q1 from the [offline plan](next-task-history-plan.md) returns the exact current task response, but its existing-index access path performs more work. Neither previously rejected grouped-maximum nor state-lane candidate was repeated. PJ-10 remains open.

The [immutable actual receipt](evidence/task-history-q1-current-index-actual.json) contains canonical/candidate SQL, current index/constraint definitions, complete numeric/structural plans and opaque output hashes. The [executed probe](probes/task-history-q1-current-index.ts) verifies source and candidate pins, uses one repeatable-read **READ ONLY** physical session with verified **10s statement /1s lock limits**, and forbids external fetch. No fixtures, domain writes, provider calls, jobs, normal/deployed access or index/schema mutation occurred. The pool closed and the clone was released before packaging.

## Complete task response acceptance

The actual retained corpus contains **25,891 terminal actions**,9 connections across3 instances,2,054 null connections/null generations, and **zero active/pending/running/failed, dangling-connection or obsolete-generation actions**. All9 connections have terminal history. Both reads return the exact ordered **23 terminal ID/scope tuples**, including4 null scopes. The unchanged active query returns an empty tuple/count list; this is an empty positive-cohort gap, not proof of busy queue behavior.

The probe compiles the exact current read functions and canonical eligibility/scope/generation helpers, replacing only the candidate terminal tagged template. It first compares the extracted baseline with the actual exported `listTaskActions` on the same real administrator and transaction. It then compares baseline/candidate complete ordered active tuples, complete ordered terminal tuples, and **all hydrated DTO fields, taskCount and final order**. All match. Actual IDs, scope values, labels and payloads stay in memory; only aggregate hashes are public. No sorting, field omission or selected DTO comparison hides changes.

The canonical failed-row dual participation and differing active/terminal tie rules remain untouched. There is no actual positive failed count/dual-representative, deliberate timestamp+UUID tie, malformed/empty raw-scope, unknown-kind or obsolete-generation schedule in this proof. Source reasoning and existing authored tests remain distinct from this actual-data acceptance.

## Current-index work

| Single isolated plan metric | Canonical Q0/I0 | Q1/I0 |
| --- | ---: | ---: |
| Final representatives |23|23|
| Query-root shared hits |670|3,861|
| Shared reads |0|0|
| Temporary blocks read/written |0/0|0/0|
| History scan returned rows, approximate sum |25,891|49,732|
| Sort output rows, approximate sum |25,891|25,928|
| Largest reported individual sort space |3,023KiB|635KiB|
| EXPLAIN execution |29.976ms|21.756ms|

Canonical Q0 reads the history table once, joins9 connections and sorts25,891 rows. Q1 does9 bitmap-heap passes through `outbox_maintenance_idx`, sorting each connection's history and producing33 connected representatives. Its null branch produces7 representatives. The final merge consumes40 representatives and emits23. The skinny orphan anti-join still sequentially reads23,837 non-null history rows plus2,054 filtered null rows to discover **zero** orphan IDs; it contributes670 additional query-root hits. Null fallback adds another bitmap heap pass. The existing index can admit connection/kind/state, but cannot stream the required kind/updated_at/UUID order through its intervening state column.

**The lower single execution time does not justify adoption.** Shared hits increase almost5.8×, and sort partitioning does not eliminate history scans. The probe's buffer-work admission rejects repeated timing samples. No latency distribution, CPU, peak RSS or busy/deployed behavior is claimed. The older deployed105,079-row/spill receipt remains historical evidence.

Numeric interpretation matters: root buffers include descendants and must not be summed again. Per-loop EXPLAIN rows are rounded averages, so row×loop sums are approximate. The unchanged raw receipt's `sortSpaceUsedKiB` field multiplies each reported Sort Space Used by its loop count (3,023/6,031); that product is **not measured cumulative allocation, simultaneous or peak memory**. It does not establish doubled memory. Individual reported sort maxima are3,023/635KiB. The zero Heap Fetches sum reflects no index-only nodes, not zero heap access. All expression/output/filter/index-condition/sort-key text is omitted from public plans; structural fields and metrics remain.

## Narrow follow-up under the real schema

Source-only Q1b would omit the orphan CTE and its second fallback UNION branch, preserving all null-connection fallback history, current-generation rules, raw scope and final total order. `schema.ts:682` and original migration `0000:428` define a nullable validated connection FK with **ON DELETE SET NULL**, with no deferrable clause. Current runtime callers are only the Settings Jobs loader and queue/tasks GET; neither supplies a self-authored mutation transaction. Searches found no application FK-disable/defer/replacement path. Concurrent committed deletes either remain visible in the read snapshot or expose the row with connection_id already null.

A new trial must first verify actual `convalidated`, `condeferrable`, `condeferred`, FK actions and enabled RI enforcement, and fail closed on drift. This is a conditional source-backed option, **not executed or measured gain**. Q1's raw result stays immutable. The I1 ordering/coverage index remains a separate generated-secondary-clone experiment with permanent-history storage and write-maintenance costs; it was not built here. No retention/read-model choice is inferred.

[Machine report and artifact/source pins](task-history-q1-current-index.json) retain the boundaries. Root owns shared finding status and any next adoption decision.
