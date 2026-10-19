# Tasks index writer cost — actual matched-copy proof

The bounded W0 experiment passes its logical, reader and cleanup contracts. It also exposes extra observed write work for I1: **eight matched terminal recency updates use208→232 root shared-buffer visits and61→69 WAL records**. Every matched update adds three visits and one record. Lower WAL bytes are confounded by full-page images and are not accepted as an efficiency gain. No Tasks query or index is adopted.

The [immutable actual receipt](evidence/task-writer-cost-actual.json), [separate interpretation](evidence/task-writer-cost-interpretation.json), [frozen execution plan](candidates/task-writer-cost-actual/execution-plan.json), [writer](candidates/task-writer-cost-actual/writer.ts), [shared helpers](candidates/task-writer-cost-actual/helpers.ts) and [source-derived readers](candidates/task-writer-cost-actual/readers.ts) bind this result. The [earlier plan](task-writer-cost-plan.md) remains a preparation checkpoint; this is the separate execution it proposed. Root reviewed the confinement, guards, triggers, bindings and cleanup; no new independent peer execution is claimed.

## Actual scope and restoration

Fresh census confirms25,891 terminal rows:24,888 succeeded and1,003 cancelled, with2,054 NULL connections. Pending, running and failed cohorts remain absent. The probe creates one fresh I0/I1 TEMPLATE pair with WAL_LOG using only the designated private actual-data clone. Both copies match all102 table logical row-multiset digests,1,864,145 rows, sequences and checked schema, plus literal complete outbox rows and initial heap geometry. The original pool closes before copy creation. A private exclusive parent lock coordinates the run; observed client absence is not atomic exclusion against unknown future clients.

I0 retains all seven indexes. I1 commits only the exact candidate2,433,024-byte terminal index in its disposable copy. For each layout, eight distinct saved rows cover succeeded/cancelled, NULL/non-NULL connection and actual payload-size extremes5–1,291bytes. The authored update changes only updated_at by one PostgreSQL microsecond. Guards bind each saved UUID, state and exact server timestamp; no timestamp passes through JavaScript Date rounding. No active job, payload or missing cohort is fabricated.

Each EXPLAIN ANALYZE executes its update exactly once. A separate full-row check verifies the expected microsecond change; literal complete25,891-row outbox comparison verifies only those eight recencies differ. Other table values, sequences and checked schema remain unchanged during the schedule. Writers roll back, then complete logical restoration is checked on the same backend. Both generated databases are dropped and catalog absence verified. A fresh original-clone read confirms all102 table multisets, sequences and checked schema match the initial snapshot. All pools/reservations close, the parent exits0, the lock is available afterward, all38 source pins and frozen private inputs match, and the577-file application inventory is unchanged. No provider fetch/preconnect or credential-key creation occurs. Existing approved credentials stay in memory; none are saved or displayed.

The checked catalogue includes recorded relations, columns/defaults, indexes, constraints, triggers, function definitions/execution properties, policies and enums; it is not every cluster role, extension, privilege or server setting. Logical rollback does not reverse WAL, cache, physical tuple or statistics effects.

## Observed writer resource cost

These totals sum each of eight independent statement roots once. They exclude capture, verification, copying, index build and transaction commit/abort work. Repeated visits or dirties across statements are not unique physical blocks.

| Counter | I0 | I1 | Interpretation |
| --- | ---: | ---: | --- |
| Shared hit + read visits |208|232|+3 on every matched update |
| Shared dirtied blocks |50|56|Descriptive sum of statement counters |
| Shared written blocks |1|1|Does not establish total physical I/O |
| WAL records |61|69|+1 on every matched update |
| WAL full-page images |46|0|Confounds the byte comparison |
| WAL bytes |351,727|10,203|No causal byte saving or overhead percentage admitted |
| Updates / inserts / deletes |8 /0 /0|8 /0 /0|One guarded update per saved identity |
| HOT / new-page updates |0 /8|0 /8|No introduced HOT loss established |

