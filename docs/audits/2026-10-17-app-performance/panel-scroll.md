# Expanded detail panel scroll handoff

17 October 2026; source `eb0673873462b71118d1c11678d128958a05ff07`. Diagnosis of the user report: “when the panel scroll is at the top, but still expanded, scroll to shrink isnt working”. **PANEL-01 is reproduced on the actual signed-in normal development application, and a console-only trace confirms that small admitted reverse assignments snap immediately back to160.** Root supplied native-input, DOM and diagnostic observations in `evidence/panel-real-scroll.json`. Temporary diagnostic logging was removed; the Dialog source is restored byte-for-byte to the audited baseline. No implementation fix was applied.

## PANEL-01 — P2: reverse scrolling at the top can fail to return an expanded detail sheet to its smaller presentation

**Canonical owner:** `src/lib/ui/components/Dialog.svelte:44–94,194–208,233–245`. The existing shell uses two vertical scroll owners: an outer expansion track with a160px range, and an inner content scroller enabled once expansion reaches1. `expandSheet` publishes expansion once per animation frame. `handoffScroll` is a nonpassive bubbling wheel listener on the outer track.

The content-first policy is intentional: while inner content has upward travel remaining, the sheet should remain fully expanded. The issue is the transition after that content reaches its top. It belongs in this shared owner, rather than a separate wheel handler in each medium, card, or section page.

### Actual normal-development reproduction

Root first used CUA native scroll input in the normal signed-in application on port5173 and inspected scroll positions/presentation through read-only DOM probes. Viewport was1075×954; fully expanded panel height954. This initial phase used no fake catalogue, synthetic WheelEvent, injected listener or application modification. The page-unit values below describe CUA actions; event deltas were captured separately in the later trace.

| Native input/observation | Outer expansion position | Inner content position | Expanded class |
| --- | --- | --- | --- |
| Open actual detail | 0 | 0 | false |
| Scroll down0.4pages | 160 | 0 | true |
| Scroll up0.02pages at x600,y350 | 160 | 0 | true |
| Scroll up0.04pages, observation1 | 160 | 0 | true |
| Scroll up0.04pages, observation2 | 160 | 0 | true |
| Scroll up0.04pages, observation3 | 160 | 0 | true |
| Scroll up0.5pages | 0 | 0 | false |

This verifies small-input failure at an actually observed inner position0, and shows that a larger reverse input can contract the same shared panel. Root then repeated the native input on a fresh actual title panel at the same viewport, adding only console observations immediately before and after the existing negative `scrollTop` assignment. No CSS or scrolling policy was changed.

| Native input | Captured deltaY / deltaMode | cancelable / prevented after handler | Outer before → immediately after assignment | Inner position | Captured snap policy |
| --- | --- | --- | --- | --- | --- |
| Up0.02pages | -19.0799999237 /0 | true /true | 160 →160 | 0 | `y` |
| Up0.04pages | -38.1599998474 /0 | true /true | 160 →160 | 0 | `y` |
| Up0.5pages | -477 /0 | true /true | 160 →0 | 0 | `y` |

The actual top-boundary branch was admitted, the event was cancelable and prevented, and each small programmatic assignment left the snapped outer position at160 immediately. This confirms the snap/accumulation mechanism for the observed small inputs. Noncancelable latching is **not** the cause of these observations. Other browsers, mixed momentum and all-consumer acceptance remain open. Evidence contains no titles or identifiers.

### What source establishes

| Path | Source and behavior | Evidence limit |
| --- | --- | --- |
| Reverse handoff at content top | `Dialog.svelte:80–84`: if delta is negative and content `scrollTop<=0`, it changes outer `scrollTop` only when `event.cancelable` is true, then returns | Actual diagnostic trace confirms this cancelable/prevented branch for the measured inputs |
| Programmatic travel and snapping | `Dialog.svelte:83` applies each wheel delta through a separate `node.scrollTop` assignment; `:234,243–245` put proximity snapping and endpoints0/160 on that same node | Actual trace confirms small assignments160→160; large assignment160→0 |
| Residual inner travel | `Dialog.svelte:51` pins the outer track back to160 whenever inner `scrollTop>0`; `:63` also expands for keyboard/focus-induced content scrolling | A fractional positive inner offset could look like the top while continuing to suppress contraction. This is a candidate condition, not measured incidence |
| Nested scroll ownership | `Dialog.svelte:74–79` leaves a nested vertically scrollable owner alone while it can consume travel, or when its overscroll policy is contain/none | Necessary containment must survive a fix; do not force all wheel input into the sheet |
| Gesture admission | `Dialog.svelte:70` ignores closed/disposed owners, prevented events, ctrl zoom, horizontal-dominant deltas, and targets outside inner content | Admission is demonstrated for the traced inputs; other target/nested cases remain acceptance |

The initial report kept snap-back and noncancelable latching as competing hypotheses. The later trace resolves that uncertainty for the measured failure: repeated small reverse deltas cannot accumulate because each programmatic move snaps immediately to the expanded endpoint. Noncancelable latching remains a regression case for the shared two-scroller design, not a second demonstrated cause of this defect. Fractional offsets and nested/target admission are additional acceptance cases.

Do not remedy the second hypothesis by unconditionally applying every noncancelable delta to both scrollers. At `Dialog.svelte:86–91`, existing forwarding already updates inner content even when an event cannot be prevented. A native default action may also consume travel depending on the browser's latched owner; a change needs to establish one effective consumer to avoid double movement. This is an acceptance concern, not a separately reproduced defect.

