# Coast design-system coverage audit: catalogue and media

Date: 16 October 2026. Scope: current working tree, including uncommitted `codex/row-consistency` changes. Read-only audit; no application files, database, services, branches or publication changed.

## Method and limits

Read `docs/design.md`, `docs/performance.md` and `docs/code-organization.md`; inspected `src/lib/ui/component-manifest.json`, `src/routes/ui-preview/catalog.ts`, the actual `Demo.svelte` recipes and their preview host, then traced production route markup into its feature compositions and shared renderers. Findings describe concrete rendered branches, rather than treating imports or every native HTML element as a component violation. This is source inspection, not a new browser certification: no servers started and no new screenshots, live provider tests or interaction timings collected. Performance concerns below are preservation/acceptance requirements, not measured regressions.

Existing design is to be preserved. Public source-backed routes, private source-backed routes and remote/unimported detail pages have distinct ownership and pagination semantics and must retain them. A native table, details disclosure, semantic form or route layout is not automatically fragmentation. Shared CSS classes (`.notice`, `.table`, `.badge`, `.check`, `.field`, `.overflow`) are part of the existing element system even when they have no Svelte wrapper.

## Summary

Most in-scope production UI already uses the intended system: `MediaPage`/`MediaHero`, `Shelf`, `MediaCard`, `Heading`, `WorkMenu`, `Button`/`RowFilter`/`SegmentedControl`, `DetailCard` and insight adapters. There is no evidence that books/comics/games/music need a competing page/card/menu system.

The strongest implementation reuse gaps are the remaining standalone Music/Games browse grids, raw episode toggle, duplicate form wrappers and Reading history's custom loading/pagination composition. The larger gap is reference coverage: a component can be inventoried without the page/state/medium variants used in production being represented in Settings → UI.

**No indispensable brand-new primitive is established by this scope.** Search-field, person-intro, status-list and tabular-history patterns lack a named complete reference recipe, but existing native elements and components can express them. Add recipes before deciding a new composite is worthwhile. Do not create wrappers merely to inflate inventory coverage.

Priority definitions: P2 = material consistency/state coverage issue; P3 = low-risk consolidation/reference gap. Confidence applies to source evidence, not visual acceptance.

## Findings

### CAT-01 — Standalone Music and Games browse pages bypass the shared Shelf grid renderer

- Priority P2; confidence high; classification **reuse gap**.
- Evidence: `src/routes/music/+page.svelte:59-74` independently renders result counts, `<div class="grid">`, keyed `MediaCard` loop and footer `Pagination`; Games does the same at `src/routes/games/+page.svelte:55-62`. Both independently construct the same header arrow/filter/navigation pattern at Music `:26-31`, Games `:27-35`, then independently branch on errors/empty states (Music `:46-85`, Games `:52-94`). Their cards do correctly reuse `MediaCard`.
- Closest usable components: `Shelf` supports `layout="grid"`, items, title, segments, filter groups, errors/retry, empty snippet and page URL/page count (`src/lib/ui/components/Shelf.svelte:37-83,126-145,202-238`); `Heading`, `RowFilter`, `Pagination`, `EmptyState` already cover the subelements.
- User-facing states: source/account selection; Music artist/album/track; Games local/personal/IGDB; filtered zero results, failed provider, next/last page, narrow screen.
- Smallest safe route: feed the existing route results, URL generation and callbacks into the shared Shelf rendering path. Keep Music/Games source policy and server pagination in their domains; do not replace source pages with local client filtering or force an unrelated Library source. Keep page search outside the shelf where semantically appropriate. If a current Shelf control contract cannot express the existing header, extend the existing descriptor/slot narrowly rather than introducing a second renderer.
- Performance/lifecycle: do not add client GETs to SSR-ready grids; retain source-aware keys, native URL pagination and independent grid image admission; do not invent another queue or social enrichment implementation. Moving into Shelf may add its optional social request, so test admission/gating/request counts and only hydrate visible admitted content.
- UI reference needed: Music browse and Games browse recipes with current route filters, 60-item grid, first/last page, provider error, empty search and unavailable monochrome.
- Acceptance: same URLs/results/order and provider permissions as before; one header/rail renderer; same shared card controls; no extra fetch on opening Filters; no unexpected source query on mount; existing page sizes and keyboard/mobile geometry maintained.

### CAT-02 — Episode watched toggle duplicates the shared icon-toggle control

