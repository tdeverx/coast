# Four additional Taste query options rejected on actual data

The shared Taste EXISTS repair from [batch17](implementation-found-17.md) remains applied. This pass tests four further shapes against that exact current owner, preserving all sixteen before/after owner comparisons across the same four actual accounts, complete input/profile evidence, ordered candidates and every computed score. These are four schedules on one population, not sixteen independent user cohorts. All tests use repeatable-read READ ONLY, bounded statements/locks, zero external fetches and checked rollback/pool/module cleanup. No runtime patch, schema/index, normal job, provider operation, queue/index pair or policy is changed. [Machine summary](candidates/taste-query-options/summary.json).

Each option preserves all candidate IDs/order and scores, but all four owners have higher three-pair alternating warm medians. The grouped-array option reduces root buffers slightly while slowing; the other three increase buffers. Every individual sample/plan remains retained. The rejected alternatives use no fabricated catalogue, features, jobs or provider pages.

## Grouped arrays — rejected

| Actual owner | Root shared hit+read visits | Alternating warm median ms | Candidate temp read/write blocks |
| --- | --- | --- | --- |
| 0 | 9,822 → 9,762 | 98.45 → 103.38 | 0/0 |
| 1 | 9,867 → 9,703 | 137.11 → 138.63 | 0/0 |
| 2 | 10,062 → 9,922 | 146.95 → 189.99 | 0/0 |
| 3 | 10,130 → 10,018 | 136.94 → 149.41 | 0/0 |

[Full actual receipt](candidates/taste-grouped-probes/actual.json), [exact candidate](candidates/taste-grouped-probes/taste.candidate.ts.txt), [probe](probes/taste-grouped-probes-real.ts).

## Early distinct hits — rejected

| Actual owner | Root shared hit+read visits | Alternating warm median ms | Candidate temp read/write blocks |
| --- | --- | --- | --- |
| 0 | 9,822 → 21,629 | 108.99 → 232.23 | 0/0 |
| 1 | 9,867 → 21,797 | 108.41 → 231.50 | 0/0 |
| 2 | 10,019 → 22,342 | 107.05 → 222.77 | 0/0 |
| 3 | 10,130 → 22,593 | 98.89 → 204.83 | 0/0 |

[Full actual receipt](candidates/taste-feature-hits/actual.json), [exact candidate](candidates/taste-feature-hits/taste.candidate.ts.txt), [probe](probes/taste-feature-hits-real.ts).

## Planner-fenced lateral — rejected

| Actual owner | Root shared hit+read visits | Alternating warm median ms | Candidate temp read/write blocks |
| --- | --- | --- | --- |
| 0 | 9,779 → 104,634 | 98.34 → 489.87 | 466/466 |
| 1 | 9,867 → 105,972 | 128.45 → 575.50 | 465/465 |
| 2 | 10,062 → 108,857 | 98.86 → 504.22 | 465/465 |
| 3 | 10,130 → 110,278 | 106.49 → 498.26 | 464/464 |

[Full actual receipt](candidates/taste-indexed-feature-probes/actual.json), [exact candidate](candidates/taste-indexed-feature-probes/taste.candidate.ts.txt), [probe](probes/taste-indexed-feature-probes-real.ts).

## Bound coarse filter — rejected

| Actual owner | Root shared hit+read visits | Alternating warm median ms | Candidate temp read/write blocks |
| --- | --- | --- | --- |
| 0 | 9,822 → 21,726 | 95.13 → 207.59 | 0/0 |
| 1 | 9,867 → 21,766 | 111.19 → 232.22 | 0/0 |
| 2 | 10,062 → 22,375 | 107.18 → 240.26 | 0/0 |
| 3 | 10,130 → 22,550 | 108.01 → 226.13 | 0/0 |

[Full actual receipt](candidates/taste-bound-feature-filter/actual.json), [exact candidate](candidates/taste-bound-feature-filter/taste.candidate.ts.txt), [probe](probes/taste-bound-feature-filter-real.ts).

## Why the apparent shortcuts lost

Grouping probes by medium and matching `@> ANY(array_agg(...))` retains correct membership but does not select the existing GIN path in these plans. Its JSON containment work remains expensive; lower root buffer visits alone do not justify adoption when all four warm medians regress.

Early DISTINCT(work_id,medium) preserves witness membership before the works join, but the actual plan evaluates the probe recordset repeatedly. One retained owner 0 plan records 5,993 Function Scan loops; it does not establish a missing index or prove that earlier DISTINCT always helps. Candidate root buffers approximately double, as do warm medians.

A lateral per-probe read with OFFSET 0 is tested only as an explicit planner fence. It still chooses scans rather than the GIN index, multiplies work and spills 464–466 temporary read/write blocks. It is roughly 4.5–5.1 times slower in the repeated warm medians, with about 10–11 times the root read-buffer visits. No global planner setting is changed and this extra planner dependency is not adopted.

The bound coarse JSONB-array predicate retains the original exact medium-aware EXISTS, so no cross-medium witness is admitted. The complete comparisons verify Bun native/bound replay and preserve every original bound value while adding that one parameter. It also chooses scans, more than doubles buffers and roughly doubles warm medians. Redundant coarse filters can add work or change join choice even when logically safe.

The two latter receipts independently read the live feature indexes: `work_features_lookup_idx` is present, valid and ready, occupying 12,935,168 bytes in this clone; the current schema is not missing this index. Those metadata flags do not validate every physical index page or prove a useful index lookup. None of the candidate plans uses it. Do not prescribe another index, change planner knobs, clear caches, ANALYZE a normal installation or claim corruption from this evidence alone.

## Decision and next work

Keep batch17. The remaining opportunity needs a separately justified access/data-shape design or planner/statistics investigation, while preserving the same provider/feature/genre precedence and ranking cap. A future index/query option must include exact read plans plus write, storage, maintenance and concurrency costs; a parameterized or materialized rewrite must include its bound-value/custom/generic-plan behavior. The broad media/metadata scan, worker publication/leases/restart, concurrent revisions, missing natural book/policy/provider/growth cohorts and CPU/heap/tails remain partial.

[performance.md](../../performance.md#require-an-observed-access-path) records the general rule. Runtime source remains byte-identical to batch17, so its 844 common passes/type/build/inventory/style gates still describe the unchanged application; they are not rerun solely for extra audit artifacts. These four actual-data probes are new evidence, not four new application fixes or a completed worker run. The source/report integrity checker is rerun after documenting this pass. Known counts remain 22 open / 38 partial; unchecked areas are deferred. No commit, push, PR or deployment.