updated_at is already indexed under I0. A changed indexed attribute makes this schedule unsuitable for measuring a new HOT restriction; the observed zero HOT count in both layouts is not a heartbeat result. See the [PostgreSQL17 HOT conditions](https://www.postgresql.org/docs/17/storage-hot.html). Natural enqueue/claim/finish/cancel/retry/checkpoint owners, their side effects, commits and throughput are not invoked.

The fixed I0→I1 phase order, cache/visibility, copy/index-build effects and full-page-image mismatch prevent a clean causal WAL-byte conclusion. No forced checkpoint, global LSN subtraction, index-drop, ANALYZE, VACUUM or fillfactor change is used. Index-build client elapsed25.44ms is an operational observation excluded from writer WAL and is not a deployed build-duration prediction. Statement WAL and inclusive-root semantics follow the [EXPLAIN contract](https://www.postgresql.org/docs/17/sql-explain.html).

The immutable receipt's field checkpointCountersStableWithinEachWriterWindow means **equal observed endpoint values only**. stats_fetch_consistency was not captured or changed, and cached cumulative statistics were not explicitly cleared. Therefore no checkpoint-free or autovacuum-free interval is established. The [statistics contract](https://www.postgresql.org/docs/17/monitoring-stats.html) permits cached cumulative values; current-transaction pg_stat_xact_user_tables counters update separately. A future causal study must verify refreshed cumulative observations and still disclose publication lag and FPI/cache/layout effects. This receipt is not retroactively upgraded.

## Remaining reader verification

Six SQL templates are extracted directly through the TypeScript AST, plus the exact bootstrap priority expression in an explicitly authored bounded SELECT wrapper. No enclosing scheduler, queue claimant or provider owner runs. Nine saved connections and four instances derive13 labeled reads across seven families. They represent **11 distinct SQL-and-binding inputs**: three saved bootstrap rows share one identical request. Duplicate labels are not advertised as unique inputs.

All13 full results match between I0/I1 before writes and again after authored recency changes:26 paired labels across the two data states. Unordered SQL uses complete multisets; defined ordering is retained. JSON projection preserves timestamp precision. Post-write results are cross-layout sensitivity checks and need not equal pre-write values. Eight SELECT plan pairs have identical observed root counters; they show no extra read gain from I1 in these remaining families.

| Family | Actual retained coverage | Limits |
| --- | --- | --- |
| Maintenance |189 complete rows from9 connections ×21 canonical kinds; generation-split success, active and policy expressions retained |No natural busy job |
| Global recommendation maxima |Two saved instance/kind reads |NULL/absent values stay absent; no provider request |
| Connected Trakt recommendations |Existing source query returns0 rows |No positive connected recommendation account proof |
| Bootstrap initial/checkpoint |Six saved terminal-row inputs; complete scalar results |Some duplicate bindings; no claimed active/bootstrap transition |
| Jellyfin outstanding |Sixteen saved terminal IDs, result0 |Authored baseline selection, not persisted active companion state |
| Jellyfin failed |Saved actual instance, result0 |No failed-positive cohort |
| Bootstrap priority expression |Six saved terminal IDs in source expression wrapper |Not natural claim/priority scheduling acceptance |

Earlier [Tasks matrix gains](task-history-index-matrix.md) and [timing-reader gains/adverse branch](task-timing-index-consumers.md) remain separately measured; this run neither repeats nor replaces them. Q1b alone remains a rejected regression, and I1 alone does not help the current Tasks query.

## Failed admission and future drift

Both failed read-only admissions remain retained. The [first receipt](candidates/task-writer-cost-actual/reader-admission-first/reader-admission-actual.json) lacked the failing-case classification. The [diagnostic](candidates/task-writer-cost-actual/reader-admission-diagnostic/reader-admission-diagnostic.json) identifies SQLSTATE22P02 in the authored bootstrap-priority wrapper. Its JavaScript-array/ANY binding is replaced by individually typed UUID placeholders with the same saved identities and unchanged source expression. The [corrected actual admission](candidates/task-writer-cost-actual/reader-admission-corrected.json) passes all13 labeled reads before any copies or DML. Original failed bytes and dependency snapshots remain unchanged. The first strict type check's sole key-index annotation error and final clean strict check are also retained.

Future source, schema, trigger, function, binding or target drift must stop admission. Do not replace expected hashes alone or treat this source-pinned private harness as a general rollout command. Its absolute paths are review artifacts; reproduction requires restoring the reviewed execution inputs in an isolated approved runtime. The [maintenance guide](maintenance.md) records these obligations.

## Path forward

Keep the current query/index layout until a coordinated decision. This run narrows terminal-rekey and remaining-reader evidence, while retaining an observed extra write cost. Required acceptance still includes natural active/failed writers and leases, commits and side-effect order, positive connected/failed readers, future taste-outcome ties, visibility and realistic history growth, disk/build-lock policy and coordinated query/index rollout. H0 was not run. If causal WAL bytes would change that decision, prepare a new reviewed matched-copy protocol with refreshed statistics and explicit FPI controls; do not rerun or relax this experiment merely to obtain a cleaner-looking number.
