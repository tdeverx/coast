# Public Library: guarded identity closure applied

The shared public observed-access Library query is now applied with a generic empty-access guard, reused canonical access seeds, and cheaper edge combination. **142 distinct actual-data requests preserve complete internal/public responses, primary IDs, counts, page clamping, order, links and secondary SQL/bindings.** Candidate-specific54fresh-backend resource trials show lower positive-case CPU, elapsed time and resident snapshots, while the five prior zero-seed graph/spill regressions are avoided. A direct imported-main acceptance, current common gates and signed-in normal UI smoke also pass. PLAN-09 remains open for its other owners and residual full-closure/count cost.

The [final acceptance](evidence/implementation-public-seed-acceptance.json), [adoption assessment with every adverse observation](evidence/public-seed-adoption-assessment.json), [source application](evidence/public-seed-source-application.json), [142-input actual proof](evidence/public-seed-broader-actual.json), [54 resource trials](evidence/public-seed-resources-actual.json) and [imported-main checks](evidence/public-seed-main-actual.json) bind this decision. The [pilot](evidence/public-seed-pilot-actual.json) and frozen protocols for [both seed modes](candidates/public-seed-guard/pilot18/plan.json), [broader inputs](candidates/public-seed-guard/broader142/plan.json), [resource sampling](candidates/public-seed-guard/resources54/plan.json) and [main acceptance](candidates/public-seed-guard/main9/plan.json) are retained. Earlier [materialization](public-edges-materialization.md) and [unconditional edge](public-edges-resource-verification.md) variants retain their original rejections; those measurements are not transferred to the new SQL.

## Shared change and invariants

In src/lib/server/public-api/library.server.ts, initial_access(id) contains the exact original availability/user/source/connection/enabled-provider predicate once, as MATERIALIZED. accessible(id) starts from those identities, retains its recursive UNION and adds WHERE EXISTS(initial_access) to the ancestor step. The three nonrecursive edge-combining UNIONs become UNION ALL. Contains/collection/sequence branches, season/show rules and special-episode exclusions stay exact. The original parameter order and values, feature filtering, UUID ordering, exact total/page clamping and hydration remain unchanged. One ordinary source comment explains the seed fence and identity deduplication.

