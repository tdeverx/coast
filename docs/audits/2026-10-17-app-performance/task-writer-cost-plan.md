# Tasks writer and index costs — next bounded experiment

This is a **reviewable plan, not an executed test**. No new database connection, copy, update, index, provider or scheduling call was made for its preparation or publication. No Tasks query or index is adopted. The [exact protocol](candidates/task-writer-cost-plan/protocol.md), [machine-readable plan](candidates/task-writer-cost-plan/verification-plan.json) and [source manifest](candidates/task-writer-cost-plan/source-pins.json) retain the proposed boundaries. Publication checks all34 current source pins and11 earlier artifact pins; identity checks do not establish runtime behavior. At this planning checkpoint no runnable writer probe existed. The later [matched-copy execution](task-writer-cost-actual.md) now passes its scoped contracts and retains extra write work plus WAL-byte and natural-cohort gaps.

## What the actual read experiments establish

The [paired query/index experiment](task-history-index-matrix.md) preserved complete actual outputs and observed root shared-buffer visits670→544 with Q1b plus I1. Q1b on current indexes regressed670→3,191; index alone did not improve the current query. The [other timing readers](task-timing-index-consumers.md) preserved actual outputs and observed5,323→2,496 visits overall, with an adverse local payload-instance branch1,492→1,520. The extra index occupied2,433,024bytes on that25,891-row snapshot. Those are historical measurements; this plan adds no fresh census, execution or throughput result.

Natural pending/running/failed jobs were absent in that snapshot. Turning a saved terminal job into an active job would conceal that coverage gap. The next small experiment therefore uses saved terminal identities and an explicitly authored recency update, with its limits retained.

## Proposed W0 experiment

Create one fresh matched pair of disposable copies of the existing actual-data clone. Leave all seven current indexes in I0; add only the exact candidate terminal index in I1. Verify complete logical rows, sequences and checked schema before and after, set and verify each reserved backend's settings, and reject unknown clients or metadata. Generated targets must never overwrite an existing database. A runnable, reviewed, hash-pinned probe, capacity preflight and exclusive test lease remain prerequisites; the prepared document itself does not execute or grant a new operation.

Select at most eight existing succeeded/cancelled rows using actual NULL/non-NULL connection classes and observed payload-size extremes. Missing classes remain gaps. In each copy, execute the same single update per identity, changing only updated_at by one PostgreSQL microsecond with exact saved-state and server-timestamp guards. Compare complete expected rows and cross-layout equality, statement root buffers/WAL records/full-page images/bytes, and current-transaction table statistics. All writer transactions roll back; verify full logical restoration, close pools, drop only exact generated targets and recheck the original clone.

A changed updated_at already touches current indexes. W0 therefore measures incremental terminal-key maintenance; it cannot demonstrate HOT loss introduced by I1 or natural heartbeat/transition throughput. PostgreSQL's HOT conditions depend on indexed attributes and page space. See the [PostgreSQL17 HOT contract](https://www.postgresql.org/docs/17/storage-hot.html). An optional separate value-preserving locked_at control would require a new fresh matched pair and its own reviewed schedule; it is not part of W0.

The [EXPLAIN contract](https://www.postgresql.org/docs/17/sql-explain.html) confirms that ANALYZE executes DML and that root buffer counters include descendants. Measure each statement once; do not issue the update again to obtain output. WAL figures are statement observations. They exclude transaction commit/abort, copy and index-build attribution; logical rollback also does not undo physical WAL, cache or dead tuples. No cluster-wide LSN difference can establish this writer's cost while normal development may also write. Copy/checkpoint and [statistics](https://www.postgresql.org/docs/17/monitoring-stats.html) controls remain explicit in the protocol. [CREATE DATABASE semantics](https://www.postgresql.org/docs/17/sql-createdatabase.html) also require checking source sessions and database settings for each target.

## Remaining shared consumers and adoption decision

| Consumer | Next proof | Gap W0 retains |
| --- | --- | --- |
| Queue enqueue/claim/heartbeat/yield/checkpoint | Current index predicates and actual active-state owner schedules | No natural positive active cohort; no insert or heartbeat throughput |
| Succeed/fail/cancel/retry | Terminal membership changes, full rows and ordered side effects | W0 only rekeys existing terminal rows; no natural state transition or committed writer cost |
| Maintenance/recommendation/bootstrap/Jellyfin readers | Exact source SELECT fragments and bindings; full ordered results or multisets on both layouts | No scheduling/provider owner invocation; absent failed/active/tie classes remain absent |
| Account generation/disconnect/delete | FK, trigger, generation and wider account effects | No account/provider deletion or reset in W0 |
| Rollout and growth | Build lock, disk budget, production-sized history and read/write frequency | Small-snapshot plans do not decide deployed capacity or adoption |

A successful W0 would narrow the extra terminal-rekey cost and remaining-reader questions. It would not justify applying Q1b alone, I1 alone, or closing the missing natural writer/resource cohorts. The coordinated query/index change remains unadopted. The separate Library range choice does not gate preparing this runner; no additional user approval is inferred merely from this planning document.
