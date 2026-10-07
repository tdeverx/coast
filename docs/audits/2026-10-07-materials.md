# Material regression and layering audit

## Status

The user reported **new uneven movement inside the Play button material**, introduced during this pass. This is a regression investigation, not a claim that the original material had the same defect.

The regression comparison uses remote main `6682c064679b2771629df5f734c5594e0efe4353` and the material portion of `a3a7d806b99e1a45d4fac8d18e8059fac74e9714`. Provider/jobs and Jellyfin companion work remains intact. The precise source of the reported movement was not conclusively attributed to one layer. The corrected implementation removes the changed shadow placement and independent scale path rather than altering the optical map.

## Corrected implementation on development

- Shadow remains on the material element, top/bottom inset lights remain on `::before`, and internal stroke remains on `::after`. No layer gets its own animated scale.
- Shared glass hover uses a single combined transform, with an explicit centering translation supplied by positioned consumers. Play retains its original 160ms timing and 1.08 growth. Global grow values remain shared tokens. Reduced motion preserves centering and disables growth.
- Displacement maps, channel filters and percentage filter bounds retain their original values.
- Independently verified runtime improvements remain: unchanged graphs are reused, disabled actions have no filter/grain, hidden surfaces release native definitions, and activation happens before reveal.
- Dev Play inspection reports `matrix(1.08, 0, 0, 1.08, -29, -29)`, independent scale/translate both `none`, center offsets below 0.01px, and the original separate shadow/light values. Account menu opens and closes with the expected size and native renderer. No browser errors were recorded during these checks.
- Svelte check: zero errors/warnings. Unit suite: 356 passed, 472 database-dependent skips, zero failures. Production build succeeds. These are not a claim of exhaustive cross-browser animation testing.

## Verified comparison

The local fixture at `http://127.0.0.1:18767/` builds both runtimes and compares:

1. Original runtime, decoration placement and combined transform.
2. Recent runtime, moved shadow/light layer and separate translate/scale.
3. Only the shadow/light placement change.
4. Only the translate/scale change.
5. Only the runtime change.

SVG identifiers are namespaced to prevent collisions. The fixture uses a high-contrast grid and a 58px circular Play button. Optional repeated motion compares scaling alone or scaling with artwork growth and button opacity. These cycles aid visual comparison; they are not a recorded reproduction of the application's pointer timing.

Browser observations:

- Original and recent runtimes generate **identical displacement PNG data and identical SVG filter primitives** for this geometry and preset. No changed refraction, blur, dispersion, filter region or bitmap resolution was found in the pushed patch.
- Repeated scaling leaves filter graph counts unchanged in both runtimes. A DOM filter rebuild on every animation frame is ruled out for this isolated case.
- Reapplying unchanged options adds three original graphs for the three original-runtime samples, but no recent graphs for the two recent-runtime samples. The recent cache works in this case; its introduction alone is not evidence of the movement defect.
- Ordinary Play has one material: fill/backdrop filtering, two decoration pseudo-elements, and optional grain. Default grain is zero. Its artwork ancestor independently grows by 1.02. No experimental interaction/sheens exist inside ordinary Play.

Static screenshots and computed styles do not prove smooth animation. Do not call the regression fixed without reproducing and checking the moving artifact.

## Reverted changes requiring independent verification

| Priority | Change | Consequence / next check |
| --- | --- | --- |
| P1 | Combined `transform: translate(...) scale(...)` replaced by independent `translate` and `scale`. | The compositor follows a different transform path with identical optics. Compare motion-only with the original at normal size, browser zoom and display scale. Candidate cause, not confirmed. |
| P1 | External stroke and shadow moved from the filtered element into `::before` with the inset lights. | Decoration now paints above the backdrop/content rather than on the element. Compare shadow-only over light/dark artwork and edited shadow spread. Candidate cause, not confirmed. |
| P2 | New global scale transition lasts 240ms; artwork still scales over 160ms. | The two boxes settle at different times. Separate timing/easing from transform representation. This later timing change is not established as the original onset of the regression. |
| P2 | Every hovered glass ancestor can grow with hovered glass descendants. | New behavior compounds transforms in menus/panels and controls. Audit nested use separately; standalone Play itself is not nested glass. |
| P2 | Lazy activation became synchronous and explicit disabling removed the former CSS blur. | First reveal changes directly from no backdrop effect to SVG filtering. Check first activation separately from subsequent grow/shrink; a first-reveal issue cannot explain repeated jiggle without evidence. |

Runtime caching/lifecycle corrections, decoration relocation and global hover were bundled together. Any future attempt should reintroduce one independently observable change at a time, retaining original Play positioning and optics until the cause is established.

## Original implementation findings — separate follow-up work

These predate the reported regression and must not be presented as its cause.

| Priority | Finding | Evidence / scope |
| --- | --- | --- |
| P2, corrected | `enabled: false` selected CSS blur instead of disabling the action. | Original fixture reports `disabled` with `blur(12px) saturate(1.2) brightness(1)`. `Dialog.svelte` attaches a disabled action to solid dialogs; `MediaCard.svelte` uses this flag for lazy activation. Personal glass preference and action activation need distinct semantics. |
| P2, corrected | Unchanged updates replaced the SVG graph. | Bitmap is cached but definition is recreated. Fixture confirms replacement and an initial ResizeObserver rebuild. Avoidable work, not a proven continuous motion cause. |
| P2 | Percentage, elliptical and asymmetric radii are not resolved correctly. | `parseFloat(borderTopLeftRadius)` reads `50%` as 50px and considers one circular radius. The 58px Play circle clamps correctly to 29px. A 140px circle uses 50px rather than 70px. |
| P3, corrected | Zero-size/closed surfaces retained definitions. | Hidden original fixture retains URL and graph with a 0×0 box. Allocation retention was observed; continued GPU painting or a permanent leak was not demonstrated. Destroy separately removes definitions after delayed cleanup. |
| P3 | Stroke blend control affects only internal strokes. | External ring is in the element shadow, while blend is on the internal pseudo-element. There is **no duplicated external ring** in the restored baseline. |
| P3 | Hidden experimental interaction still handles pointer work. | CSS hides effects for reduced transparency/forced colors, while JS guards only reduced motion/coarse pointer. Scope is the experiment, not ordinary Play. |
| P3, corrected | Design docs described obsolete materials. | `docs/design.md` still describes six independent glass/blur recipes and the removed patch-frost experiment. Current presets contain four materials with paired fallbacks. |

## Unproven sampling hypotheses

Integer CSS-pixel map dimensions, 8-bit channels, percentage filter bounds and pixel image bounds are unchanged by the regression patch. Earlier pixel-region/high-resolution experiments did not establish a fix and were reverted. Do not increase bitmap sizes or change filter coordinates to mask an unverified artifact.

Browser-engine filter/transform reports do not establish this application's cause. Keep Safari/Firefox CSS fallbacks during Blink testing.

References: [border-radius percentage semantics](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/border-radius), [backdrop filter painting and transform model](https://drafts.csswg.org/filter-effects-2/#BackdropFilterProperty) (draft, not an interoperability guarantee), [WebKit SVG backdrop issue](https://bugs.webkit.org/show_bug.cgi?id=245510).

## Acceptance before restoring changes

- Reproduce the new artifact alongside a stable original in the same browser, zoom and display scale.
- Isolate motion representation, decoration placement, activation and timing independently.
- Preserve approved artwork, lighting, stroke, shadow and centering at rest and during motion.
- Verify native rendering, CSS fallback, first/repeated reveals, reopening and cleanup.
- Keep unrelated jobs/plugin changes outside material rollback or experiments.
