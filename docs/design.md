# Coast UI and design inventory

The original Coast project informed this visual language and interaction patterns. This redesign carries forward the established materials and behavior with a fresh implementation.

## Foundations

- Local Inter variable font; black canvas; ink `#f1f3f7`; muted `#b0b7c5`; accent `#b3c6ff`.
- One shared solid surface `#1a1d24`. The palette has nine base colors: canvas, white, surface, primary and secondary text, accent, danger, success and rating. Hover lift, subdued text and borders are derived roles rather than independent colors. White is retained for the designed glass highlights and translucent controls; chart shades and glass tints derive from the same palette.
- Everyday text sizes are 12, 14, 20 and 28px; 34 and 58px are reserved for responsive hero titles. Weights are 400, 650 and 800. Leading uses 1, 1.2, 1.4 and 1.6; tracking is normal, tight or wide. Use the shared CSS tokens instead of adding local numbers.
- The design anchors are row headings (20px/800), navigation (12px/650), card captions (14px/400) and responsive hero titles (58px desktop, 34px mobile).
- Shared control tokens: 36px ordinary controls, 32px compact controls and 44px hero controls. Coarse-pointer controls use 44px targets. Icons use 16px inline, 20px control and 28px primary-action tokens. Row titles use 20px / 800 weight. Keep these in `src/app.css`, not page-specific overrides.
- Production glass matches the reference's 2px frost, 120% saturation, 5% black fill, 0.25px outer stroke and separate top/bottom highlights. The original SVG refraction action is retained, with CSS frost where SVG backdrop filters are unsupported and a solid fallback where backdrop filters are unavailable.
- 160ms feedback, 240ms ordinary transitions, 1100ms cinematic fades; reduced-motion support.
- Full-width content default; optional constrained width. Heroes are always edge-to-edge behind header.

## Reusable components

Use the shared components rather than copying their markup into routes:

Explicit user rule: avoid inventing UI. Reuse the newer approved elements and composition patterns first. Where no existing UI fits, extend the closest approved design and closely match its structure, spacing, typography, colors, materials and responsive behavior. Necessary new or modified visual variants must be clearly labeled **Non-approved** in the UI reference for the user to inspect and decide; do not silently replace an approved design or promote a prototype before review. Preserve approved uses, and remove rejected/superseded variants rather than accumulating duplicate components. New feature behavior alone does not justify a new layout, menu, card, header or control system.

| Pattern | Component |
| --- | --- |
| Page title, description and actions | `Heading` with `variant="page"` |
| Row title, filters, actions and arrows | `Heading` (row, page or title only) |
| Expanded grids with an optional hero | `MediaPage` (only mounts a hero when enabled and supplied with eligible content) |
| Cards and all row/grid layouts | `MediaCard`, `Shelf` |
| Complete arrays with local filters | `Shelf` with explicit `filterBy="type"` or `"watched"` |
| Server-backed browsing and grouped history | `Shelf` with a typed `source` from `ui/shelves` |
| Custom people, episode actions, review panels | `Shelf` item/details snippets |
| Buttons and type filters | `Button`, `RowFilter` with `mediaTypeOptions`, `SegmentedControl` |
| Action menus and entries | `ContextMenu`, `MenuAction` |
| URL-based or local-state pagination | `Pagination` |
| Empty states and dialogs | `EmptyState`, `Dialog` |

`Shelf` is the only row/grid component. It defines the row/grid markup and CSS once, composing the shared heading, controls and viewport activation. `ui/shelves/layout.svelte.ts` owns scroll geometry, observers and artwork choices; `local.svelte.ts` owns finite-array selection and filter links. Both local selection and remote adapters supply the same control descriptors to one renderer. It renders cards by default, or caller-supplied item/details snippets for people, episodes and panels. Explicit `filterBy` enables local filtering of a finite array; the default is controlled rendering. Server-backed sources use typed adapters in `ui/shelves` for queries, state and actions, without additional UI wrappers. Library, Collection, progress, ordered lists, credits, search and journal all use this entry point. Filtering and counts remain on the server before pagination; a controls snippet never changes filtering behavior. Grouped activity uses the same shelf for every date. `ui/shelves/journal-cards.ts` adapts individual events or collapsed episode runs into the same card loop, preserving event identities for selection and source/date notes. `homeShelves` supplies gated music/game source configs.

