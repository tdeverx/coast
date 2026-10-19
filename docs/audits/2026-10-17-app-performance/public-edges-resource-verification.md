# Public Library edge multiset — real CPU/memory gains, empty-seed regression

This candidate preserves142 distinct complete actual internal/public DTO and primary-result pairs. It also lowers measured CPU, elapsed time and detailed resident memory in the four positive all-source/Steam contexts. **It is not adopted:** the broader65-plan-pair check catches five empty/other-owner-source cases that unnecessarily process and spill the global graph. The performance acceptance gate rejects the unconditional rewrite while retaining its genuine measured gains.

The [resource interpretation and adoption decision](evidence/public-edges-resource-assessment.json), [24 CPU/elapsed trials](evidence/public-edges-cpu24-actual.json), [eight detailed memory trials](evidence/public-edges-memory8-actual.json), [candidate-specific broader proof](evidence/public-edges-multiset-broader-actual.json), [CPU protocol](candidates/public-edges-resources/cpu24/plan.json), [memory protocol](candidates/public-edges-resources/memory8/plan.json) and [broader protocol](candidates/public-edges-resources/broader142/plan.json) bind this result. The [original four-context pilot](public-edges-multiset-pilot.md) and [rejected materialization variant](public-edges-materialization.md) remain separate.

## Query and actual-data contracts

The source candidate changes three pure edge-combining UNIONs to UNION ALL and preserves the recursive accessible(id) UNION, every branch/special rule, access/source/feature predicate, count, order, clamping, hydration and response/link field. The broader candidate adds one ordinary code comment explaining that identity-set UNION prevents duplicate reachability and cycles. Comment-erased programs match the resource-tested candidate, and all32 timed/memory trials' exact compiled SQL and bindings match corresponding broader cases. No result is transferred merely because a source change looks similar.

All four saved enabled owners, nine real sources, supported category/kind filters, own/other-owner sources and existing combined scopes are exercised:142 distinct SQL/binding inputs,114 positive and28 empty, up to669 pages. Nineteen comparisons include selected inherited access. All feature flags in this actual clone are true; absent book, disabled-feature, cycle/repeated-path, HTTP token/quota, provider and device cohorts remain gaps. No catalogue, policy or credential row is fabricated. These are clone/domain checks, not normal authenticated public HTTP acceptance.

## CPU and elapsed time

Four actual all-source/Steam first/deep statements run on24 fresh backends: two variants × three rounds × four contexts. Variant order is AB/BA/AB; scope order is forward/reverse/forward. Canonical capture and plan reads warm shared data. Each timed direct SELECT returns the complete actual primary JSON reference. Proc commands, capture, plans, cleanup, authentication, HTTP and hydration are outside the client timing window.

| Scope | Median backend CPU ms, before→candidate | Median direct-statement elapsed ms, before→candidate |
| --- | ---: | ---: |
| All-source first |320→200|324.29→203.36|
| All-source deep |310→210|307.90→214.45|
| Steam first |120→60|124.51→61.05|
| Steam deep |110→60|118.38→58.84|

All12 paired client elapsed observations are lower. Preserve the weak/outlying all-source first-page candidate observation311.13ms versus paired324.29ms; its CPU310 versus320ms is only one clock unit apart. Three rounds establish descriptive local observations, not a latency distribution, tail guarantee or universal speedup. Backend CPU uses user+system counters at the actual100Hz clock, so small deltas have quantization error. [Linux stat fields](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html) define those units and process-start identity.

Estimated plans reject Gather/worker nodes on every trial; separate actual plans outside measurement confirm the observed serial shapes in round0. max_parallel_workers_per_gather is recorded, not forced. CPU excludes client, background and any worker CPU; no whole-cluster or whole-app claim. Fresh trials have separate verified snapshots under a cooperating parent lock, with complete primary results unchanged; they do not share an exported snapshot or isolated machine/cache state.

