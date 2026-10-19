# Shared UI implementation: resolved detail lifetime and panel handoff

17 October 2026. Implements LIVE-01 and PANEL-01 against audit baseline `eb0673873462b71118d1c11678d128958a05ff07`. Baseline reports and evidence are unchanged. No dependencies, schema, commits, publishing, provider exports or live job mutations are part of this change.

## LIVE-01: one resolved detail snapshot owns its outgoing payload

`src/lib/media/DetailPanel.svelte` now publishes `{href, detail, enhancement}` in one raw state assignment. Its keyed singleton item owns that matching discriminator/payload while mounted and through teardown. Component prop getters read that item, rather than the newly shaped outer union. Identity includes href and discriminator; equivalent same-target refreshes update the mounted presenter. A pending destination still leaves the prior coherent view inert/busy. Viewer replacement, close and authoritative permission/feature failures still clear resolved state; aborted responses/imports cannot publish. Screen enhancement belongs to its resolved snapshot and remains bound to its request controller.

The repair is at the shared shallow-detail owner. It covers SectionDetails and every selected screen, reading, game, music, reading-group, remote-game and person presenter, including their Shelf/section-host reads. Shelf's fixed-family contract is preserved; there are no optional-preview fallbacks, per-medium exception handlers, delayed replacements or new caches. Direct full routes remain their existing owners. Active player/reader visibility and edition controls retain the existing wiring.

## PANEL-01: admitted reverse movement accumulates before settling

`src/lib/ui/components/Dialog.svelte` keeps one action-owned gesture position. During admitted cancelable reverse travel at the inner top, it temporarily suspends native snapping, accumulates deltas and publishes presentation through the existing animation-frame owner. After 120 ms without another owned delta, it settles toward the last movement's existing endpoint and restores the original snap property. A direction change remains owned during that gesture. This is a gesture-inactivity timer within the existing action, not a separate per-medium scheduler.

Nested vertical containment is checked before taking movement. Horizontal/zoom/prevented/outside events release ownership. Noncancelable events release an active programmatic gesture and keep native outer travel rather than applying the same delta twice. Existing content-first forwarding remains in place. A half-pixel top tolerance avoids treating a fractional residual as meaningful inner travel. Navigation, close and action/component teardown clear timer/snap ownership; stale callbacks cannot settle a newer gesture.

All expanding detail consumers share this Dialog through DetailOverlay: sections, screen/edition, reading/group, game/remote-game, music and person details, including Back and preview wrappers. Ordinary dialogs/popovers have no handoff action and retain their existing behavior. No visual restyle was made.

## Focused verification

| Check | Result | Boundary |
| --- | --- | --- |
| `bun test tests/dialog-geometry.test.ts` | 8 pass, 0 fail, 128 assertions | Actual Dialog script/runes; controlled geometry and immediate-snap model. Covers original policies plus small reverse accumulation, reversal, fractional top, nested containment, mixed cancelability and stale/closed/disposed settlement. This does not execute browser CSS/default scrolling. |
| `COAST_TEST_BROWSER=1 bun test tests/detail-panel-lifetime.test.ts` | 3 pass, 0 fail, 19 assertions | Actual production DetailPanel compiled template in installed headless Chromium; inert transport and strict outgoing-presenter teardown reads. Seven detail and seven valid section families, outgoing section-host reads before disposal, Back, pending/abort/close, same-target refresh, permission failure and viewer replacement. This is a correctness fixture, not actual-data performance evidence. |
| Default browser-test guard | 3 explicitly skipped without `COAST_TEST_BROWSER=1` | Ordinary unit runs do not launch/install a browser. Existing Playwright dependency/runtime is reused. |
| Actual normal-development CUA journeys | Original LIVE-01 and PANEL-01 target journeys passed | Signed-in actual Library Listen section with 50 items → music detail → Back restored section, zero console errors. Native 0.02-page reverse input contracted outer/content 160/0 → 0/0. Inner-content-first behavior also passed; broader matrix remains open. |

A temporary read-only copy of the audited DetailPanel was compiled through the same strengthened outgoing-host fixture: its first replacement test failed with `TypeError: Cannot read properties of undefined (reading 'type')`. The fixed source passes all three tests. This verifies that the regression exercises the lifetime failure rather than only testing a successful mount; the controlled host checks the same fixed-family invariant, while actual normal-dev acceptance remains separate.

The isolated browser launch hit macOS sandbox Mach-port permission denial on the first attempt and passed with the normal local-process escalation. It used `about:blank` and local fixture code, with no live application, database or provider connection. No broad build/check gate was run by this owner; the coordinator owns combined source validation after parallel edits settle.

Coordinator evidence: [actual normal-development acceptance](evidence/implementation-normal-dev.json). While inner content was at 477, small reverse input moved it to 458 with outer expansion retained at 160. A larger reverse gesture brought content to 0 while outer remained 160; the next 0.02-page reverse input contracted it. These are native-input observations on actual application content, not direct scrollTop assignments. This closes the original reproduced target journeys; it does not certify all media/families, mobile/touch, mixed cancelability or long-session behavior.

Use the repository Bun runtime for the commands above: `.tools/bun-1.4.3/bun-darwin-aarch64/bun`. Re-run the browser suite explicitly where the installed Playwright browser is available; its guard is not a passing runtime check. Actual acceptance must preserve approved presentation, focus, filters/loaded position, Back/Forward, edition and active playback/reader ownership, and zero stale-private-data publication.