- Priority P2; confidence high; classification **reuse gap**.
- Evidence: `src/lib/media/Details.svelte:114-120` renders raw `button.icon-button`, local `class:selected`, `aria-pressed`, busy and check icon. This is the episode details snippet inside the shared Episodes shelf (`:95-126`).
- Closest usable component: `Button` exposes icon-only size, pressed, disabled, label, icon and class (`src/lib/ui/components/Button.svelte:10-21,45-49,86-94`). No new primitive is required.
- Smallest safe route: use shared Button for the control while preserving `createEpisodeTracking`, warning/confirmation dialog and exact episode target. Existing pressed color must be compared: the raw control uses `.selected`, Button `.active`; preserve current treatment rather than blindly assuming CSS equivalence.
- Performance/lifecycle: keep the existing mutation controller and serialization; no per-episode menu/read request added by replacing a button.
- UI reference needed: episode card's runtime/rating/watched snippet, unchecked/checked/busy, confirmation-required transition, long overview at narrow width.
- Acceptance: correct pressed state/accessible label, same compact hit target and position, confirmation still protects meaningful watched change, no extra requests before action.

### CAT-03 — Domain forms reuse CSS but not Field/FormActions recipes

- Priority P3; confidence high; classification **reuse gap**, not a missing input/select/checkbox primitive.
- Evidence: list-create raw label/select/input/textarea at `src/routes/lists/+page.svelte:67-94`; delete actions at `:96-115`; manual season fields `src/lib/media/Details.svelte:174-198`; plan date field and submit `src/lib/experiments/PlanAction.svelte:35-48`; reading edition chooser fields `src/lib/reading/ReadingLaunch.svelte:16-29`.
- Closest usable elements: `Field` accepts native input/select/textarea children and optional hint (`src/lib/ui/components/Field.svelte:2-5`); `FormActions` supplies action spacing and optional cancel (`FormActions.svelte:2-6`); `Dialog`, `Button`, global `.check`/`.field`/`.stack` already style these forms. Native `<fieldset>/<legend>` and checkboxes remain appropriate; do not wrap arbitrary grouped choices in one Field label.
- Smallest safe route: adopt existing wrappers where identical, retaining form submit semantics and field constraints. Preserve local special hints/order unless intentionally reviewed; no compulsory generic form controller or new dependency.
- Performance/lifecycle: do not move command state into preview or create eager option requests. Plan friends remain lazy only when party selection is active; reading source search remains explicit and paged; command dialogs remain stable outside menu children.
- UI reference needed: Create list/List versus Playlist; manual season (including specials); Plan with party/friends error; reading local-file versus Jellyfin source chooser, unsupported-format/empty/paged states. Planning remains explicitly Non-approved (`src/routes/planning/+page.svelte:47`).
- Acceptance: labels, hints, browser constraints, enter-to-submit, cancellation and busy/error states unchanged; matching wrapper use and recorded recipes.

### CAT-04 — Reading-history Shelf does not expose its actual count and owns ad hoc navigation

- Priority P2; confidence high; classification **existing composition not represented / reuse gap**.
- Evidence: `src/lib/reading/Details.svelte:101-106` supplies custom children plus `busy`, but no `itemCount`. The children render `DetailCard title="No reading history yet"` whenever the initial array is empty (`:103`), including the first request. Shelf computes custom-child count as null, then loading only when `count === 0` (`Shelf.svelte:101-103`), so this usage cannot activate its shared zero-item skeleton branch. Custom Previous/Next buttons sit below the shelf (`reading/Details.svelte:106`) despite Shelf's page-number/pages/onpage support. Resource itself correctly uses `createResource`, cancellation on identity change and disposal (`:30-34`).
- Closest usable components: same Shelf `itemCount`, `busy`, error/retry/page props, `DetailCard`, `RowFeedback`; no new history-loading primitive necessary.
- Smallest safe route: explicitly supply count and route error/retry/navigation through the existing shelf contract; render empty only after successful settlement. Preserve reading's paged event records and actual work identity; do not convert page turns to activity events or replace it with screen Journal semantics.
- Performance/lifecycle: retain viewport-triggered load, one resource owner, abort on identity/dispose, no eager history GET, no new observers outside shared lifecycle. Review initial inactive state as well as pending to avoid a false empty card before activation.
- UI reference needed: reading history inactive/cold, delayed load, settled empty, history page, error/retry with retained settled data, final-page arrows; progress present/missing/unknown total.
- Acceptance: no “No reading history yet” while a request is pending, shared loading/error/navigation geometry, correct event identity and bounded pages, one request per user page choice, cancellation prevents stale publication.