For this identity-only closure, repeated edges cannot introduce a new reachable identity: the recursive UNION removes repeated current/prior IDs. An empty seed logically reaches nothing, so its existence gate changes admission rather than results. PostgreSQL documents [recursive duplicate elimination and CTE materialization](https://www.postgresql.org/docs/17/queries-with.html); this interpretation does not extend to recursive path, depth or multiplicity consumers. Actual cycles and repeated paths are absent, so no natural cycle-runtime proof is claimed.

Every category/source/kind served by this public Library owner receives the same repair. Other application queries have different edge-inclusion and root semantics; their own complete output/resource proofs are required before reusing the pattern. This is one existing-owner SQL repair, with no production dependency, schema, index, cross-request cache, UI redesign or provider-specific condition. Browser Library range retention remains a separate pending choice.

## Why seed reuse is required

Nine natural contexts compare two seed modes to one baseline each: four positive all-source/Steam first/deep cases, four saved Seerr sources with no observed access, and one actual other-owner Steam source. That is18candidate pairs, not18unique requests. All results match, and both modes avoid global graph scans and temporary work for zero seeds.

The empty-source control catches a different cost: NOT MATERIALIZED causes an availability rescan, raising root shared visits from2/5 to20,483/20,486 and descriptive plans from roughly1.5ms to30–33ms. MATERIALIZED retains the original2/5 visits, zero graph base scans and zero temporary blocks. The narrow pilot's graph/spill guard alone passed both modes; full root-counter review rejected the inlined mode. Fixed-order single plan timings are descriptive, not a benchmark distribution.

The chosen seed fence stores up to the actual seed cardinality:39,237 rows for the selected broad owner and1,144 for Steam. It avoids the rejected rescan and shares seed work in one statement. Larger natural seed sets may spill; growth remains a measured maintenance obligation, with work_mem unchanged at4MB.

## Complete actual-data coverage

The broader frame covers four enabled actual owners, nine saved sources, all five category selections and eleven kind selections, source ownership negatives, existing combined inputs and natural first/middle/deep-clamped positions. There are142 distinct SQL/binding input pairs:114positive,28empty;65paired descriptive plans. Nineteen comparisons include selected identities without a direct current access seed. The maximum669pages belongs to its own owner/filter; the selected broad resource owner remains38,952works/650pages. No growth is inferred from those different scopes.

Complete internal/public DTOs and ordered primary results match for every request. Every secondary SQL shape, parameter and method matches. All feature flags in this clone are true. There are no actual books or natural disabled-feature/cycle/repeated-path cohorts to certify. These are actual catalogue observations; no rows, credentials, providers, policies or missing media families are manufactured.

| Plan family | Pairs | Root shared visits delta | Temp read blocks delta | Temp write blocks delta |
| --- | ---: | ---: | ---: | ---: |
| Broad positive closures |57|+10,756|−2,391|−5,219|
| Steam positive source |2|+5,411|−1,196|−2,308|
| Unchanged controls, including empty access |6|0|0|0|

All65candidate plans avoid a temporary-block increase. The six graph-skipping controls preserve their baseline counters, including the five earlier bad cases. Root shared visits increase on positive closures, so no claim that every primitive counter falls is made. Root buffers are inclusive; descendants are not summed, and shared reads do not prove physical disk I/O.

## Fresh CPU and resident measurements

Nine actual inputs run both variants over three rounds on54fresh backends. Variant order is AB/BA/AB and scope order forward/reverse/forward. Capture uses one READ ONLY repeatable-read snapshot; each trial uses its own verified snapshot and compares complete primary JSON to the captured actual reference. The trials share neither an exported snapshot nor an isolated global cache. Capture/plans warm shared data; no eviction, checkpoint, scan switch or forced parallel setting is used.

| Positive scope | Median own-backend CPU ms, before→applied | Median direct-statement elapsed ms, before→applied |
| --- | ---: | ---: |
| All-source first |300→200|300.30→203.47|
| All-source deep |300→200|307.61→204.59|
| Steam first |100→50|107.58→57.17|
| Steam deep |110→60|112.00→61.76|

All12positive paired elapsed/PSS/private-dirty snapshots are lower. The slower candidate broad-deep round288.84ms is retained; it remains below its paired317.52ms baseline. Each positive context has only three pairs, so these are descriptive local measurements, not statistical tail or universal speedup guarantees.

After-statement PSS ranges, KiB:

| Scope | Before, three samples | Applied, three samples |
| --- | --- | --- |
| All-source first |45,738–45,899|44,882–44,981|
| All-source deep |47,593–47,691|46,678–46,795|
| Steam first |31,005–31,268|26,846–27,001|
| Steam deep |31,133–31,292|26,890–27,045|
| Each empty-source context |18,735–18,848 overall|17,084–17,198 overall|

Detailed counters are read as the backend's existing verified OSuid/gid70:70. No permissions change. [Linux stat](https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html) defines the actual100Hz CPU clock and process-start identity; [proc memory documentation](https://www.kernel.org/doc/html/latest/filesystems/proc.html) distinguishes resident/PSS/private accounting. CPU is the backend counter envelope around the statement, including boundary delay and10msquantization; direct client statement elapsed excludes proc commands, capture, plans, cleanup, HTTP/auth and hydration. Estimated plans reject Gather/workers in every trial; separate observed round0plans confirm serial shape. Client/background/cluster CPU is excluded.

Preserved adverse observations matter:

- Sampled retained allocator capacity is98,304bytes (96KiB) higher for every candidate pair:2,659,536→2,757,840positive and2,658,512→2,756,816empty. This is sampler-inclusive current capacity from pg_backend_memory_contexts, not query allocator peak or a long-lived pool growth proof.
- Empty Seerr owner3 has coarse CPU0/0/0→20/10/10ms, while its paired client elapsed is lower. Tiny-query CPU ranking is unresolved at this clock/boundary precision; no empty CPU improvement is claimed.
- Three empty paired elapsed observations are higher, with maximum+0.50ms in the other-owner Steam case. Seerr owner0 median3.987→4.025ms is slightly higher. Cheap buffer/temp/graph work remains unchanged, and the other four empty medians are lower. These small differences are retained without a statistically established regression/improvement claim.

Smaps are resident snapshots, not peaks. PSS includes proportional shared mappings; VmRSS/VmHWM are coarse process values. Retained allocator totals are not a browser heap, private query peak or long-lived leak. All54trial pools plus the capture pool close, and all55original backend processes are observed gone. This proves probe teardown, not normal pooled-backend eviction. No normal HTTP, provider, browser/native/GPU memory, cold start, quota, concurrent withdrawal, long soak or future growth claim follows from these profiles.

## Main application and supplementary acceptance

After exact source application, nine new actual inputs call the imported main function directly against the archived original compiled with the same real dependencies. Complete DTOs, ordered primary results, secondary SQL and all bindings match, and baseline/applied SQL/parameters/full-response hashes match their corresponding earlier142-input anchors. The18descriptive plans retain empty graph/temp admission. This is a main-owner domain acceptance on the private clone.

Fresh [common gates](evidence/implementation-20261018-public-seed-gates.json) pass825existing tests,715guarded skips,0failures and34,104assertions; Svelte/TypeScript has0errors/0warnings. Production build including the maintained navigation patch check, code inventory544modules/75roots, UI inventory65components/27compositions/10internal renderers/9delegated routes, and source style all pass. Existing unit controls are supplementary; guarded fixture database suites are not enabled or used as actual-data performance evidence.

The [normal smoke receipt](evidence/implementation-public-seed-normal.json) uses the existing signed-in normal development tab at localhost:5173. Watch/Listen render actual saved titles; native scroll admits populated Play/Read shelves and their loading markers disappear. The screenshot below was visually inspected. New console warnings/errors are zero. No playback, tracking, settings, job or request command is submitted; ordinary freshness/session/presence reads can run.

[Signed-in normal Library game and comic shelves (private verification image)](publication.md#private-verification-images)

Browser Library has its own query owner. This is UI smoke, not HTTP acceptance of the changed public endpoint: its handler requires a bearer API token and never accepts browser-cookie authorization. No positive actual-token HTTP/quota test is claimed. Earlier source-frozen Tasks30cards, panel shrink/close and Activity acceptance remain separate earlier results; they are not relabeled as rerun here.

The [post-smoke identity check](evidence/implementation-public-seed-normal-source-check.json) matches all577current app files to the prior frozen manifest plus the single reviewed owner application; a new fresh577-file browser-start capture is not claimed. Current static inventory is577files/59,484lines/3,771candidate sites. Static coverage is not every runtime case certification.

## Drift, reproduction and next work

Keep the one canonical seed predicate, the MATERIALIZED seed fence, recursive identity UNION, special-episode/edge branches and all policy/count/order contracts together. When this owner, SQL planner/runtime, schema, indexes, access predicates, response hydrators or real catalogue scale changes, rerun complete actual positive/inherited/empty/other-owner results and inspect whole-plan root/graph/temp counters before profiling. An output-only equality pass misses both rejected resource variants. Add natural disabled-feature, book, cycle/repeated-path and positive public-token HTTP cohorts when available; never fabricate them to close this audit.

Archived protocols contain exact source/dependency/session identities, strict TypeScript checks, parent lease, approved in-memory credential runner and rollback/close/postchecks. They deliberately pin the local actual-data target and source; they are review artifacts requiring deliberate refresh rather than general production migration scripts. Preserve each old receipt and capture fresh evidence after drift. No DDL, DML, normal database mutation or provider call occurs in this query batch.

Next routine candidates are shared membership reuse in UI count/page selectors, recorded-watch count/page windows and ordered audit-history access. Their contracts, actual inputs and full proofs remain separate. Public Library still computes exact closure/count, then UUID ordered selection; large positive graph scans and numbered deep-page work remain. PLAN-09 stays open with this partial implementation clearly recorded. The overall audit and pending Library range choice remain active.
