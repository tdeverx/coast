# Shared audit History, Trakt identity batches and visible social demand

Later adoption: [batch04](implementation-found-04.md) applies the bounded shared range/source/Shelf protocol. The candidate/checkpoint below remains historical; its own acceptance and tradeoffs are not promoted.


Existing-finding implementation continues. This batch applies shared repairs for PLAN-09/PR-14, PJ-06 and UIS-04. The broader bounded scrolling/data-retention implementation is **still in progress**; Tasks keeps its current query/index pair by the user's explicit choice. See the [direction receipt](evidence/implementation-found-direction-decisions.json), [active queue](implementation-queue.md), [decision tradeoffs](implementation-decisions.md) and [performance owner guide](../../performance.md).

## Audit History: one scope/count/page statement

Every mediaHistory/mediaActivity consumer now shares one materialized recursive identity scope and one count/page statement. The exact action/user/scope predicates and event ordering remain. Count still occurs before the media join; counting only joined rows would change the existing contract. Hydration remains later and complete. There is no event retention/deletion/index or cursor change.

The [actual comparison](evidence/implementation-found-audit-history-actual.json) passes10complete raw/hydrated pairs:32482events/542pages, first/middle/far-clamped pages, all4actualowners and an unobserved actual title. Count/page primary statements2→1; hydrated secondary SQL/bindings match. In three deep-scope plan pairs, root shared visits33359→32336. Temporary counters stay0/0 first,317/363middle and362/363deep; the deep sort spill remains. Fixed-order EXPLAIN elapsed changes are descriptive only. No new backend CPU/peak memory/wire/tail claim or manufactured cycle/repeated-membership cohort.

[Signed-in normal acceptance](evidence/implementation-found-audit-normal.json) returns60of390raw events on page1,30on far-clamped page7, and30hydrated activity cards on page7, with valid timestamp strings and0new warnings/errors. This is a different current scope from the clone's deepest group.

## PJ-06: canonical identity batching

exportIdentities reads at most500requested `(ordinal,UUID,kind)` tuples per statement, selects only provider/identity fields, groups by ordinal and returns one identity object for **every input** in original order, including missing identities. Native UUID casts preserve accepted spelling/case; no application string-key join can accidentally discard an uppercase UUID. Empty input makes no query. exportIdentity is a thin scalar consumer of the same formatter; captured ordered Trakt list delivery and desired Collection projection use the batch owner. Unsupported Collection entries, first unresolved title order and provider payload construction remain.

The exact existing provider allowlist, placeholder exclusion, safe positive integer checks, IMDB nonempty handling and numeric conversion remain in one formatter. There is no new alias precedence rule: multiple valid aliases had no explicit ordering in the original query. Each batch now observes one statement snapshot rather than a sequence of per-identity snapshots. No cross-request cache, metadata write or network call is introduced.

The [first actual proof](evidence/implementation-found-identity-first-actual.json) passes516sample identities across4screen kinds, reducing516→2statements;75naturally missing identities remain empty. Four actual collected projections are naturally empty. This census found780multiple-mapping provider/work/kind groups, so the [broader proof](evidence/implementation-found-identity-actual.json) adds all746distinct naturally multi-alias work/kind inputs. Combined1249ordered identity objects match, with1249→3statements,1174identified and75missing. Actual duplicate and uppercase UUID controls also match.

A positive actual personal Collection projection retains all757entries, complete payloads/order/unresolved/blocked outcomes, with759→4ORMstatements. This compiled-owner comparison uses the real unchanged collectionCTE in the verified parent read-only snapshot and substitutes only collectionRead's transaction wrapper with real execute; recursive factor0.01is retained. It is not a normal configured projection/export mutation or current remote-account verification. No saved lists exist, so positive list export/retry/uncertain-create and provider-write/concurrency acceptance remain unverified. No latency/CPU/heap/wire improvement is claimed from statement counts alone.

## UIS-04: social demand follows actual viewport visibility

A shared observeVisibility owner serves every Shelf through one near-viewport observer, the existing artwork margin and one document-visibility listener. Shelf requests social badges only for near cards, not its entire loaded array. Leaving the margin cancels/discards optional results through existing enrichment ownership; hidden documents withdraw this optional demand; replacement/disposal cannot unregister a successor and the last owner releases observer/listener resources. No per-card global listener or new scheduler/cache is introduced. Existing privacy/feature/viewer gates, artwork loading and approved UI remain.

The [actual normal card observation](evidence/implementation-found-social-normal.json) verifies admission markers match real geometry:18of60cards at top,30after scroll with the original head withdrawn, then18on return with head readmitted. Viewport1280×720,0new warnings/errors. Supplemental observer/enrichment controls protect hidden-document policy, obsolete cleanup, fallback support and request cancellation; these are not actual hidden/resume or performance measurements.

**All60cards still remain mounted.** This repairs social demand admission; it does not finish UIS-03 retained DOM/data bounds or coherent range refresh. Native allocation/CPU, backend request/SQL counts and long-scroll resource plateaus remain separate acceptance.

[Actual normal Library after the shared demand repair (private verification image)](publication.md#private-verification-images)

## Gates and drift

Final [combined gates](evidence/implementation-found-04-gates.json) pass:831tests,715guarded skips,0failures,34139assertions; typecheck0errors/0warnings; production build/navigation patch, code/UI inventory and style. Earlier audit-only gates are retained separately. Fixture database suites were not enabled on actual data. The [machine report](implementation-found-03.json) and [current source receipt](evidence/implementation-found-03-source.json) retain exact reviewed owner changes, archived proofs and explicit historical/current boundaries.

Extend static call inventory when adding a delivery primitive: changeMany is now recognized. Keep ordinal/missing/alias/UUID/cross-chunk identity proof, pre-join audit counts and native event ordering, current viewport/document demand and last-owner cleanup in drift verification. Do not silently promote a new source hash to old actual-data acceptance.
