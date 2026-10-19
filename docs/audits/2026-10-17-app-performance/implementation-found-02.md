# Shared Progress, History, queue snapshot and logical refresh repairs

The implementation of existing findings is active. This batch changes shared owners without changing the approved interface, dependencies or schema. The [active queue](implementation-queue.md) retains every unresolved finding and acceptance boundary.

## PLAN-09 — shared Progress predicate

Library and Profile use one libraryTrackingCondition. Its Progress branch now checks dropped status, then positive started/rewatch evidence, before evaluating completion in SQL CASE. Other statuses compile identically. Keep three-valued semantics: do not coalesce nullable completion or replace the child NOT predicate with a different boolean aggregate.

The [actual clone comparison](evidence/implementation-found-progress-actual.json) passes12complete Library/Profile pairs across4owners and22032complete ordered per-title predicate values. All actual5508movie/show identities per owner were compared, including negative/unstarted roots. Other status SQL/bindings and secondary hydration reads match. Natural dropped roots/rewatches/NULL outcomes are absent; their exhaustive boundary/timestamp schedules are not proved.

Owner0 primary root shared visits: all1689079→1576385; show1675136→1562424; movie332989→333007 (18more, retained adverse). Three alternating primary samples per variant/kind give descriptive local elapsed medians all2360.14→2163.98ms, show2440.11→2312.38ms, movie121.21→121.09ms. Client process CPU is separate from database CPU; no native peak memory, HTTP or portable tail claim.

## PLAN-09 / PR-14 — Profile recorded History reuse

The shared Profile summary/read owner now materializes the exact filtered recorded-watch relation once for History count and clamped page. Overall total/unique/movie/episode counts remain **before explicit from/to**, while filtered count/page remain after dates. Native event/time/edition/null/false mapping and known-date/time/event-ID descending order are preserved. Full page and narrow section share this implementation. Non-History views and insights retain their count-only query; there is no cross-request cache.

The [actual clone comparison](evidence/implementation-found-history-actual.json) passes25complete full/narrow outcomes across4owners: first/middle/deep180-page history, movie/episode, month/year, repeats, escaped text, Other genre, dated/empty filters, insights, non-History controls and naturally allowed/denied viewers. Seven native event fields and all five counts match. Actual largest history10779events/180pages, far-clamped last39events. First/deep/empty primary root visits18564→9282, with0temp reads/writes in these plans. Fixed-order EXPLAIN timings are descriptive, not a latency distribution. Count columns repeat over at most60result rows; peak memory and wider growth spills remain unmeasured.

The [first stop](evidence/implementation-found-history-first-stop.json) passed8pairs before an over-specific harness assumption stopped: UUID-first owner has56events, largest owner has10779. The revised proof selects the observed largest owner. Failed type/unit preflights are archived. Final native result assertions erase to exactly the same JavaScript as the actual-tested candidate; [transfer receipt](evidence/implementation-found-history-adoption.json). No new fallback or weakened mapping was introduced.

## MIN-06 — canonical queue-consumption snapshot

The exact existing tracking DELETE membership is now consumedQueueCondition, reused by Continue's pre-mutation Undo snapshot. It selects only potentially consumed queue entries instead of the whole account queue. The final removedQueueIds filter, event/Undo contract and existing feature/user advisory lock remain. No new result field or lock order is introduced.

The [actual check](evidence/implementation-found-consumption-actual.json) verifies identical native SQL/bindings over actual owner/media-kind samples and unchanged empty queue reads. All owner queues are empty, so positive Remove/Undo/concurrency and performance remain unverified. No queue rows were fabricated.

## UIC-03 — one logical completion refresh

The existing API client now exposes changeMany for an ordered same-domain logical action. Grouped recommendation Save/Dismiss uses it across all work categories. Commands retain individual acknowledgements, order and first-failure stopping. One final refresh occurs if any prefix was acknowledged, including after a later failure; no refresh occurs if the first command fails or the group is empty. Refresh failure cannot turn an acknowledged write into a failed command. Input paths are captured before delivery; mixed domains are rejected before transport. This is not an atomic server batch and performs the same command requests as before.

Three new supplemental controls protect ordering, partial failure, no suffix/retry, empty/mixed-domain rejection and acknowledgement despite refresh failure. Actual pending grouped recommendations are absent, so no positive real Save/Dismiss mutation acceptance is claimed. Preview clients use the same injected transport with their existing no-op refresh, never a live fallthrough.

## Gates, normal acceptance and drift

[Common gates](evidence/implementation-found-02-gates.json):828passed,715guarded skips,0failures,34117assertions; typecheck0errors/0warnings; production build including navigation patch, code/UI inventories and source style all pass. Fixture DB suites were not enabled on the actual clone. Unit controls supplement actual evidence.

[Normal signed-in acceptance](evidence/implementation-found-root-normal.json): canonical History API56events; Library Progress11actual cards; full profile; chart link to a dated History page with1settled real card and0new warning/error logs. The normal account differs from clone Progress10; no snapshot equality is asserted. No mutation controls were submitted. Initial wrong endpoint and across-navigation locator observations remain recorded.

[Performance methods](../../performance.md) owns the new shared patterns. [Current source receipt](evidence/implementation-found-02-source.json) explicitly advances10reviewed owners, while archived actual receipts retain exact historical input hashes. Older proofs were not silently rerun. The machine batch receipt pins exact archives and evidence.
