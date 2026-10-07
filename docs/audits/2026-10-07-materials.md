# Material layering and usage audit

Scope: shared material presets, runtime, CSS layers, experiment editor and material consumers in the current working tree. Investigation began read-only; the user subsequently authorized material fixes with the plugin/jobs work. The lifecycle and shared compositor fixes below are implemented. Approved presets and radii remain unchanged; all glass materials now own shared hover scaling at the user’s request. No server, database, container or provider state was changed.

## Material inventory

All application glass uses [glass.ts](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/materials/glass.ts:129) and [the shared CSS](/Users/admin/Documents/ChatGPT/coast-new/src/app.css:249). There are four presets, each paired with a CSS blur fallback in [presets.ts](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/materials/presets.ts:117).

| Variant | Enhanced fill / blur | CSS fallback fill / blur | Actual usage |
| --- | --- | --- | --- |
| Clear | Canvas 5% / 2px | Canvas 5% / 12px | Main navigation, hero buttons, media-card primary buttons and persistent playback controls. |
| Light | White 54% / 18px | White 62% / 24px | Reference previews/editor and the Button material API. No explicit production caller currently selects it. |
| Dark | Dark tint 56% / 18px | Dark tint 68% / 24px | Standard buttons and context menus; persistent panels, empty-row badges and glass chart previews explicitly select CSS rendering. |
| Prominent | Accent 48% / 18px | Accent 64% / 24px | Reference previews/editor and the Button material API. No explicit production caller currently selects it. |

The temporary experiment is independent of application presets: directional sheen, edge vignette, masked edge light and pointer/focus sheen. All effect amounts default to zero. Frost variation has been removed. Drafts and preview backgrounds are local to the reference editor; exporting resolves colors and includes the selected material, fallback and optional effects.

Representative consumers:

- [Button.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/components/Button.svelte:45): standard buttons use Dark; hero buttons use Clear. Icon, subtle, compact and menu-row controls do not acquire their own glass action. Menu surfaces use Dark enhanced glass where supported.
- [Dialog.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/components/Dialog.svelte:67): persistent popovers use Dark CSS fallback; modal dialogs use a solid surface. Native top-layer dialog/popover behavior remains intact.
- [Header.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/components/Header.svelte:45): Clear navigation. Account icons are ordinary transparent controls; their menu surfaces acquire materials.
- [MediaCard.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/components/MediaCard.svelte:225): Clear central primary button, lazily enabled on pointer/focus activation. Artwork itself uses a separate overlay border/dimming treatment, not a glass material.
- [PersistentPlayer.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/components/PersistentPlayer.svelte:585): Clear controller container. Transport icons are ordinary controls; option popovers use the shared menu surface.
- [Shelf.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/components/Shelf.svelte:266): Dark CSS-fallback empty-state badge.
- [ChartGallery.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/routes/ui-preview/charts/ChartGallery.svelte:48): eight glass chart styles share Dark CSS fallback. Non-glass styles do not initialize the material action.
- [MaterialTweaker.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/materials/MaterialTweaker.svelte:130) and [Demo.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/routes/ui-preview/Demo.svelte:225): preview override deliberately ignores the personal Liquid glass switch.

Identity and Party cards are solid/image containers, not extra glass variants. Their backgrounds are opacity-adjusted image siblings; text and posters do not inherit that image opacity.

## Verified fixes

### P2: Disabled material actions still installed blur on solid dialogs

Previously `enabled:false` only excluded native refraction. The fallback branch still wrote literal `backdrop-filter:blur(24px)` and material variables. Every solid modal passes `enabled:popover`, so a non-popover dialog acquired an invisible blur and a backdrop-root boundary despite its opaque solid fill. Inactive card buttons also installed fallback blur before they were activated.

The isolated Chromium fixture confirmed a solid action with `enabled:false` computed `blur(24px) saturate(1.2) brightness(0.78)` before the fix.

Fixed in [glass.ts](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/materials/glass.ts:155): explicitly disabled actions remove their optional texture, SVG graph and owned material variables, and set both backdrop-filter properties to `none`. The personal Liquid glass preference remains a separate choice between enhanced glass and its CSS fallback. Existing component design is preserved.

Confidence: high; unit and real Chromium lifecycle checks cover disabled initialization, enabled-to-disabled transitions and reactivation.

### P2: Identical updates rebuilt the native SVG graph

