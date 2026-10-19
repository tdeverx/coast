# Public Library edge multiset — actual pilot, unadopted

The second candidate preserves four complete actual internal/public DTO and ordered primary-result pairs, including the saved Steam scope that regressed under materialization. It substantially lowers temporary reads/writes but increases shared-buffer visits. It remains unadopted; these counters alone do not establish overall loading speed, CPU or memory efficiency.

The [actual receipt](evidence/public-edges-multiset-pilot-actual.json), [interpretation/provenance](evidence/public-edges-multiset-pilot-assessment.json), [exact protocol](candidates/public-edges-multiset/plan.json), [probe](candidates/public-edges-multiset/pilot.ts), [three-edge patch](candidates/public-edges-multiset/edge-union-all.patch) and source snapshots retain the evidence. The [materialization experiment](public-edges-materialization.md) is a separate candidate with142 full comparisons; that broader proof does not transfer to this variant.

## Contract and rationale

Only the three nonrecursive edge-combining UNIONs become UNION ALL. No materialization fence is added. Every branch, special-episode restriction, ownership/source/feature predicate, count, ordering, page clamping, hydration and public-link field remains. The recursive accessible(id) UNION is explicitly retained and guarded in both source and compiled SQL.

The source-based inference is that repeated edge pairs cannot change this identity-set closure: accessible carries only id, and recursive UNION removes repeated identities and prior results. This follows the [PostgreSQL17 recursive evaluation contract](https://www.postgresql.org/docs/17/queries-with.html). It does not authorize changing a recursive UNION to UNION ALL, or applying the same rewrite to path/depth/weighted-count consumers. Natural cycle/repeated-path fixtures are not inserted to fill actual-data gaps.

The first actual enabled owner supplies all-source first/deep pages:38,952 works/650 pages,60 and12 returned items. A separately derived existing enabled/connected Steam account supplies1,140 games/19 pages, with60 items on each tested page. Literal baseline internal/public DTO hashes match the corresponding four contexts from the earlier broader receipt, establishing the recorded context provenance. Candidate equality is checked independently. No raw identities, parameters, account records or DTO bodies are published.

## Measured work

| Scope | Root shared visits | Temporary reads | Temporary writes |
| --- | ---: | ---: | ---: |
| All-source first |176,602→187,358|4,897→2,506|7,733→2,514|
| All-source deep |176,602→187,358|4,897→2,506|7,733→2,514|
| Steam first |8,460→13,871|2,449→1,253|3,565→1,257|
| Steam deep |8,460→13,871|2,449→1,253|3,565→1,257|

All four complete internal/public DTOs and ordered raw primary outputs match. Main SQL differs only in the three edge connectors; all bindings match, and secondary query shapes/bindings are unchanged. ORM call counts are unchanged. These are eight descriptive plans in fixed before→candidate order, not timing-repeat, CPU, peak/RSS, physical-disk or normal HTTP measurements. Inclusive root counters are never added to descendants. Fewer temporary blocks and more logical shared visits are different resource dimensions; neither is converted into a universal speedup.

## Execution and next evidence

The designated actual clone runs one reserved READ ONLY repeatable-read snapshot with verified30s statement/1s lock limits, JIT off,4MB work memory, stats_fetch_consistency none and the same backend. Three policy functions match source identities/bodies/execution properties; public tables have no RLS. All50 source pins and private inputs match; rollback, reservation release, pool closure, parent exit0 and subsequent lock availability pass. The577-file application inventory remains unchanged, fetch/preconnect counts are zero and no credential key is created. Approved existing container credentials remain in memory. No app, schema, catalogue, policy, source, provider or normal database mutation occurs.

The next meaningful comparison is bounded actual database CPU, memory and elapsed work on these exact all-source/Steam statements, with alternating variant order and explicit cache/backend/sampling limits. A buffer visit is not a CPU millisecond, and a query plan's sort-space figure is not process RSS. Such profiling is proposed, not executed here. Broader142-context equivalence and additional adverse controls must then be run specifically for this candidate if its resource tradeoff warrants adoption. Actual books, disabled features, cycles/repeated paths, HTTP token/quota, normal API transport and provider/device cohorts remain unverified.

The shared social relationship edge producer has different branch semantics and separate card-head/Activity consumers. Reusing this optimization principle there requires its own exact producer/closure review and full actual-data proof. No generic blanket replacement or new abstraction is introduced by this pilot.

The [subsequent resource and broader proof](public-edges-resource-verification.md) now records24CPU/elapsed trials,8detailed-memory trials and142complete actual pairs. Positive resource gains coexist with five empty-seed graph-work regressions, so the unconditional candidate remains unadopted. The original pilot checkpoint and receipts above retain their narrower scope.

Subsequent [guarded-seed application](implementation-public-seed.md) has its own142actual pairs,54resource trials and imported-main acceptance. Current source identity advances to that exact query; the original measurements and candidate dispositions in this report remain historical.