```svelte
<!-- Finite local data: opt into local filters explicitly. -->
<Shelf title="Related titles" {items} filterBy="type" />
<!-- Paged data: a typed source owns query and tracking rules. -->
<Shelf source={{ type: 'progress', initial: data.progress, layout: 'grid' }} />
<!-- Custom content uses the same geometry through item/details snippets. -->
<Shelf title="Overview" size="panel" artworkOptions={false}>
  {#snippet children(style)}...{/snippet}
</Shelf>
```

`resource.svelte.ts` owns component-local request state, cancellation and retaining settled data while refreshing. Only the latest request may publish data or errors; replacing SSR data or unmounting cancels pending delivery. Supply a domain key when merging: list entry IDs and journal event IDs preserve repeated occurrences of the same work. `lazy-content.ts` handles viewport activation and repeating history sentinels. Provider resources remain independent so one failure cannot discard another provider's results. Credits cache keys include person, scope and filters, with a bounded component-local cache.

`RowFeedback` supplies loading/empty copy and retry presentation using the existing typography and buttons. `RelationshipActions` and `ListMembershipActions` render shared menu entries; feature controllers keep tracking rules, lazy reads and undo behavior. Shared relationships use `relationships.ts`; `mutation.svelte.ts` serializes a menu's writes, refreshes after success, invalidates route data and reports feedback. Artist favourites retain their provider preference path.

`Heading` preserves page and row treatments through an explicit variant and heading level. Primary selection, filters, actions and navigation share one renderer. `browseHeading` supplies the existing media navigation and feature gates. `RowFilter` is the only select-menu component; `mediaTypeOptions` supplies the screen/all-media presets with typed filter values.

`DetailCard` accepts custom snippets or an `InsightContent` model for facts, metrics, bars, breakdowns, progress or text. Pure adapters in `ui/insights` compute domain totals and links without rendering or fetching. `Shelf` can render a `panels` array through the same card. Keep card ordering, UTC/date handling, undated exclusions, rating scales and provider links in these models; async request ownership stays with the feature that loads the data.

Button variants are `primary`, `secondary`, `ghost`, `danger` and `hero`. Disabled links must not navigate, and pagination keeps Previous/Next visible at both ends. Successful menu and job actions use the shared toast; errors remain near the affected controls. Existing player controls retain their transparent styling.

Use sentence case for action labels and section names; use “movies and shows” consistently. Explain empty results in terms of the current filters, rather than assuming a missing connection. Internal provider/job identifiers use `ui/labels.ts` for display. Provider payloads and domain values remain unchanged.

## Persistent composition

Root layout owns the fixed header, persistent title player and `MediaHero` in its persistent playback role. Route heroes use the content role of the same component; `ui/heroes` separates playback lifetime from hero selection, artwork and trailer attachment. Title video sits behind the content; the hero player occupies only the current hero slot. Page content is visible when title playback is paused and hidden/inert while it plays. Both videos keep their positions across route navigation. For You, Discover and details share the hero. Media details show each containing named collection as a shelf of its members, including the current title, in stored order. Named collection cards are omitted from Related Titles; dedicated franchise pages are outside the 1.0 target. The shelf uses existing lazy artwork and media-card actions. History and activity grids omit the hero. Film, TV, game, music and collection-oriented routes share `MediaPage` for the hero and content shell. Progress, list detail, favourites and ratings grids supply a collection hero configuration; disabled heroes do not mount or fetch. Library and personal Collection reuse `Shelf` library source lazy rows, segments, filters and arrows, with View all opening a wrapping paginated grid. Search preserves query and scroll while opening detail quick view, and every item links to a stable details route. Hero slides fade, and horizontal wheel navigation is gated to one item per gesture. Shelves allow vertical visual overflow.

Personal Collection rows show root items, with separate Watch, Listen and Play categories under the existing experimental gates. Filters and counts run before pagination. Audio reuses the persistent media controller, timeline and menus, adding artwork, track/artist, previous/next and queue controls. Audio keeps browsing visible and survives navigation. Audio and title video share one active session and stop each other; existing video navigation behaviour remains unchanged.

Primary navigation uses text-only pills on desktop and mobile; the brand and account controls keep their icons. Keyboard focus, dialogs, empty/error states and mobile layout are part of ordinary implementation. Experimental glass is not part of the stable material implementation. A token/material preview may be added only if useful to maintaining existing components.