The displacement bitmap was cached, but every render removed and recreated the SVG definition, even when an initial ResizeObserver notification or a paint-only change did not alter geometry or optics. This creates needless native-filter invalidation and allocation around animated surfaces.

Fixed in [glass.ts](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/materials/glass.ts:269): retain the SVG definition when geometry, refraction/depth/dispersion and blur match. Fill, stroke, texture, brightness and saturation still update independently. Geometry/optical changes still rebuild the graph.

Confidence: high; real Chromium and the lifecycle test assert SVG node identity across resize notifications, identical options and paint-only updates, and replacement when optics change. This removes avoidable work; it does not establish a measured whole-app CPU/GPU improvement or prove the reported hover artifact is resolved.

### P3: Closed surfaces retained native SVG definitions

Previously the zero-width/height branch returned without releasing the last native graph. A previously opened menu could retain its SVG primitives after closing until its component was destroyed.

Fixed in [glass.ts](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/materials/glass.ts:254): release the native definition for a zero-sized surface and retain its CSS fallback. Reopening creates the correct graph through the existing ResizeObserver. The cached displacement bitmap can still be reused.

Confidence: high; display-none/reopen checks confirm graph release, fallback retention and correct native restoration. Display-none surfaces do not paint; this is retention/lifecycle cleanup, not evidence that hidden menus previously consumed continuous GPU rendering time.

## Remaining observations

### P3: External stroke blend is exposed but not applied

[glass.ts](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/materials/glass.ts:218) paints external strokes in the lighting layer’s normal-composited box-shadow. [app.css](/Users/admin/Documents/ChatGPT/coast-new/src/app.css:282) applies `strokeBlend` only to the internal-stroke pseudo-element. When alignment is External, that pseudo's stroke width is zero, so changing Stroke blend in the editor has no visible effect on the external ring.

The editor now shows Normal and disables Stroke blend for External alignment, accurately exposing its current normal compositing. A full renderer correction would: render external and internal strokes in the existing stroke layer and establish a deliberate default visual baseline. An isolated attempt to move the external rim into that layer did not achieve pixel-identical default rendering, so it was not retained. The approved appearance remains untouched.

Confidence: high; code-supported and isolated computed-style verified. This is an editor/runtime discrepancy, not an application navigation or data bug.

### P3: Activated media-card filters remain retained after pointer leave

[MediaCard.svelte](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/components/MediaCard.svelte:172) permanently sets its lazy `active` state after hover/focus. The button subsequently hides using opacity, but its layout size remains nonzero. Therefore the zero-size cleanup does not retire this particular graph. Hidden header/player chrome similarly uses opacity/visibility while keeping its dimensions.

Do not infer continuous paint cost from retained DOM alone. Measure filter graphs/heap and GPU paint after a long card-browsing session before adding more observers or pointer-leave logic. Any retirement must preserve keyboard focus, open menus and touch access. A visibility-aware material activation policy could be shared across card and playback chrome if measurements justify it.

Confidence: high for retained state; actual resource cost unmeasured.

### P3: Experimental interaction sheen still updates when reduced transparency hides it

[experimental.ts](/Users/admin/Documents/ChatGPT/coast-new/src/lib/ui/materials/experimental.ts:105) skips motion/touch/zero-amount cases, but not reduced transparency or forced colors. [app.css](/Users/admin/Documents/ChatGPT/coast-new/src/app.css:642) correctly hides effect layers under those preferences; pointer movement can still schedule an otherwise unnecessary layout read/style update while the experimental sample is hovered.

A shared appearance-preference guard could omit those experiment layers and cancel pending interaction work. This affects the opt-in reference experiment only; it does not run on ordinary app cards. No production change was made for this low-impact observation.

Confidence: high for code path; no continuous idle work or visible accessibility regression observed.

### P3: Reference palette copy has a stale material count

The reference palette no longer describes six treatments; its copy describes all glass treatments without a stale count. There are four materials with four fallbacks. The reference layout is unchanged, and historical dated audit counts remain historical.

## Layering and browser conclusions

The material element owns fill and backdrop filtering. Its existing lighting pseudo-element owns the outer shadow and stroke above the backdrop compositor. Its optional grain is an isolated negative-z sibling below content. Insets occupy `::before` at z-index 2, internal stroke occupies `::after` at z-index 3. Both inherit radius and cannot intercept pointer events. Experimental layers also sit below content at negative z-index. Amount zero removes optional texture/effect spans rather than leaving invisible drawing layers.

