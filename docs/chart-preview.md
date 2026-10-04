# Chart exploration in the UI reference

The administrator-only `/ui-preview?section=charts` section implements the 36 explored chart styles through reusable renderers and 256 contextual semantic fixtures. The shared row header labels the gallery **Non-approved · Demo data**. Chart selection does not approve a style or place it in the product.

The four contexts are performance benchmarks, profile/taste comparisons, personal profile statistics and media statistics. Named dataset controls distinguish each A/B source fixture by its actual metric or cohort. Equivalent supplemental encodings retain an A/B suffix without inventing different people or periods. Medium controls are offered only when the fixture supports an appropriate media interpretation. “Original dataset” retains a source's mixed cohort. Supplemental game and music examples describe saves, play sessions, albums and listens using separate fictional fixtures rather than treating episodes as games or albums.

Style, context, dataset and medium selections are URL parameters, so a reviewer can bookmark an example and use browser history. The gallery follows the UI reference's existing `goto` navigation convention and reads the URL exclusively; stale shallow-route state cannot override a deep link. Compatible medium selections survive style and context changes. Hovering or tapping a mark selects its exact value. Previous/next controls and the exact-data table support keyboard inspection. Dense charts scroll within their own region on small screens; tables show at most 24 rows per page.

The selected plot is centred at its native coordinate width, with units and any declared period directly above. Exact data, meaning, counts and preview instructions are collapsed. Browse styles is a single horizontal rail of static SVG thumbnails, ordered by family and filterable by family or name. It reuses the shelf layout controller, spacing, arrows, scroll boundaries and reduced-motion behavior. Thumbnails are decorative illustrations of encodings, not live charts or the selected data.

## Families and data meaning

| Styles | Renderer family | Encoding |
| --- | --- | --- |
| 1A–1C | Timeline | Line, area, additive stacked area |
| 2A–2C | Bars | Ranking, additive stacks, signed differences |
| 3A–3C | Parts and capacity | Disjoint donut/pie shares, independent numerator/denominator rings |
| 4A–4C | Calendar and matrix | Seven weekday rows, monthly circles, day/hour cells; unknown differs from zero |
| 5A–5C | Comparison | Scatter, common-domain radar, set overlap with exact counts |
| 6A–6C | History and benchmarks | Sample interval, median/IQR history, before/after slopes |
| 7A–7B | Distributions | Equal-width histogram bins and frequency profiles |
| 8A–8B | Ranked tables | Values and trends with shared sparkline domains |
| 9A–9B | Events | Date-scaled event and season timelines |
| 10A–10B | Treemaps | Proportional flat and hierarchical rectangles |
| 11A–11B | References | Actual values, declared capacities and reference markers |
| 12A–12B | Funnels | Cohort stages and stepped retention |
| 13A–13C | Bubbles | Proportional circle areas with playful, editorial and packed arrangements |
| 14A–14C | Other displays | Conserved alluvial flows, linear monthly radial counts, exact isotype units |

Semantic fixtures are authoritative. Generated raster coordinates, approximate shapes, missing calendar rows, incorrect unit symbols and mislabeled references are not copied. Annual raster examples without daily numeric fixtures use explicitly disclosed deterministic supplemental fictional daily samples. Fictional benchmark datasets are not performance measurements. Temporal examples disclose their period and timezone; missing dates are excluded rather than converted into zero activity.

Ratings retain the native 0.5–5 half-star scale. Taste agreement signals are independent scores on 0–100 with evidence counts; insufficient evidence remains unknown. The app's rating/genre/reaction/interest weights remain 40/30/20/10, renormalized across qualified signals. Shares, overlap counts and ratings differences do not become agreement scores merely because they use the taste context.

## Loading and isolation

All chart code and fixtures live under `src/routes/ui-preview/charts`. The UI reference dynamically imports the gallery only for the Charts section. Renderer chunks load on demand; only the selected chart mounts. Fixture models and geometry are cached or derived from stable model inputs, separately from selection state. There are no provider calls, persistence writes, chart polling, chart timers or new production dependencies.

The gallery reuses Coast's Heading, SegmentedControl, RowFilter and Button components and the shared palette, font scale, spacing, sizing and materials. Chart coordinates, radii and plotting dimensions are numeric geometry, not new app design tokens. Glass styles use the existing CSS glass renderer to avoid generating a large displacement bitmap for a plotting surface; controls retain their normal existing material behavior. The chart renderers use no motion, and shared controls retain the app's reduced-motion support.

`bun run check`, the chart semantics/geometry tests, `bun run ui:inventory:check`, `bun run code:inventory` and `bun run build` verify the implementation and boundaries. Browser review covers the gallery controls, point inspection, meaningful desktop/mobile layouts and console health. No live provider journey is implied by this preview.

Performance verification: chart models are reused for all 853 supported fixture/medium combinations, only the selected renderer mounts, Browse uses static SVG thumbnails, and the exact-data table is capped at 24 rows per page. Label wrapping is cached per model and table sparkline paths are derived independently of selection. The shared shelf controller disconnects its resize/mutation observers and cancels pending animation frames on unmount; chart material actions also clean up. There are no chart polling loops, persistent timers or provider requests. Isolated browser checks verified selection, bounded table rendering, removal on leaving Charts and a clean console. These structural checks do not establish production CPU/heap benchmarks.