All interface icons come from Hugeicons' free Stroke Rounded library through the shared Icon component and official Svelte renderer, with a consistent stroke width of 2. Named imports keep the unused catalogue out of the bundle. Use library geometry for navigation, player controls, menus, rating stars and state indicators; do not draw replacement UI icons. Fill is limited to closed play/pause, heart and star silhouettes: playback symbols default to filled, favourite hearts fill when selected, and ratings fill only when set (including half-star clipping in the menu). Favourite controls use a filled heart when selected. Utility icons remain outlined; existing pills, checks and pressed states communicate selection. Explicit `filled={false}` always preserves the outline. Coast's separate brand mark is the supplied transparent PNG in `static/coast-mark.png`, shown using the shared text colour via an alpha mask; it is not a recreated vector. The header uses a 44px mark without the wordmark, retaining the accessible “Coast home” link; authentication screens keep the wordmark. The same original asset supplies the favicon until an SVG source is available. Existing glass and surface materials remain unchanged.

## Reference material and menu mapping

The stable SVG action lives in `src/lib/ui/materials/glass.ts`. The six shared treatments in `presets.ts` are clear glass, blurred clear glass, glass light, glass dark, blur light and blur dark. Refracted variants use CSS frost when SVG backdrop filters are unsupported; blur variants use CSS frost directly. Colors and repeated font sizes come from `src/app.css`; alpha blends derive from the shared palette. Existing component assignments and the six glass recipes are preserved; their colors come from the shared palette.

| Surface | Production material |
| --- | --- |
| Primary navigation, hero primary action, playback control bar | Clear refracted glass |
| Context menus and nested menus | Glass dark, with its existing refraction/highlights and CSS fallback |
| Hero secondary actions and trailer controls | Transparent icon controls |
| Dialogs, toasts, session and playback notices | Solid surfaces |
| Page content beneath the hero, Library and Search | Persistent black canvas |

Menus use the reference's native popover top layer, 18px corners, shared inset tokens, control-height rows, inline icons and shared hover treatment. Placement flips and clamps to the viewport; long menus scroll. Nested menus close with their parent, ordinary actions dismiss the menu, and rating/volume controls stay open. Arrow keys navigate, Escape restores focus, and outside interactions/navigation dismiss menus. Title menus include the reference's five-star, half-step inline rating control; Add to a list loads its submenu only when opened. Existing tracking, ratings, lists and playback services remain the source of truth.

The measured sliding selection pill, 64px header with bottom navigation below 640px, hero typography and shadows, card hover states, and solid dialogs remain part of the established design. Shared tokens define current sizes; do not restore old reference dimensions independently in a route. Playback chrome follows the same glass, icons and timeline geometry; it and the header fade together after five seconds of inactivity while playing. Pausing reveals browsing content without a separate UI toggle.

## Verification

Inspect the rendered desktop and narrow layouts, typography, primary navigation, hero spacing, glass material, cards, forms, and persistent playback. Use real provider artwork when configured; never present invented watch history or fake provider success as user data.

## Media and people pages

Show pages use a Seasons shelf. Season cards open a dedicated season page with an Episodes shelf; episode cards open their own details. Child heroes identify the show and episode, with parent links below. Keep the existing hero synopsis as the single synopsis; do not reintroduce a duplicate details sidebar or season tabs.

`MediaDetailRows` owns lazy public-provider reads and renders stable Insights (Overview / Your activity / Community), Reviews (All / TMDB / Trakt), and Credits (Cast / Crew) rows. `ui/insights` supplies typed media, profile, community and metadata panel models to `DetailCard`; `MediaActivity` retains its independent request lifecycle. All panels reuse the same chart and detail-card renderer. Provider choices filter locally; reviews append on demand. Ratings retain their original ten-point scale and vote counts. Reviews are plain text and collapsed before reading; missing data is omitted rather than represented as zero. Partial provider outages retain successful sections and allow retry.

The shared shelf links cast and crew to `/people/:tmdbId`. People pages use the credits source for library availability, popular credits and a paginated full filmography, with local type/role filters. Reuse Shelf cards, menus, pagination and materials. Only the visible credit page is materialized in the catalogue, and availability remains user-specific. The provider response cache is bounded and contains no local tracking state.

Opening a show refreshes its details and season summaries, not every episode. A season fetches its own guide when opened; an episode fetches its own credits and details. Collection shelves preserve the existing sequence order. No new production dependencies or database migrations are needed for these views.

