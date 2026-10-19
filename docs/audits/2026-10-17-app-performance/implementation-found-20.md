# Taste index and parallel-work investigation — no additional adoption

This completes the previously running investigation of the known shared Taste read bottleneck. Both schedules use separately tagged disposable TEMPLATE copies of the actual retained catalogue. Each covers four actual owners across six index/statistics states. No normal or parent index is rebuilt, cleaned or analyzed. Neither candidate is adopted. The [planner-fence receipt](candidates/taste-index-matrix/six-phase-actual.json) and [materialization receipt](candidates/taste-materialized-features/six-phase-actual.json) retain all complete inputs, candidate/score comparisons, plans and alternating samples. These are repeated tests of the same four accounts, not 48 independent user cohorts.

Both copies preserve all 102 tables / 1,864,145 rows, with before/after aggregate row fingerprint `9428397f6ad5bb35ab00dc685720984797592bea078e3e13300acf5dab9a07c7`. Exact run-marker cleanup confirms both disposable databases were dropped and absent, and private runtime files removed. No authored catalogue, provider call or worker publication is used.

## Findings and decision

The existing valid default GIN is sensitive to its physical state. In these copied observations the fenced query does not use it before pending-list cleanup, uses it after cleanup but remains slower, and becomes faster after rebuild. This is not sufficient evidence to prescribe normal maintenance or an index change. Index sizes are 12,935,168 bytes inherited, 10,788,864 fresh default, and 8,708,096 fresh path-ops. No write/WAL or concurrent-maintenance cost is measured. The [read-only normal metadata census](candidates/taste-index-matrix/normal-index-metadata-readonly.json) finds the same 5,993 logical feature rows but a different 8,945,664-byte GIN; copied physical costs must not be presented as direct normal measurements.

The current query can also repeat the full feature/works branch inside each outer parallel worker after a plan change. Retained post-rebuild plans show non-parallel-aware child scans of 5,993 feature rows and 147,946 works with two loops. Earlier parallel-aware scans divide the rows across workers instead; those are not two independent full scans. Owning `feature_ids AS MATERIALIZED` removes that duplicated child work in tested rebuilt-index plans: root visits fall from roughly 13,000–13,600 to 9,700–10,000 with no observed spill. It leaves inherited-index buffers equal, and timings remain mixed across schedules. Keep the exact one-keyword option unapplied; generic/custom-plan acceptance is not complete. No whole-worker, CPU, heap, cold-I/O or production-tail benefit is established.

Two initial guard failures are retained in [first failure](candidates/taste-index-matrix/failed-cross-phase-first.json) and [diagnosis](candidates/taste-index-matrix/cross-phase-order-diagnosis.json). They exposed a separate shared-input bug: identical interest rows return in different orders across phases. Full unordered fields/membership, profiles, candidates and pure scores remain equal in these Taste outcomes. The final receipts explicitly preserve this ordering discrepancy rather than claiming a stable input order. The shared interest owner's final sort is handled separately; these tests do not prove that other consumers' first-100 or provider-priority selections are stable.

