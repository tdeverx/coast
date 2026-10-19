# Shared diagnostic admission and hidden glass lifetime — implementation batch 05

**Applied at shared roots, with actual-data and normal signed-in acceptance.** This continues only known partial UIS-06/UPP-03 work. Unchecked areas remain deferred. No dependency, database/schema migration, provider command, domain mutation, commit, push or deployment was introduced.

## Result and scope

`DiagnosticStore` no longer splits an entire segment just to inspect the first record during pruning. It also accepts an optional output limit: retain exact parse/filter/date/order behavior, then sanitize only enough valid records to satisfy the caller. A malformed detail record is skipped without consuming a slot. `listDiagnostics` passes its existing output bound into this shared owner; Activity/Admin request 30, the default service limit remains 100, and full download calls remain complete. Administrator admission still precedes I/O. Both diagnostic and runtime stores share the class; no cache or independent logger was added.

The shared `liquidGlass` action releases its native SVG definition and encoded displacement map when the enabled native path observes zero rounded dimensions. Its existing resize/frame ownership rebuilds a positive-size surface. Every Header, Dialog, Button/card surface and preview using this action receives the same rule. Same-key visible reuse, CSS/unsupported/preferences gates and the500 ms deferred destroy workaround remain. This changes hidden resource ownership, preserving the approved visible design. The existing disabled/CSS fallback warm-map policy remains separate; this is not universal inactive-cache reclamation.

## Actual diagnostic verification

The [current receipt](evidence/implementation-found-05-diagnostics-actual.json) captures actual normal segments read-only, then runs exact checkpoint/current owners against new disposable copies. **20 complete DTO/file-state/metric comparisons pass**, covering 16,325 diagnostic and 2,656 runtime records, full output and limits 0/1/30/100/500, exact/past first-event retention cutoffs, an actual first line without its newline, and a malformed prefix before actual events. Altered boundaries/prefixes are authored controls on actual copies, not observed incidents. Copies are removed. No raw rows/IDs, database connection or provider request enters the receipt.

The actual diagnostic viewer limit 30 reduces safeFields calls **16,325→30**, and limit100 reduces them **16,325→100** while complete ordered output matches the baseline slice. Full-tail calls still sanitize every valid row. Both actual stores' first-record split would create **18,988array entries** across the captured files; the new path uses a first-newline slice. These are owner-call/source-work counts, not heap or CPU measurements. Actual files are never mutated by the probe; all seven captured segments still match their byte digests at the final replay postcheck; each file observation is retained, without assuming that live logging is frozen.

Whole files are still read, parsed and sorted. Invalid correlation handling stays in the original parse order. Sanitization still occurs before any record leaves the store; the new limit does not authorize raw output or change storage retention. Full-tail/download performance, repeated viewer parsing, event rate, CPU/heap/I/O and natural filesystem failures remain open.

## Actual rendered acceptance

The [normal development receipt](evidence/implementation-found-05-normal.json) uses the existing signed-in account at 1280×720 and a real catalogue movie. Before this change, closing its details retained one zero-size native action/filter. On current source, the same actual panel closes with **zero zero-size native owners**; native rendering returns on reopening, the scoped details menu opens by keyboard and closes without submitting an action. DOM markers prove ownership, not the private map's heap release or GPU/paint/pixel equivalence. The source-controlled regression verifies map rebuild after both width and height become positive.

The real `/settings/activity` view renders 30 diagnostic records; an actual disclosure opens with the safe expected keys and closes. No settings were saved, playback started or domain commands submitted. No framework overlay and zero warning/error logs were observed in the final sequence. Broad check/build operations initially reloaded dev during an interaction; only the later stable sequence supplies final menu/reopen acceptance. An ambiguous generic menu locator and an unavailable AX-role locator were corrected to scoped/actual DOM controls, not counted as app/API failures.

## Verification and maintenance

Focused ownership/storage tests: **17 passed / 0 failed / 281 assertions**. Final canonical suite: **838 passed, 715 guarded skips, 0 failures, 34,207 assertions**. Type/Svelte, build/navigation drift, code/UI inventory and style checks pass. [Gate receipt](evidence/implementation-found-05-resource-gates.json).

The initial broad unit command discovered five archived batch04 test snapshots because `bun test tests` uses a substring filter. Two could not load their external fixture tree. The [failed log](candidates/found-implementation-05/failed-archive-discovery-unit.log) stays retained. The root package script now uses `bun test ./tests`; snapshots and the production dependency set remain unchanged. The canonical script rerun supplies the final 838 result. This is a test-entry-point repair, not removal of maintained tests or suppression of an application failure.

The [source manifest](evidence/implementation-found-05-source.json) and [narrow reversible patch](candidates/found-implementation-05/runtime-owner-changes.patch) preserve the pre-turn state of four runtime/tooling owners, plus current test snapshots. They do not reset the wider dirty tree. `notifications/index.ts` also contains the earlier adopted toast repair; its immutable adoption manifest remains intact, and the later diagnostic-only overlay is explicitly tracked for drift verification rather than relabeling historical toast evidence.

New contracts live in [performance.md](../../performance.md#diagnostic-output-admission-and-hidden-material-resources). Keep full/limited read equivalence, malformed-record fill, equal-time ordering, hidden width/height release/rebuild and shared-owner teardown covered. Preserve actual source epochs and adverse/failed runs. Broader UIS-06/UPP-03 resource measurements remain partial; the 24 open and other known partial records remain in the [active queue](implementation-queue.md). Tasks' history pair stays unchanged under the user's choice. No new-area audit was run.

[Actual diagnostic viewer after the shared admission repair (private verification image)](publication.md#private-verification-images)

[Actual movie menu on the shared renderer (private verification image)](publication.md#private-verification-images)
