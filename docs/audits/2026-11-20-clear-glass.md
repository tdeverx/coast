# Glass presets and fallback stroke

Baseline `709399681b271ca2a939c4c96b343c2230f9c209`. Clear’s stylesheet defaults and existing material presets now use the confirmed blur, tint, lighting and shadow values. The two presets share their settings with refraction set to 1 on the optical renderer and 0 on the fallback.

Light and Dark inherit Clear. Both use a 3 px blur. Light uses a white fill at 20% and brightness at 110%. Dark uses a black fill at 40% and brightness at 80%. Prominent inherits Light with the theme accent at 50% opacity. Menu divider thickness and frame spacing have their own rule width so they keep their geometry with the external stroke.

An isolated Playwright fixture loaded the shared Coast surface rules and material action with a quarter-pixel external stroke at fractional CSS coordinates. Firefox and WebKit lost opposite pairs of edges depending on device pixel ratio. Chromium painted all four. The CSS fallback now paints the external stroke on the surface with a minimum one CSS pixel of shadow spread and proportional opacity. It keeps the stroke independent of the clipped menu content and keyboard focus outline. Native surfaces use the requested shadow spread directly. The change adds no element, observer, or compositing filter.

The same fixture painted all four fallback edges in Chromium, Firefox and WebKit at device pixel ratios 1 and 2, including on menus with clipped content. It verified the keyboard focus ring, 1 px divider and 3 px frame inset. This receipt covers the isolated surface and preset behavior. It does not advance historical hosted or physical-device acceptance.

An isolated Chromium and Firefox fixture at 390 px and 1100 px verified the Light and Dark fill and filter values and the computed menu divider and frame spacing. It covered the CSS fallback in both engines and the optical renderer in Chromium.

The Materials preview marks all four defaults and their fallbacks approved. Each sample flags local edits as a draft.

The shared renderer applies one surface on mount and reads the selected preset once per render. Default surfaces use the shared preset object directly. The existing per-surface map and SVG identity remain in place. At 32×20 CSS pixels, the approved optical settings take Dark, Light and Prominent from a 62×50 map to a 102×90 map. Clear goes from 124×112 to 102×90. Chromium encoded one 102×90 map on mount, reused it on a same-size Dark-to-Light switch, removed the definition on hide and encoded one map on reopening. These are allocation dimensions and counts, with actual device frame times outside this check.