### CAT-05 — UI reference medium/state coverage does not match production detail compositions

- Priority P2; confidence high; classification **existing variants/compositions not represented**.
- Evidence: UI MediaPage examples offer only screen/music/collection (`src/routes/ui-preview/Demo.svelte:93-97,282-284`); MediaHero fixture is one movie (`:285`); MediaDetailRows is one show (`:280`); MediaCard renders every shape using the same movie plus one friend-activity variant (`:278`). Shelf recipes cover cards/library/progress/list/credits/search/journal (`:98-105`) but not discovery, dynamic For You or upcoming. This does not demonstrate Games and Reading details, season/episode snippets, remote-versus-imported identities, reading/game progress, per-work unavailable/artwork states or read-only guest actions.
- Actual uses: `src/lib/reading/Details.svelte:58-109`, `src/routes/games/[id]/+page.svelte:65-110`, `src/routes/games/igdb/[instance]/[id]/+page.svelte:31-49`, `src/lib/media/Details.svelte:46-164`, `src/lib/ui/pages/music.svelte.ts:35-60`.
- Smallest safe route: add deterministic production-composition recipes/fixture adapters with variants rather than a separate fake layout. Feature-owned `Details` components need not be moved into the flat UI component directory merely to be previewed. Reuse real page adapters where they accept fixture data; provide an isolated preview client for async resources. Clearly distinguish experiment/Non-approved treatments from approved existing screen UI.
- Performance/lifecycle: no live providers/account mutations from preview; one selected/visible example mounts; lazily import heavy/domain examples; all requests through isolated preview client; avoid mounting readers/players just to show their launch controls. Preserve finite fixture limits and current lazy preview host (`PreviewSlot.svelte:5-14`).
- Acceptance: each supported medium and important state has a discoverable recipe link and approval status; same production renderer used, no real account/provider writes, no competing module lifecycle.

### CAT-06 — Important small detail/status compositions lack reference recipes, but are already expressible

- Priority P3; confidence high; classification **existing composition not represented / intentional specialized**.
- Evidence/surfaces:
  - Selected video edition summary/action strip, unavailable edition: `src/lib/media/Details.svelte:50-66`.
  - Request status, destination/4K/seasons/date/cancel: `src/routes/requests/+page.svelte:40-63`; confirmation `:76-101`.
  - Missing/uncertain Library items with reason/date and pagination: `src/routes/library/+page.svelte:41-46`.
  - History selection toolbar and destructive confirmation: `src/routes/media/[id]/history/+page.svelte:89-124,131-154`.
  - Shared friends-on-title text/action rail: `src/lib/ui/components/MediaPage.svelte:69` (three displayed plus exact remaining total).
- Closest usable elements: Heading, Shelf item/details snippet, Button, Dialog, Pagination, RowFeedback, DetailCard, global `.badge` (`src/app.css:493-507`), semantic lists/section text. Request status badge is *already* mapped to shared CSS, not evidence a new Badge must be invented. Missing-demand list contains reason text without full MediaView data, so do not force card hydration.
- Smallest safe route: add composition recipes first and reuse existing wrappers for identical feedback/actions. Record intended specialized plain-text/list behavior; only extract a new composite after demonstrating repeated identical semantics across actual callsites.
- Performance/lifecycle: keep missing-demand promise gated by explicit Show link, retain counts before pagination, exact history-event exclusions and selected snapshot semantics, no extra provider/detail requests per row. Do not expand the friends top-three projection into a full membership read.
- Acceptance: all branches can be inspected with fake, explicit fixtures; no representation of a source/provider failure as successful empty; request cancel and history deletion retain protections and correct target identity.

### CAT-07 — Person biography/header is specialized and unrepresented, not interchangeable with card/avatar

