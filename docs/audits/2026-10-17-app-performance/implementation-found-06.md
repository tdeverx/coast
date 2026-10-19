# Native Back and pending search intent — implementation batch 06

**Applied at the shared Search controller used by every enabled medium and both result rows.** This advances the existing FRT-01 partial; it does not audit a new area. No dependency, framework patch, provider/query/DTO, schema, design, domain command, commit, push or deployment changed.

## Actual defect and root cause

The [before receipt](evidence/implementation-found-06-before-normal.json) records two natural signed-in normal-dev schedules with the existing Batman catalogue/providers. A slower filter/Back/next-filter schedule recovered. A rapid Albums selection followed by native Back moved the address to Movies while old route data and local intent still described Albums. Choosing Comics then settled at Albums + Comics, resurrecting the cancelled selection.

The installed router suppresses `beforeNavigate` callbacks while another navigation is active. The existing controller used that hook to invalidate local composed URLs, and otherwise fell back to route data. Native history can change the address before that data catches up. The previously adopted framework commit/callback repair does not change this specific hook rule; its dependency/version/maintenance contract is unchanged.

The shared Search controller now owns a native popstate listener for its mounted lifetime. It invalidates old intent revisions/typing work immediately, adopts the same-origin/same-path history destination, and restores an unchanged submitted query while preserving an unsent draft. Its framework popstate callback leaves that boundary to the native owner. Latest navigation rejection also uses the current same-route address for the next composition, rather than stale route data. Late old completion cannot clear a new revision. Unmount removes the native listener and clears intent.

This is the root of both available/unavailable row composition across screen, music, games and reading. It adds no per-medium listener, resource, response cache or renderer. Other URL controllers retain their own contracts; no universal router behavior is claimed.

## Verification

The [final normal receipt](evidence/implementation-found-06-final-normal.json) repeats the actual rapid query/filter/Back/next-filter sequence on the final source at development at localhost:5173, 1280×720. Back restores the submitted Batman query and Movies; Comics changes only the unavailable row. The settled page has 12 actual available movies and 38 actual unavailable comics. All 50 ordered DOM card identities/titles match a fresh canonical load of the resulting URL. No provider response or app state was fabricated/injected; no domain command was submitted. Final warning/error count is 0 and no framework overlay appears.

DOM card projection is not a complete server DTO, provider/transport/SQL count, heap or latency benchmark. Actual providers can update independently. The [earlier native-hook stage](candidates/found-implementation-06/onmount-stage-after-normal.json) is retained separately from the final failure fallback and final-source replay.

The maintained controller regression reproduces native history with stale route data and no framework callback. An additional latest-rejection case failed on the first native-hook repair: the next filter used Album instead of Movie. The current address fallback fixes it. Controls also preserve dirty drafts, fence late promises, preserve independent row/type/default behavior, reject stale streamed publication and verify listener disposal. These held/failure controls are authored; they do not establish naturally occurring provider failures or their frequency.

Final [gates](evidence/implementation-found-06-navigation-gates.json): **839 passed, 715 guarded skips, 0 failures, 34,218 assertions**. Type/Svelte, build, code/UI inventory and style checks pass. The existing eight commit/callback/fork plus thirteen invalidation/cancellation schedules all pass, and navigation dependency drift checks pass. The final canonical suite includes a test-only listener-disposal assertion added after the other common checks; production source did not change for the final replay.

## Drift and remaining work

[performance.md](../../performance.md#native-history-and-pending-filter-intent) documents native history authority, route scoping, draft/failed-intent handling and lifetime ownership. The [source manifest](evidence/implementation-found-06-source.json), exact [one-owner patch](candidates/found-implementation-06/runtime-owner-changes.patch), original controller/test snapshots and final logs preserve source epochs and rollback review without changing unrelated working-tree edits.

FRT-01 remains partial: natural books are absent, local album-title/alias membership remains unaccepted, family subtype overfetch/cancellation and broader resource coverage remain open. This scoped actual navigation defect is repaired; prior claims of universally settled-only acceptance must not be reused to cover other races. The full [known implementation queue](implementation-queue.md) remains active; [unchecked areas](follow-up-roadmap.md) stay deferred. Tasks keeps its explicitly selected query/index pair.

[Actual repaired Movies + Comics search (private verification image)](publication.md#private-verification-images)

The additional-observation overlay is reconciled: LIBRARY-APPEND-OBS-09 now points to the already-applied batch04 bounded repair and keeps its causal/resource gaps. ROUTE-NAV-OBS-02 retains its historical Activity/refresh limits alongside the separate Search proof. TEST-RUNES-OBS-12 records canonical test discovery. No new observation or canonical denominator was added.
