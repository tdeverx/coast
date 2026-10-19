# Controlled admin acceptance — three existing repairs verified, recommendation candidate rejected

The user clarified the original actual-data requirement: use the admin account and real catalogue; controlled temporary test state on the private clone is allowed. Earlier natural-empty-state blockers were overly restrictive. This batch executes existing audit proposals, with agent-run archived DEFAULT/current comparisons, no normal writes, no fabricated users/catalogue/provider responses and no external delivery. Temporary list/queue/recommendation records are controlled scenarios over actual data, not naturally observed usage. [Test policy](admin-real-data-policy.md).

No runtime source changes are introduced in this batch. The shared list mutation/header and Continue snapshot repairs were already applied; this closes their named positive acceptance. The received-recommendation proposal is rejected. No commit, push, PR, dependency or UI redesign is added.

| Finding | Decision | Verified resource/result |
| --- | --- | --- |
| DATA-03 list mutation | Existing shared repair verified on positive admin scenarios | 32 comparisons including cross-page order, ownership and lock admission. Removal63item UPDATE statements→1; reorder64→1; no-op item writes→0. |
| DATA-12 list header | Existing shared repair verified through native header and playback API consumers | Header2statements/65driverrows→1/1. Native playlist first/restart6→5statements and repeat2→1; same timestamps, status and output. |
| MIN-06 Continue snapshot | Existing shared repair verified through positive lifecycle and concurrency schedules | Four lifecycle pairs/78checks plus3concurrency pairs/37checks. Snapshot rows1,026→4 and JSON bytes139,544→556; native statements272→272. |
| DATA-06 received recommendation paging | Candidate rejected; default retained | 33complete native pairs match. Page transfer shrinks, but corrected large-case native/source elapsed observations worsen; small response adds41bytes. No alternative hunt. |

## List mutation and header checks

[First positive proof](candidates/admin-list-verification/summary.json), [remaining acceptance](candidates/admin-list-verification/remainder-summary.json), [WAL observations](candidates/admin-list-verification/wal-summary.json). Admin ordinary lists use64actual entries; playlists repeat32actual titles while retaining64distinct entry identities. First/middle/last/absent removal, unchanged/reverse/permutation reorder, cross-boundary59↔60neighbours and full ordered fields/returns/errors match. Absent removal and identical reorder preserve logical tables, timestamps, revisions and outbound preparation. Changed-row counts first/middle/last fall63/63/63→63/31/0; ordinary removal statements72→9 and playlist70→7. Changed reorder statements71→8 and69→6.

Four exact two-session advisory-lock checks demonstrate a native move waiting on the same admin lock, verified through pg_blocking_pids, then completing after rollback release. Native header access rejects a nonowned controlled list with the same404; admin remains the actor. Full native playback POST first/repeat/restart preserves playlist200responses, timestamps and repeat no-op semantics. No actual playback, external transport or remote export delivery is performed. These finite schedules do not prove arbitrary race/commit/reconnect or production-tail behavior.

The first harness attempt borrowed a read connection while its single pool connection was held by the rollback transaction. It never reached comparison and was terminated; database disconnect rolled back. The corrected probe binds native reads to the held session, changing no optimization or scenario. Original failure and corrected results remain separate. An independent full logical fingerprint before DATA-06 and the final parent check establish restoration after interruption.

WAL is measured separately from row/statement savings. Four global LSN movements DEFAULT→current are19,480→20,936;18,832→22,408;19,664→22,504;18,552→21,648bytes. No WAL reduction is observed. Server-wide traffic, cache/order and full-page images limit attribution; rollback does not undo physical WAL. Retain the demonstrated bounded command/changed-row savings without claiming universal resource or latency improvement.

## Continue Remove/Undo