- Priority P3; confidence high; classification **intentional specialized + existing composition not represented**.
- Evidence: `src/routes/people/[id]/+page.svelte:22-56` uses rectangular portrait, page Heading, birth/death definition list, first paragraph and native details remainder, provider credit; local CSS `:73-125`. Credits beneath it correctly use Shelf `credits` source (`:60-66`).
- Closest elements: Heading, native img/dl/details/a, global typography; FactList exists but uses horizontal grid, right-aligned values, separators (`src/lib/ui/components/FactList.svelte:18-41`), unlike the current vertical biography facts. MediaCard adds link/actions/caption and circle-person defaults; Avatar is a circular identity. Neither is a 1:1 replacement for this approved reading-oriented portrait layout.
- Smallest safe route: add a Person intro composition recipe with present/missing/failed image, unknown dates, long biography and narrow wrapping. Keep native semantic HTML. FactList variant or PersonIntro extraction is optional later if concrete repeated use justifies it; no evidence makes a brand-new component necessary now.
- Performance/lifecycle: preserve one above-fold portrait fetch and lazy paged credits; don't fetch person's entire filmography for the preview/header. Native details can remain non-JS.
- Acceptance: approved portrait dimensions/biography readability maintained, actual native summary keyboard behavior, image failure doesn't leave broken UI, credit paging/filtering stays source-owned.

### CAT-08 — Tabular game session history is outside the component viewer, but maps to shared table element styling

- Priority P3; confidence high; classification **intentional specialized / missing reference composition**.
- Evidence: `src/routes/games/[id]/+page.svelte:100-106` renders Date/Time played/Note via native table wrapped in `.overflow`, shared `.table` styling, then Pagination; playthrough picker at `:80-86` is a native select. Shared CSS exists at `src/app.css:541-558`. This is not an unstyled competing card system.
- Closest elements: Heading, native table/th(scope)/td, `.table`, `.overflow`, Pagination, EmptyState; Field/RowFilter where context justifies choice adaptation. A generic data-grid component is not required for this finite read-only table.
- Smallest safe route: document and preview the real table pattern (including long notes/locale dates, no sessions, selected past playthrough, first/last page). Consider existing RowFilter for the selection if user reviews that UI change; do not treat native select as inherently forbidden.
- Performance/lifecycle: retain server-side page bound and selected playthrough identity; no full-history hydration or chart conversion solely for visual uniformity.
- Acceptance: headings/scope and tabular relationships retained; narrow overflow readable without page-wide overflow; same request/page behavior, source/session identity unchanged.

### CAT-09 — Feedback/search CSS elements are not fully represented in the reference catalogue

- Priority P3; confidence high; classification **existing composition not represented**, with narrow reuse opportunities.
- Evidence: page Search icon/input form at `src/routes/search/+page.svelte:96-120,159-178`; Music and Games search form use repeated `.browse-search` style at Music `:32-45,88-93`, Games `:36-51,97-102`. Page-wide `.notice`/`.notice.error` and retry combinations appear Search `:128-130`, Discover `src/routes/discover/+page.svelte:40-42`, Games `:52-53`, Music `:46-48`, screen details `src/lib/media/Details.svelte:67-70`. Global notice is styled at `src/app.css:460-474`; RowFeedback exists (`RowFeedback.svelte:14-18`) and MediaPage already uses it with notice/error class (`MediaPage.svelte:61`).
- Closest elements: native form/input plus Icon/Button/Field; RowFeedback and existing notice CSS. No evidence current system needs a new universal search-field or Alert wrapper before a reference composition exists.
- Smallest safe route: reference the existing search-form variants and Notice info/error/success pattern; adopt RowFeedback where semantics are identical. Preserve full-page global Search's debounced shallow/replace navigation versus explicit GET submit on provider browse: visual sameness must not conflate their domain loading logic.
- Performance/lifecycle: retain 350ms debounce and teardown (`search/+page.svelte:71-86,114-117`), streaming independent provider results and local-first rank, no search per-render. New wrappers must forward native maxlength/name/aria/autocomplete and submit semantics.
- Acceptance: visually inspect icon and plain search forms at desktop/mobile, keyboard submit and loading/error; no changed debounce, cancellation, query preservation or provider request count.

## Coverage matrix

All paths relative to repository root. `+page.server.ts` loaders were not exhaustively re-audited here: this is design/component coverage, not a fresh data/security audit. Specific loader/adapter contracts were checked only to distinguish intentional presentation ownership.