The material creates an isolated stacking context; that is not itself interchangeable with a backdrop root. Nested backdrop-filter elements, opacity, filters and masks can restrict what an inner material samples. Avoid blanket `opacity`, `filter` or `will-change` on material ancestors. Current profile/card artwork opacity is mostly applied to image siblings, which avoids dimming all foreground content. These relationships are described in the [CSS Filter Effects Level 2 draft](https://drafts.csswg.org/filter-effects-2/#BackdropRoot); its backdrop-root definition is still a draft with engine-specific behavior.

Context menus and dialogs use the native top layer, so their popup positioning is not constrained by ordinary card overflow/z-index. Menu max dimensions and popover-content scrolling keep the surface bounded. Existing shadows are attached to the transformed surface, not independently positioned siblings.

CSS blur writes both prefixed and unprefixed literal filter values, avoiding the documented [Safari CSS-variable regression](https://bugs.webkit.org/show_bug.cgi?id=297620). The optical SVG path stays Blink-only; the [WebKit SVG-backdrop issue](https://bugs.webkit.org/show_bug.cgi?id=245510) and [Gecko SVG filter issue](https://bugzilla.mozilla.org/show_bug.cgi?id=1961378) remain open. Keep that conservative gate until a tested browser pipeline actually supports the required feImage/displacement path; CSS syntax acceptance alone is insufficient.

Reduced transparency switches to a solid fill and disables filtering; forced colors removes decorative layers/shadows and uses system colors. CSS fallbacks keep ordinary lighting/strokes. There is no default noise texture on app surfaces. Unsupported engines do not generate displacement canvases or native SVG graphs.

## Reported card hover shadow

The user’s follow-up identified the enlarging Play/Request primary button and asked for a global correction. The outer shadow and external rim now render on the existing lighting pseudo-element above the backdrop compositor for every `.glass` consumer. No additional wrapper or permanent compositor promotion is introduced. Native and CSS-fallback materials use the same arrangement.

All `.glass` surfaces share centred hover/focus growth, including menus, panels, navigation and controls, as explicitly requested by the user. The material itself owns hover/focus growth and press shrinkage, so its decorations and foreground content inherit the same movement. Independent CSS `scale` and an explicit centre origin move foreground and decorations together. Centred card buttons use separate `translate` positioning so enlargement cannot shift their centre. Global motion tokens define `--hover-grow:1.02` and `--hover-grow-strong:1.08`; scaling uses the shared 240ms motion duration. Pressing a child does not shrink the enclosing glass container. Play/Request and existing playback-control/artwork hover effects use the strong token; other glass surfaces and card artwork use the subtle token. Disabled controls do not scale, and reduced motion suppresses scaling. Header navigation and playback controls also use separate positioning translations to stay centred. Lazy material activation renders immediately before the reveal can paint; ordinary updates remain frame-batched.

The initial isolated trials did not reproduce a persistent detached shadow. Actual browser checks are described below; they support the layer arrangement without establishing every engine’s intermittent compositor behaviour. The user’s affected browser should confirm the original symptom no longer occurs.

## Verification and limits

Browser plugin was unavailable, so existing Playwright CLI and installed Chromium were used. All fixtures are under `/private/tmp/coast-material-audit`; no development server was started or stopped. The source material runtime and card CSS were bundled into an isolated about:blank fixture with a patterned background, native and CSS card buttons, a solid disabled node and adjustable stroke sample.

- Focused material lifecycle tests cover synchronous activation, disable/re-enable, stable graph identity and zero-size cleanup.
- Actual Library keyboard-focus enlargement computes `scale:1.08`, a 29px/29px origin and centre deviation below 0.001px; the icon stays centred. Its native material has no element-level shadow and retains shadow/rim in the shared lighting layer. The page renders with no console warnings or errors.
- Type/Svelte checks pass with zero errors and warnings.
- Real Chromium assertions pass for disabled solid material, optional texture removal, stable graph identity, zero-size release, fallback retention, reopening and personal Liquid glass off/on.
- Native/CSS hover screenshots were captured and inspected; no persistent detached shadow was established.
- No actual Safari/Firefox or mobile-device runtime matrix was run. Their compatibility conclusions use official issue trackers and code inspection, not a claim of full cross-browser visual parity.

[material-runtime.test.ts](/Users/admin/Documents/ChatGPT/coast-new/tests/material-runtime.test.ts:5) preserves the meaningful activation/graph-lifecycle regression behavior without provider or database access.