## Memory and teardown

The default observer cannot read smaps_rollup in the first24-trial run. The distinct eight-trial follow-up reads aggregate counters as the backend's verified existing OSuid/gid70:70, without changing permissions. It also samples same-backend pg_backend_memory_contexts sums. Each context has one observation per variant, with AB/BA alternating by scope.

| Scope | After-statement PSS KiB, before→candidate | Private dirty KiB, before→candidate |
| --- | ---: | ---: |
| All-source first |45,791→43,182|34,628→31,904|
| All-source deep |47,692→44,994|36,428→33,716|
| Steam first |32,491→28,197|26,576→22,276|
| Steam deep |32,503→28,238|26,592→22,320|

These are resident snapshots, not peaks or distributions. PSS accounts for shared mappings proportionally; it is not exclusively private allocator memory. VmRSS/VmHWM from status include mapped shared buffers and are coarse observations. The first run retains one adverse Steam-first RSS pair106,456→107,936KiB; later detail does not erase it. [Linux proc documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html) and [status fields](https://man7.org/linux/man-pages/man5/proc_pid_status.5.html) distinguish these quantities.

Both layouts' sampled retained allocator totals move2,560,208→2,659,536bytes and162→164 contexts. Used totals vary slightly. This sampler-inclusive retained state is not target-query allocator peak and does not prove a long-lived pool plateau or leak. Before/after sampling checks the same PID/start identity; raw process text, addresses, PIDs and query values stay in memory. Both capture connections and all32 fresh trial pools close, and original backend-process disappearance is observed after each closure. This proves probe teardown, not normal pool eviction.

## Why adoption is rejected

Across the65 broader plan pairs:

| Pattern | Pairs | Root shared visits delta | Temp reads delta | Temp writes delta |
| --- | ---: | ---: | ---: | ---: |
| Broad observed closures |57|+10,756|−2,391|−5,219|
| Steam positive source |2|+5,411|−1,196|−2,308|
| Unchanged control |1|0|0|0|
| Empty initial access |5|+3,081|+739|+1,257|

Four saved Seerr-source cases return no observed Library access; one measured other-owner Steam source also correctly returns empty. Baseline work is only2–5 shared visits with no temporary I/O. The candidate instead uses3,083–3,086 visits and739/1,257 temp read/write blocks. It preserves privacy/output but performs unnecessary graph work. Positive CPU and memory measurements cannot justify regressing these normal negative inputs.

The source/plan interpretation is that removing edge dedup changes join planning so the graph side can be built before discovering an empty recursive frontier. The next candidate must enforce generic zero-initial-access admission. Factoring one canonical seed predicate and gating recursive edge work can preserve ownership/source rules while avoiding a provider-specific exception. Materialized seed reuse and a cheap repeated existence check have different memory/read costs and must be measured. This is a proposed next experiment; no guarded version or production fix is inferred here.

## Integrity and remaining scope

All source/input identities match, all transactions are READ ONLY repeatable read with verified30s statement/1s lock limits, JIT off,4MB work memory and stats_fetch_consistency none. Source-matched policy functions/no-RLS checks pass. Source50 and the577-file app inventory remain unchanged. Rollback, pool/reservation closure, parent exits and subsequent lock availability pass; fetch/preconnect attempts are zero and no credential key is created. Existing approved container credentials remain only in memory. No DDL, DML, schema, permission, provider, normal database or production source mutation occurs.

The existing825 common passes/715 guarded skips and prior signed-in normal checks remain separate and are not rerun by this private-only work. The app-wide audit remains active. This candidate-specific142 proof does not close other numbered-page/history owners, the independent client range choice or absent natural cohorts.

Subsequent [guarded-seed application](implementation-public-seed.md) has its own142actual pairs,54resource trials and imported-main acceptance. Current source identity advances to that exact query; the original measurements and candidate dispositions in this report remain historical.