| Reviewed file/surface | Existing mapping and intentional composition | Coverage/gap |
|---|---|---|
| `src/routes/for-you/+page.svelte` | MediaHero; Heading; shared EmptyState/Button; progress/social/upcoming Shelf sources; lazy DynamicFeed | Foundation mapped; page/first-use/dynamic variants need recipes CAT-05 |
| `src/lib/recommendations/DynamicFeed.svelte` | Shelf for every dynamic surface; RowFeedback; existing resource/lazy sentinel | Definition-only visit snapshot; one settled row at true bottom intentionally feature-owned. No second card/row system; recipe absent CAT-05 |
| `src/routes/discover/+page.svelte` | MediaHero/Heading/Shelf/EmptyState/Button/SegmentedControl | Source-backed trending/recent/read section; attribution native text appropriate; notice and variants CAT-05/09 |
| `src/routes/search/+page.svelte` | Heading, Icon, Button, EmptyState and two shared Search shelves | Provider streaming owner intentional; icon-search form recipe CAT-09; available/unavailable mixed-media recipe CAT-05 |
| `src/routes/library/+page.svelte` | Shelf library source rows/grids, Heading/Button/Pagination | Correct shared main render; explicit missing-demand plain list appropriate and unrepresented CAT-06 |
| `src/routes/progress/+page.svelte` | MediaPage collection hero + progress Shelf grid | Shared renderer; read-only profile adapter/context intentional |
| `src/routes/lists/+page.svelte` | MediaPage/Shelf list source/Heading/Button/Dialog | Builtins/custom/playlist occurrence identity intentional; form wrappers CAT-03, selection/ordering recipe CAT-05 |
| `src/routes/music/+page.svelte` | Heading/SegmentedControl/RowFilter/Button/MediaCard/EmptyState/Pagination | Main browse renderer reuse CAT-01; search/feedback CAT-09 |
| `src/routes/music/[connection]/[id]/+page.svelte` | createMusicPage + MediaPage + WorkMenu | Source-specific stable identity intentional, mapped |
| `src/routes/music/work/[id]/+page.svelte` | same Music adapter/MediaPage/WorkMenu; guest context | Canonical/source distinction intentional, mapped |
| `src/lib/ui/pages/music.svelte.ts` | Pure-ish reactive domain page model; sections → Shelf; overviewPanels | Not another rendering component; Music page recipe exists but track/artist/source/error variants incomplete CAT-05 |
| `src/routes/games/+page.svelte` | Heading/RowFilter/SegmentedControl/MediaCard/Button/EmptyState/Pagination | Browse renderer CAT-01; search/feedback CAT-09 |
| `src/routes/games/[id]/+page.svelte` | MediaPage/WorkMenu/Shelf/DetailCard/MetricGrid/ProgressChart/Pagination | Native playthrough select/table intentionally semantic; progress/history recipes CAT-05/08 |
| `src/routes/games/igdb/[instance]/[id]/+page.svelte` | MediaPage/Shelf overview/Button | Remote add/import branch intentional; missing recipe CAT-05 |
| `src/routes/media/[id]/+page.svelte` | dispatches screen `Details` vs Reading `Details` | Thin route; domain distinction appropriate, not duplicate UI system |
| `src/lib/media/Details.svelte` | MediaPage, Seasons/Episodes/collection/related Shelves, MediaDetailRows, WorkMenu/Rating/Dialog/EmptyState | Episode toggle CAT-02, manual fields CAT-03, selected edition CAT-06 |
| `src/lib/ui/components/MediaDetailRows.svelte` | Shelf, DetailCard, FactList, MediaActivity, MediaCard person circle, RowFilter/segments/Button | Reviews native spoiler `<details>` intentional; lazy shared provider consumers appropriate; richer recipes CAT-05 |
| `src/lib/ui/components/MediaActivity.svelte` | resource + mediaActivityPanels + DetailCard/RowFeedback/Button | Domain async owner intentional, mapped; actual activity/error/delayed recipe useful |
| `src/routes/media/[id]/history/+page.svelte` | MediaPage, journal Shelf, Heading/Button/Dialog | Selection history semantics not generic List; toolbar/confirmation recipe CAT-06 |
| `src/routes/media/openlibrary/[externalId]/+page.svelte` | Reading Details delegate | Remote Open Library identity intentional |
| `src/routes/media/comic-vine/[externalId]/+page.svelte` | same Reading Details delegate | Remote Comic Vine identity intentional |
| `src/lib/reading/Details.svelte` | MediaPage/WorkMenu/ReadingLaunch/Shelf/DetailCard/MetricGrid/ProgressChart/EmptyState/Heading | No independent book/comic card/page system; history CAT-04, recipes CAT-05 |
| `src/lib/reading/ReadingLaunch.svelte` | Dialog/Button/native input/select/paged source list | Actual file renderer excluded; chooser form recipe/reuse CAT-03 |
| `src/routes/people/[id]/+page.svelte` | Heading/Button; Shelf credits source; semantic portrait/biography | Intentional composite CAT-07 |
| `src/routes/planning/+page.svelte` | Heading/Shelf/SegmentedControl/RowFeedback/Button/ReadingLaunch | Explicitly Non-approved/experimental; details snippet is domain command composition, not new card system |
| `src/lib/experiments/PlanAction.svelte` | Dialog/Button/native form, lazy friend request | Field wrapper/recipe CAT-03; specialized party selection remains domain-owned |
| `src/lib/experiments/MediaModal.svelte` | Dialog(edgeToEdge), same screen/reading Details, RowFeedback/Button | Experiment; same production detail markup, no loading panel, cancellation, selected-owner lifetime intentional; include recipe, don't redesign |
| `src/routes/requests/+page.svelte` | Heading/Shelf/Button/Dialog/Pagination/EmptyState + shared badge | Status/confirmation recipe CAT-06 |
| `src/lib/ui/components/MediaPage.svelte` | Shared hero/content/section composition + Button/RowFeedback/Shelf | Friends-on-title native text rail recipe CAT-06; don't fetch unbounded people |
| `src/lib/ui/components/MediaHero.svelte` | One content/player component with separate lifetime owners | Specialty hero/video DOM intentional, hero medium states recipe CAT-05; no material changes |
| `src/lib/ui/components/Shelf.svelte` | One default card/panel/journal/custom-child renderer, lazy activation, common heading/filter/layout | Approved baseline; custom children must report count/busy appropriately CAT-04 |
| `src/lib/ui/components/MediaCard.svelte` | Shared lazy artwork/black-and-white/fallback/progress/social/menu/primary action | Custom primary/menu button geometry intentional inside card primitive; don't treat as route reuse gap. Need real-kind/state fixtures CAT-05 |
| `src/lib/ui/components/{Heading,Button,Field,FormActions,FactList,EmptyState,RowFeedback}.svelte` | Inspected prop/markup capabilities to validate gap claims | Existing usable elements; no invented replacement needed |
| `src/lib/ui/shelves/{index,types}.ts` | Typed domain source union + source contract | Source ownership intentional; don't replace every domain with one mega source |
| `src/lib/ui/insights/overview.ts` | Shared typed metadata panel model | Intentional presentation adapter, not competing renderer |
| `src/routes/ui-preview/{catalog.ts,Demo.svelte,PreviewSlot.svelte,demo/+page.svelte}` | Manifest selection, lazy recipes, isolated preview client | Name inventory ≠ composed state coverage; CAT-05/06/07/08/09 |