Row controls use the shared `Shelf` controls slot between the Previous/Next arrows. Media-type filters are compact semibold text triggers opening the shared context menu; primary view segments stay alongside the title. Continue's availability filter is a play-icon toggle immediately after its segments: outlined means all titles, filled means available only. It exposes its pressed state and explanatory tooltip. Profile progress always includes all titles. Paginated grids reuse the same header controls with Previous/Next page arrows around the filter. Finite grids omit navigation when there are no further pages.

Media heroes keep the show identity across show, season and episode pages, with hierarchy navigation inside the hero. Artwork belongs to the selected season or episode where available; logos fall back to the show. Genre links open the library with a genre filter applied before pagination.

Background jobs are administered centrally in Settings → Jobs. Each integration has one schedule covering its active connected accounts; account-specific queue lanes preserve permissions and ordering. A bounded worker pool allows unrelated accounts to progress concurrently. Members retain connection and conflict preferences, but cannot inspect, retry, cancel or schedule background jobs. Visiting Requests reads stored request state without creating a personal refresh job.

Profile statistics and media progress, facts, ratings and reviews use `DetailCard`, not legacy `.panel` styling. It owns the neutral surface, 1.5px overlay inner stroke, 12px corners, responsive padding, compact heading, value/unit typography and footer spacing. Charts inherit its value/copy tokens and retain their interactive labels and links. Passive detail cards do not use media-card dimming or play hover effects.

`Shelf` uses a media-type filter and availability toggle when local filtering is explicitly enabled. `filterBy="type"` uses the shared text/context-menu picker between the row arrows, with the media kinds present in the source row; `filterBy="watched"` places All/Unwatched/Watched segments by the title. These preserve the row header and height and do not navigate or refetch. Detail pages use type filtering for related/collection titles and watched filtering for seasons/episodes.

The reusable insight system separates surfaces from content: `DetailCard` contains `MetricGrid` for numbers, `FactList` for descriptive metadata, `BreakdownChart` for proportions, `BarChart` for distributions, and `ProgressChart` for completed/total comparisons. `activityChart` adapts the shared watch buckets into timeline bars. Profile genre, watching-mix, rating and activity charts use these components; media pages reuse them for completion, saved playback, per-season completion, community scores and personal viewing activity. Rings expose exact values in their legend, charts support keyboard interaction, and unavailable counts are stated rather than plotted as zero.

Media viewing history is loaded only when Activity is selected, with an abortable period request and the previous settled chart retained during changes. It uses the same `recordedWatches` SQL as profile history, with title/descendant scope, signed-in user isolation, no-op watch deduplication, and explicit rewatches retained. Undated imports appear in all-time totals but never as invented dates on the chart. Provider scores are displayed as scores out of ten, never as an invented vote distribution.

Public Trakt insights use the enabled integration's app credentials, without a personal access token, token refresh or sync job. The shared server cache is keyed by integration/title/page. When Trakt supplies a real rating distribution, render its ten score buckets using `BarChart`; do not infer missing distributions from an average. Community viewer/play/comment/list counts use `MetricGrid`, with missing fields omitted. Reviews remain collapsed with spoiler warnings.

People credit shelves use scrollable department segments from the provider, with a separate All / Movies / Shows menu. Known for retains popularity ordering. All credits uses Shelf’s two-row horizontal layout and appends 24-item pages near the end; header arrows remain persistent. Cached filter selections retain fetched cards, and obsolete requests are cancelled.

Row titles link to expanded grids using the same components and active selections. Media and people pages, discovery, recommendations and profile statistics expose focused `section` views without duplicating their row markup. Availability is server-filtered before pagination for progress, lists, profile favourites and people credits; finite shelves filter locally. History, statistics, reviews, cast, and profile Progress have no availability toggle. Do not add decorative segments where a row has only one meaningful view.

Music details use `ui/pages/music.svelte.ts` to supply commands, metadata panels and album/track cards to the shared `MediaPage`, without a music-specific UI wrapper. Member shelves use the same row/View all grid pattern as seasons and episodes, and the grid retains link pagination. `QueueList` owns the job row renderer and per-job retry/cancel state; `ui/queue.ts` holds its shared action type and waiting assessment.

The permanent UI reference at `/ui-preview` is linked from administration settings and restricted to administrators, including its direct example URLs. Its shared row heading selects Typography, Colors, Materials, Elements or Components through a bookmarkable `section` query. Examples are labeled in a flat layout with separators and load lazily in isolated frames. The catalog partitions the existing inventory into small building blocks and composed components; it does not create production variants. Synthetic API fixtures block writes and navigation inside each example. Only these admin-only example frames allow same-origin embedding; other pages retain their frame protection.