PostgreSQL documents [GIN pending-list tradeoffs](https://www.postgresql.org/docs/17/gin.html) and [JSONB operator-class tradeoffs](https://www.postgresql.org/docs/17/datatype-json.html#JSON-INDEXING). These explain why index presence/size alone cannot establish the best read/write design. No new normal maintenance action follows from this experiment.

## Complete observations

Each timing is the median of three alternating warm pairs. Sequential phase order, cache state, auto prepared-plan behavior and parallel-worker scheduling limit causal attribution. Keep individual adverse samples. A candidate can reduce reads while leaving elapsed time unchanged or worse.

| Option | Copied physical state | Actual owner | Root shared hit+read visits | Warm median ms | Candidate temp read/write blocks |
| --- | --- | --- | --- | --- | --- |
| Planner fence | inherited_default_index | 0 | 9,779 → 104,634 | 94.34 → 495.24 | 466/466 |
| Planner fence | inherited_default_index | 1 | 9,867 → 105,972 | 108.23 → 462.83 | 465/465 |
| Planner fence | inherited_default_index | 2 | 10,062 → 108,857 | 106.55 → 566.03 | 465/465 |
| Planner fence | inherited_default_index | 3 | 10,130 → 110,278 | 107.06 → 536.45 | 464/464 |
| Planner fence | pending_cleaned_default_index | 0 | 9,822 → 11,989 | 86.09 → 513.45 | 466/466 |
| Planner fence | pending_cleaned_default_index | 1 | 9,867 → 11,776 | 108.30 → 544.33 | 465/465 |
| Planner fence | pending_cleaned_default_index | 2 | 10,062 → 12,011 | 105.41 → 556.88 | 465/465 |
| Planner fence | pending_cleaned_default_index | 3 | 10,130 → 11,781 | 100.10 → 466.46 | 464/464 |
| Planner fence | fresh_default_index | 0 | 13,541 → 11,339 | 278.65 → 108.84 | 466/466 |
| Planner fence | fresh_default_index | 1 | 13,633 → 11,240 | 220.78 → 64.69 | 465/465 |
| Planner fence | fresh_default_index | 2 | 13,083 → 11,522 | 175.10 → 49.58 | 465/465 |
| Planner fence | fresh_default_index | 3 | 13,581 → 11,314 | 205.68 → 51.33 | 464/464 |
| Planner fence | fresh_path_ops_index | 0 | 13,541 → 10,723 | 165.63 → 56.94 | 466/466 |
| Planner fence | fresh_path_ops_index | 1 | 13,633 → 10,573 | 197.58 → 65.82 | 465/465 |
| Planner fence | fresh_path_ops_index | 2 | 13,083 → 10,870 | 192.77 → 53.97 | 465/465 |
| Planner fence | fresh_path_ops_index | 3 | 13,581 → 10,650 | 199.49 → 68.67 | 464/464 |
| Planner fence | path_ops_after_analyze | 0 | 13,541 → 10,723 | 172.38 → 59.22 | 466/466 |
| Planner fence | path_ops_after_analyze | 1 | 13,633 → 10,573 | 177.86 → 48.72 | 465/465 |
| Planner fence | path_ops_after_analyze | 2 | 13,084 → 10,870 | 173.64 → 43.68 | 465/465 |
| Planner fence | path_ops_after_analyze | 3 | 13,581 → 10,650 | 217.56 → 72.76 | 464/464 |
| Planner fence | fresh_default_after_same_analyze | 0 | 13,541 → 11,339 | 147.41 → 56.35 | 466/466 |
| Planner fence | fresh_default_after_same_analyze | 1 | 13,633 → 11,240 | 182.02 → 59.04 | 465/465 |
| Planner fence | fresh_default_after_same_analyze | 2 | 13,083 → 11,522 | 175.70 → 51.43 | 465/465 |
| Planner fence | fresh_default_after_same_analyze | 3 | 13,581 → 11,314 | 172.09 → 53.63 | 464/464 |
| Materialized hits | inherited_default_index | 0 | 9,822 → 9,822 | 89.21 → 90.27 | 0/0 |
| Materialized hits | inherited_default_index | 1 | 9,867 → 9,867 | 110.95 → 108.95 | 0/0 |
| Materialized hits | inherited_default_index | 2 | 10,062 → 10,062 | 100.72 → 102.31 | 0/0 |
| Materialized hits | inherited_default_index | 3 | 10,130 → 10,130 | 119.10 → 123.75 | 0/0 |
| Materialized hits | pending_cleaned_default_index | 0 | 9,822 → 9,822 | 108.19 → 105.41 | 0/0 |
| Materialized hits | pending_cleaned_default_index | 1 | 9,867 → 9,867 | 125.84 → 118.35 | 0/0 |
| Materialized hits | pending_cleaned_default_index | 2 | 10,019 → 10,062 | 121.17 → 124.19 | 0/0 |
| Materialized hits | pending_cleaned_default_index | 3 | 10,130 → 10,087 | 151.60 → 126.83 | 0/0 |
| Materialized hits | fresh_default_index | 0 | 13,541 → 9,692 | 150.08 → 149.70 | 0/0 |
| Materialized hits | fresh_default_index | 1 | 13,633 → 9,737 | 182.74 → 181.19 | 0/0 |
| Materialized hits | fresh_default_index | 2 | 13,083 → 9,932 | 184.35 → 178.86 | 0/0 |
| Materialized hits | fresh_default_index | 3 | 13,581 → 10,000 | 178.67 → 177.31 | 0/0 |
| Materialized hits | fresh_path_ops_index | 0 | 13,541 → 9,692 | 146.20 → 144.30 | 0/0 |
| Materialized hits | fresh_path_ops_index | 1 | 13,633 → 9,737 | 187.19 → 180.71 | 0/0 |
| Materialized hits | fresh_path_ops_index | 2 | 13,083 → 9,932 | 179.98 → 177.46 | 0/0 |
| Materialized hits | fresh_path_ops_index | 3 | 13,581 → 10,000 | 178.50 → 184.77 | 0/0 |
| Materialized hits | path_ops_after_analyze | 0 | 13,541 → 9,692 | 148.21 → 147.21 | 0/0 |
| Materialized hits | path_ops_after_analyze | 1 | 13,633 → 9,737 | 175.66 → 177.08 | 0/0 |
| Materialized hits | path_ops_after_analyze | 2 | 13,083 → 9,932 | 178.61 → 178.23 | 0/0 |
| Materialized hits | path_ops_after_analyze | 3 | 13,581 → 10,000 | 180.86 → 178.11 | 0/0 |
| Materialized hits | fresh_default_after_same_analyze | 0 | 13,541 → 9,692 | 178.16 → 148.12 | 0/0 |
| Materialized hits | fresh_default_after_same_analyze | 1 | 13,633 → 9,737 | 206.39 → 214.33 | 0/0 |
| Materialized hits | fresh_default_after_same_analyze | 2 | 13,083 → 9,932 | 205.04 → 187.02 | 0/0 |
| Materialized hits | fresh_default_after_same_analyze | 3 | 13,581 → 10,000 | 228.70 → 232.06 | 0/0 |

The [machine summary](candidates/taste-index-matrix/summary.json) and executed probe/driver snapshots retain reproducibility. Existing batch17 remains the adopted Taste source. PLAN-03 remains partial, with publication/leases/restart, concurrent revisions, absent natural cohorts and broader resource checks outstanding. This investigation is now closed for this implementation pass; further index-design experiments stay deferred rather than consuming the remaining known-fix work. Unchecked areas stay on their separate roadmap.


## Newly discovered input ordering — deferred

The [exact shared-interest candidate](candidates/interest-final-order/candidate.patch) makes the existing recent-CTE recency/ID order explicit on the final result. Two read-only clone schedules each pass 15 complete comparisons: four actual owners plus global across auto/custom/generic plans. Membership and every DTO field match; the explicit result equals an independently ordered database oracle. Six original outputs per schedule differ from that intended order. The 300-root cap is unchanged. Real order-sensitive first-100 and provider-priority input projections match the oracle; this is not whole-feed/provider-job acceptance.

The sort increases measured root buffers by 28–298 visits in these plans, with unchanged temporary blocks and mixed timings; this is a correctness proposal, not a speedup. It was briefly applied for source-bound read-only clone reproduction, then exactly reverted when the user clarified that this pass must stay with existing planned repairs. Both receipts and the reversion are retained in the [manifest](candidates/interest-final-order/source-manifest.json). Current runtime is the accepted earlier root-fallback owner. Put this new issue on the follow-up roadmap; do not count it as a completed fix or launch further exploration.