### Actual feature consumers

`DetailOverlay.svelte:11` is the single expanding Dialog wrapper. The normal application mounts it from `media/DetailPanel.svelte:67`, which selects the following bodies at `:71–78`:

| Consumer | Concrete body/source |
| --- | --- |
| Row/section details | `ui/pages/SectionDetails.svelte`, selected at `DetailPanel.svelte:71` |
| Reading work | `reading/Details.svelte`, selected at `:72` |
| Game work | `games/Details.svelte`, selected at `:73` |
| Music work | `music/Details.svelte`, selected at `:74` |
| Reading group | `reading/GroupDetails.svelte`, selected at `:75` |
| Remote game | `games/RemoteDetails.svelte`, selected at `:76` |
| Person details | `media/PersonDetails.svelte`, selected at `:77` |
| Screen work, including edition-specific details | `media/Details.svelte`, selected at `:78` |

Back navigation, edition controls and floating section navigation share that wrapper (`DetailOverlay.svelte:12–19`). The UI catalogue also uses it in `routes/ui-preview/Demo.svelte:277` and `routes/ui-preview/FeatureExamples.svelte:94`. Ordinary Dialogs and notification/friends/streams popovers do not use the expanding handoff. The full Reader dialog is an ordinary wide edge-to-edge Dialog, so a reading detail-sheet regression does not by itself establish a Reader viewport regression.

### Existing tests and their limits

Executed against the current source:

```text
.tools/bun-1.4.3/bun-darwin-aarch64/bun test tests/dialog-geometry.test.ts
Bun 1.4.3: 6 pass, 0 fail, 93 expect() calls
```

This focused suite verifies placement coalescing and teardown, expansion retention/reset, content-first reverse policy, script-level wheel handoff/nested ownership, and queued native-close protection. Its collapse assertions at `tests/dialog-geometry.test.ts:119–122` use cancelable events and large deltas (-80/-100). The fixture replaces DOM geometry/scroll objects with plain JavaScript properties (`:15–25,88–95`), extracting only the component script (`tests/fixtures/ui-script.ts:9–12`). It does **not** execute Dialog CSS, browser scroll snapping, native default scrolling, touchpad momentum, hit testing or browser scroll latching. All six tests passing is compatible with the reported interaction failing.

### Options

**Preferred smallest shared option:** let admitted reverse gesture travel accumulate in the existing Dialog expansion owner without immediately resnapping each individual assignment, then settle through that same owner. Avoid repeatedly deriving the next movement from a position that the browser has already snapped back to160. Select the narrow implementation using the confirmed trace, preserving the approved presentation and content-first policy. Reuse the existing action/frame teardown; do not create per-medium timers or wheel listeners. Disabling all snapping permanently would change interaction and is not the default recommendation. Keep mixed cancelability/native travel as acceptance so that a correction cannot consume input twice.

**Larger option:** restructure the existing shell around one native vertical scroll owner and a sticky expansion stage, so native travel moves through expansion/content without crossing two independently latched scrollers. This can remove handoff complexity but has a greater CSS/geometry, focus, accessibility and mobile regression surface. Choose it only if the smaller correction cannot satisfy the shared browser acceptance contract. It does not require a new production dependency.

### Cross-consumer acceptance

- On actual signed-in normal development data, fully expand, leave content at its top, and shrink using many small reverse trackpad deltas. Show that progress accumulates rather than repeatedly returning to the expanded endpoint.
- In one continuing reverse gesture, scroll inner content to0 and continue into contraction; repeat with a fresh gesture after reaching0. Cover observed cancelable and noncancelable sequences with actual browser behavior.
- Cover fractional offsets, short/nonoverflowing and long detail bodies, viewport resize, reverse direction during a partial expansion, keyboard/focus scrolling and touch/native scroll where available. The sheet must not shrink while content has meaningful upward travel remaining, and must not consume a gesture twice.
- Exercise every feature body listed above, a row/section page, edition replacement, nested Back, floating section navigation and the shared preview. A fix in one screen detail alone is incomplete.
- Preserve nested vertical menu/scroll containment, horizontal rails, ctrl zoom and prevented events. Moving over a different target must not create stale gesture ownership.
- Preserve fresh-open collapse, contentKey navigation's retained expansion, focus return, close/reopen, and cancellation of pending animation frames/listeners on teardown.
- Add browser interaction regression coverage around the actual failing gesture and retain meaningful script-level policy tests. Assert inner/outer scroll and presentation after native frames/settlement; do not satisfy the browser test by assigning `scrollTop` directly or merely dispatching a synthetic WheelEvent without native scrolling.

## Source identity

| File | SHA-256 |
| --- | --- |
| `src/lib/ui/components/Dialog.svelte` | `b47f6f269a93b85265302e346071cad37013343eb1bf4faf516305b43351faaa` |
| `src/lib/ui/components/DetailOverlay.svelte` | `dee4a3b5edb0bc89c63eb7e6f0f6b3eab5c3aba80d5001842392387a87be1118` |
| `src/lib/media/DetailPanel.svelte` | `0c009c71685ac9c48823e927addb7fa3dc558fe8f6af7abe43386473f8dceb70` |
| `tests/dialog-geometry.test.ts` | `6e8d33d2600c3dca230d8f4cdff1627ac2f521800b0444c772f913aef78cbb05` |
| `tests/fixtures/ui-script.ts` | `bffed076c4862b09651002a557ef6fa0fb41792e05687b1a6daa6d0e8195b913` |
