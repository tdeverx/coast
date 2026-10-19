# PJ-10 Q1b: valid foreign-key simplification, still rejected on current indexes

**No adoption.** Q1b legitimately removes the impossible orphan scan under the current enforced schema, and returns the exact task response. It still increases shared-buffer work on the actual corpus. No application query, index, schema, retention, dependency or provider behavior changed. The [Q1 receipt](evidence/task-history-q1-current-index-actual.json) and both earlier negative options remain immutable; none was repeated here.

## Why the orphan branch can be omitted

The [current nullable connection FK](/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/db/schema.ts:682), introduced at [migration 0000:428](/Users/admin/Documents/ChatGPT/coast-new/drizzle/0000_curly_millenium_guard.sql:428), references `provider_connections.id` with **ON DELETE SET NULL / ON UPDATE NO ACTION**, without deferred enforcement. Runtime `listTaskActions` callers are only the [Settings Jobs loader](/Users/admin/Documents/ChatGPT/coast-new/src/routes/settings/[[section]]/+page.server.ts:93) and [queue/tasks GET](/Users/admin/Documents/ChatGPT/coast-new/src/lib/server/api/queue.server.ts:10). Neither reader runs inside a caller-authored mutation transaction, and the owner accepts no transaction. Source searches found no application constraint-disable/defer/drop or replication-bypass path; SQL triggers do not call this JS reader.

The [actual preflight](evidence/task-history-q1b-current-index-actual.json) verifies the exact source/reference relation and columns, validated/nondeferrable/not-initially-deferred FK, MATCH SIMPLE, SET NULL/delete and NO ACTION/update. All four expected internal RI triggers are enabled for ordinary origin sessions and immediate; the actual session is `origin`. There are zero dangling rows. A committed read snapshot therefore cannot contain a non-null connection reference without that connection: a concurrent deletion is either not visible yet, or its SET NULL effects are visible atomically. No support for schema-invalid administrative states is needed.

The [exact candidate](candidates/task-history-next/query-q1b.sql) removes **only** Q1's `orphan_ids` CTE and second fallback UNION branch, plus its descriptive comment. The connected per-kind pass, null-connection fallback, canonical four-kind raw-text/null scope expression, generation eligibility, final kind/scope/updated_at/UUID total order, active query and hydration remain. The [probe](probes/task-history-q1b-current-index.ts) fails closed on FK/RI/session drift before executing Q1b. This guarantee is specific to current enforced schema and callers; external constraint disabling, replication bypass, a deferred FK or a new self-authored mutation caller would need a new review.

## Complete actual response, then work admission

One source-pinned, repeatable-read **READ ONLY** physical transaction verifies **10s statement /1s lock limits**, 4MiB work_mem and jit off. It compares the extracted canonical baseline with the actual exported `listTaskActions`, then compares complete ordered terminal ID/scope tuples, unchanged active ID/count/scope tuples, and every hydrated DTO field/taskCount/final order against Q1b. All pass: **23 task DTOs /23 terminal representatives /4 null scopes**. The actual corpus has **25,891 terminal actions**,9 connections,3 instances,2,054 null connections/null generations, and zero pending/running/failed, obsolete-generation or dangling actions.

Active/count acceptance is consequently empty. No busy failed dual-representative/count, deliberate timestamp/UUID tie, unknown-kind, malformed/empty scope or obsolete-generation positive schedule is claimed. Exact source expressions/order remain intact, but that is separate from positive actual coverage. No authored catalogue or fixture was added.

| Single isolated plan metric | Canonical Q0/I0 | Q1b/I0 |
| --- | ---: | ---: |
| Final representatives |23|23|
| Query-root shared hits |670|3,191|
| Shared reads |0|0|
| Temporary blocks read/written |0/0|0/0|
| History scan returned rows, approximate sum |25,891|25,895|
| Sort output rows, approximate sum |25,891|25,928|
| Largest reported individual sort space |3,023KiB|635KiB|
| EXPLAIN execution |30.157ms|18.318ms|

Omitting orphan admission removes the full-history zero-result anti-join. The remaining9 per-connection bitmap heap scans still revisit shared history pages and sort each connection's rows; the null fallback adds another bitmap pass. Existing `outbox_maintenance_idx` admits the partition but its intervening state column does not stream the desired kind/recency/UUID order. The final merge still produces23 winners from40 connected/fallback representatives. **Almost4.8× shared hits is enough to reject Q1b/I0**, despite the lower single execution. The buffer-work gate skips repeated timings. No CPU/RSS, deployed load, latency distribution, index-only or concurrency benefit is claimed.

Root buffers already include children. Per-loop EXPLAIN rows are rounded averages, so row×loop totals are approximate. The immutable raw receipt's `sortSpaceUsedKiB` field is a loop-weighted product (3,023/6,031), **not measured cumulative allocation, simultaneous or peak memory**; it establishes no doubled memory claim. Zero Heap Fetches reflects absence of index-only nodes, not absence of heap access. Public plans retain structural/numeric fields and omit all expression/filter/output/index-condition/sort-key text. Actual identity, scope, label and payload rows stay only in RAM; opaque complete-output digests remain public.

The transaction/pool closed and the clone was released directly to the next approved proof. There were zero external fetch attempts, writes, jobs, normal/deployed accesses or source changes. No I1 index was built. The [existing secondary-clone index option](next-task-history-plan.md#targeted-index-i1-only-on-a-disposable-secondary-clone) remains separately reviewable with exact current-query control, ordering/coverage proof and permanent-history storage/write-maintenance tradeoffs. Current-index rejection does not predict that option's gain or authorize production DDL.

[Machine report, source/artifact pins and limits](task-history-q1b-current-index.json). PJ-10 remains open; root owns shared status and any later adoption decision.