[Positive lifecycle summary](candidates/admin-continue-undo/summary.json), [concurrency summary](candidates/admin-continue-undo/summary-concurrency.json). Four actual movie/show/episode/season cases check two Remove/Undo cycles, repeated Remove, exact queue order/timestamps, rewatches, revisions/events and stale-event409. Row/JSON-byte savings are transfer/allocation proxies, not wire, heap or latency measurements. Reported276statements per variant include4harness constraint statements; native lifecycle count is272for both. Adverse fixed-order show/season samples are retained.

Three native two-session schedule pairs run on a uniquely tagged disposable copy. Exact marker verification and final absent-state check prove the copy was dropped; original source data is untouched. Competing enqueue/dequeue commands can commit while Continue holds its own user advisory lock: that lock does not serialize those commands. Removed-ID filtering excludes a row concurrently dequeued; conflict handling preserves a concurrently re-enqueued timestamp during Undo. Nonmatching queue state remains exact.

**Separate preexisting race observation:** an item enqueued after the snapshot can be consumed yet remain absent after Undo in BOTH DEFAULT and current. The comparison proves baseline equivalence, not lossless Undo for that schedule. It is registered as CONTINUE-UNDO-RACE-OBS-14 for future investigation; no new fix or alternative is attempted here. The performance guard is not claimed to repair that preexisting behavior.

## Received recommendation candidate

[Decision](candidates/admin-received-recommendations/README.md), [corrected resource boundaries](candidates/admin-received-recommendations/resources.json). Temporary pending rows cover511actual works/1,022recommendations, using admin as recipient/viewer and actual peers as sender references. Thirty-three native pairs preserve full DTOs, totals/order/page clamping, all/available scopes, privacy/disabled/removed-source cases and actual Save/Dismiss outcomes. Old all/personal/ID-array Collection SQL and bindings remain byte-identical in the candidate extension. No candidate or SQL-seed extension is adopted.

For large screen-all, planner rows/JSON bytes shrink247/40,509→1/9,884, but native107.9→179.0ms and source3.15→9.23ms. Large available source rows/bytes shrink494/112,528→1/9,884 and bound values559→78, while native979.5→1,171.4ms and summed source EXPLAIN execution1,001.05→1,423.02ms. Available buffer hits rise438,939→441,190 while reads fall29,048→24,253; neither observation is a universal cost win. The small2-work payload grows329→370bytes. Three finite pairs with fixed/reversed order are observations, not a statistically established production regression or CPU/heap measurement.

The first semantic receipt's elapsed timer included EXPLAIN, and its baseline plan omitted the separate assessment. Those invalid comparisons remain explicitly discarded. Corrected timing stops before EXPLAIN and includes every baseline eligibility read. Stop after the prescribed method: retain default and add the failed proposal to the investigation backlog.

## Restoration, drift and status

[Final parent READ ONLY restoration](evidence/implementation-found-22-restoration.json) independently confirms all102tables/1,864,145rows and original SHA2569428397f6ad5bb35ab00dc685720984797592bea078e3e13300acf5dab9a07c7after every admin probe, including WAL observations. Copy cleanup and per-agent rollback receipts are independently retained. Other probe digest formats are compared only within matching before/after algorithms.

Runtime owners remain unchanged from the passing [batch21common gates](evidence/implementation-found-21-gates.json):844passes/715guarded skips/0failures, type/build/navigation/inventories/style pass. No common rerun is needed solely for new actual-data tests/docs; skipped suites are not actual acceptance. Current source/report/artifact integrity is rerun. [performance.md](../../performance.md#test-real-content-with-controlled-admin-states) records admin-state testing and measurement boundaries.

DATA-03, DATA-12 and MIN-06 advance to implemented-admin-actual-catalogue-verified for their prescribed shared repairs. Broader environment/recipient/WAL-attribution limits remain explicit rather than pretending exhaustive application acceptance. Canonical counts become22open /35partial /32implemented /5other; this does not close the overall audit. DATA-06remains open with its tested method rejected. Failed proposals return to the backlog; future investigation still prioritizes uninvestigated areas.