## Approval distinctions

- Preserve the established movie/show design and existing layouts. No evidence authorizes a redesign or material change.
- Planning explicitly carries “Visual treatment unapproved” (`planning/+page.svelte:47`). Keep that distinction in the UI catalogue, not silently promoted to approved.
- Existing reference marks the Button demonstration “Non-approved” (`Demo.svelte:234`) and friend-activity MediaCard “Non-approved” (`:278`); this is evidence of declared status, not permission to delete live controls. Parent foundation audit should reconcile status metadata centrally rather than infer approval from widespread usage.
- Books/comics/game/music experimental enablement is a feature-policy state, not automatically a visual approval state. Recipes should distinguish “experimental feature” from “unapproved visual variant.”

## Suggested sequence for next phase

1. Preserve current UI and establish reference recipes/state catalogue for existing rendered shapes (CAT-05 through09), with explicit approval metadata and fake fixtures.
2. Fill proven reuse gaps by adapting present wrappers/renderer (CAT-01 through04), retaining domain permissions/query/command ownership.
3. Review recipes with the user. Only then decide whether any repeatedly composed pattern deserves extraction/variant; no unavoidable new component established by this audit.
4. Acceptance: selected recipe only, no live provider writes, real renderer and lifecycle exercised, desktop/mobile + keyboard + cold/empty/error/retained-data states. Test only meaningful changed interactions; avoid a new custom loading or request subsystem.
