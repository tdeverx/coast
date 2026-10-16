# UI consolidation candidates

16 October 2026 · Source audit of `58b8ec2`.

This records the accepted consolidation scope and its implementation. The original recommendations below remain as audit evidence. Preserve the current designs, feature gates, request ownership and lazy loading. Priorities below rank maintenance/consistency value; they are not measured performance gains.

The baseline inventory verified **63 shared components, 28 explicit compositions, 10 internal renderers and 5 delegated routes**. The code inventory reports **no unused modules**. Static zero-consumer entries such as FriendsPanel, NotificationInbox and StreamsPanel are loaded dynamically by the application shell, so they are not removal candidates. A one-consumer component is not automatically unnecessary either.


## Implementation status

Implemented in this change:

- Deleted RowFeedback and the three old chart components; migrated their consumers and reference entries. Operational failures use client-scoped, deduplicated toast delivery with optional retry; an active Dialog owns its visible feedback. The root feedback host also renders for signed-out visitors. Each mounted operation retains its outstanding failure, so resolving or dismissing a newer notice restores the remaining error and its latest retry. Field/native validation and persistent job notifications retain their existing owners.
- Promoted ChartView to the production chart entry point. Real-data adapters preserve chronological buckets, links, community scores and unknown/zero target totals. Standard/extended renderers remain demand-loaded; compact insight cards reuse their chart tokens and marks. No production adapter imports preview fixtures.
- Extracted Toast, SettingsRow and native OperationProgress. The inventory now contains 62 shared components and 27 compositions, with 10 internal renderers and 5 delegated routes.
- Moved Music/Games SSR grids and paging to Shelf without adding catalogue or social requests. Reading history uses Shelf readiness, count, error and page contracts. Shared Button/Field/FormActions replace equivalent local controls without changing their command owners.
- Kept SocialControls media-card heads and card-owned loading. Removed only unused reactions/party options, the WorkMenu trigger alias, list pass-through, QueueList compact option and unreachable Glass demo. PersistentPlayer owns its state scenarios; SyncedControls links to PartyCard presentation while retaining its production controller.
- Updated the playground to the latest user direction: the Customiser is always visible, with vertical scrolling only. The gear, canvas toolbar/title and canvas stroke are removed. The drawer heading contains the section picker and item count, without arrows. Every drawer item has a token-coloured approval check (unknown grey, unapproved amber, approved green); existing records remain unknown unless approval was explicitly recorded. Pattern, colour and uploaded-image backgrounds cover the entire page edge to edge, remain preview-only and release object URLs when replaced or when the page closes. Preview content is centred within the available canvas; outer wrappers do not clip shadows. Production material presets remain untouched.
- Replaced the eight hard-coded partial prop forms with a source-backed Customiser covering all 62 shared components and 384 props. Scalar/enum/nullable/omitted values, snippets, callbacks and structured fixture data reach the real selected component. Two-way bindings update their controls; structured data is validated before application, and an isolated boundary contains invalid combinations. Copy configuration records concrete props, slot choices, handlers and canvas settings. Components without public props say so; controller examples retain synthetic state and no live service writes.
- Prop contracts are extracted during `ui:inventory` into a separate preview manifest; the existing CI check detects drift. The TS parser is tooling-only. The component editor and selected component load on demand, slot/callback identities stay stable during ordinary edits, and only structural mode/source changes remount a specimen. The Charts Customiser also exposes the actual compact presentation option.

Validation:

- `bun run check`: zero errors and warnings. `bun run build`, `code:inventory`, `code:style`, `ui:inventory:check` and `git diff --check` pass; no unused modules were reported.
- Unit suite: 597 passed, 665 database-dependent tests skipped, zero failed. New regressions cover scoped feedback, retry/host ownership, overlapping failures, real chart order/links, zero versus unknown targets, and playback value units. Existing resource/panel/geometry lifecycle tests remain in place.
- Chromium acceptance on a disposable synthetic database at desktop 1440px, 390px and 320px: the earlier inline Customiser toggle (subsequently replaced per user direction), section/count alignment, no page-wide horizontal overflow, background persistence between sections, upload/remove, shared compact SVG rendering and keyboard rating drill-through, and exactly one actionable error toast inside an active notification dialog. The controlled run reported no page exceptions. Earlier refused connections in the runner log came from deliberately stopped fixture servers, not the successful acceptance run.
- The SVG check caught that a standalone ambiguous `<a>` compiled as HTML even with a namespace option. ChartMark now has a static SVG group root; the browser confirmed the SVG namespace and working keyboard links. The compact donut has a card-specific size and separates centre wording from real value units.
- Preview padding has one owner, using the app's responsive gutter for the canvas, Customiser and drawer. Control gaps and drawer card gaps use consistent values; duplicate canvas/demo wrapper padding is removed. After removing drawer arrows, its native overflow rail no longer creates an unused Shelf layout controller.
- Follow-up review fixed duplicate mobile preview padding, scoped integration/automation/rating success messages to their preview client, released closed-panel error/retry feedback, and retained unchanged failures after retries. Canvas changes now go through their state owner rather than mutating unbound props. PersistentPlayer again has a real isolated controller example alongside its state compositions. Focused retry/ownership regressions pass.
- Final in-app-browser review loaded all 24 element and 38 component specimens. Interaction checks covered text/size/menu changes, omitted descriptions, live footer snippets, rejected malformed array data, accepted zero-valued data, and pagination advancing after its callback. At 390px and 320px the button centre matched the canvas centre (within 0.01px), neither page nor Customiser overflowed horizontally, the panel used hidden/auto horizontal/vertical overflow, and the canvas retained visible overflow. A fresh document reported no console warnings/errors; earlier HMR errors occurred while replacing modules and are not a passing-runtime claim. Build/type/inventory/style checks pass; 596 unit tests pass, 665 database tests remain skipped.
- Captures and the acceptance script are local at `/private/tmp/coast-consolidation-*.png` and `/private/tmp/coast-ui-consolidation-qa.js`. The disposable database/server were removed; the regular dev server remains on port 5173. No live service was changed, and nothing was committed or pushed.

Limits: Chromium UI QA is not Safari/Firefox or assistive-technology acceptance. This pass changes no queries/schema and does not claim measured production CPU/latency improvements. Historical validation in the parent audit describes earlier stages.

## Accepted implementation scope

The user's follow-up changes two earlier recommendations: remove RowFeedback throughout the app, and retire the older charts in favour of the shared chart system. The user accepted this section, which takes precedence over the original recommendations below.

### Complete component files to delete

All four are currently under `src/lib/ui/components/`:

| Delete | Replace with |
| --- | --- |
| `RowFeedback.svelte` | Existing action/inbox delivery with one shared `Toast.svelte` presentation extracted from NotificationToasts. Operation failures use error toasts, with retry where applicable. Loading stays with existing skeletons/status; confirmed empty states stay with Shelf/EmptyState. Field validation remains associated with its input. |
| `BarChart.svelte` | Existing `ui/charts/ChartView.svelte`, using its bars renderer. Chronological activity preserves date buckets/order; ranked/distribution data uses the matching bar treatment. |
| `BreakdownChart.svelte` | The same ChartView, using the existing donut treatment (`3A`). |
| `ProgressChart.svelte` | The same ChartView, using the existing target/bullet treatment (`11A`) for known values/totals. |

Remove their imports, legacy preview branches/recipes, manifest entries and obsolete styles with the migration. Retain useful data aggregation, colours/tokens and formatting helpers; they are not old chart components. ProgressBar remains the passive bar used by media cards, the timeline and reader.

ChartView becomes the single production chart entry point. Extend that system for compact DetailCard sizing, links and keyboard drill-through, meaningful selection/summary, unknown versus zero values and completion targets. Production adapters consume the current real query results; they must never import the playground fixture catalogue or manufacture data. Keep selected-renderer demand loading, shared tokens and bounded data. The sample 900px-minimum canvas cannot simply be dropped into an insight card unchanged. Do not retain a second legacy renderer behind a compatibility switch once each caller has migrated.

### Shared presentation owners

| Owner | What it consolidates |
| --- | --- |
| `Toast.svelte` (new extraction) | The existing action/inbox toast surface and operational failure presentation. NotificationToasts remains the delivery host; extend existing feedback for failure severity/retry instead of adding another scheduler. Keep failures visible/actionable in active dialogs, deduplicate repeated failures, and provide isolated preview delivery. Persistent job/service failures continue using existing stored notifications; transient read failures do not create an inbox record on every retry. |
| `ChartView.svelte` (existing, promoted) | All production chart presentation after the three old chart components are removed. Style selection belongs to the shared chart model/renderer, not copied page markup. |
| `Shelf.svelte` (existing) | Music/Games browse card grids, paging and row state presentation, plus the existing reading-history state/paging contract. Preserve current SSR results and source lifecycle. |
| `SettingsRow.svelte` (proposed narrow extraction) | Existing described feature/experiment setting rows: title, description, disabled/prerequisite explanation and trailing control. No settings reads, drafts, policy decisions or writes in the presenter. |
| `OperationProgress.svelte` (proposed narrow extraction) | Existing onboarding/connection import progress, with explicit known/unknown totals and operational state. Preserve native progress semantics and current polling owners. |
| Existing `Button`, `Field`, `FormActions`, `EmptyState` | Equivalent local controls/forms and confirmed empty states. Keep native constraints, action order, geometry and specialized controls. |

### Remove code/options without deleting their production owners

- SocialControls: delete the reaction strip and party-scrolling mode, with their unused props/styles; retain the production media friend-head renderer and Avatar usage. ReactionActions remains the one real reaction control.
- WorkMenu: remove `showMenuTrigger` in favour of `showTrigger`, updating the screen adapter and collection caller. Retain `menuOnly`.
- WorkActions: remove only the `section="lists"` pass-through; WorkListActions directly renders its Button descriptors and remains the list request/membership owner.
- QueueList: remove the unused `compact` prop/class/rule; retain individual job actions.
- Demo: remove the unreachable `Glass` recipe/branch and its imports/sample styles; Materials retains the real editor and all production material/fallback variants.
- Music/Games routes: remove the duplicate grid/card loops and pagination presentation after Shelf adoption; retain their loaders, URLs, search forms and domain-specific states.
- Reading Details: remove the separate history error/paging presentation and false initial-empty branch after the existing Shelf contracts own them; operation failures go through the shared toast path.

### Composition previews

A composition is a demonstration of existing elements assembled into a real feature, such as a media detail page, party, reader or account form. It is useful for testing arrangement and state coverage; it should not become a parallel production UI framework.

Retain useful composition examples. Merge the separate `PlaybackStates` recipe into PersistentPlayer's states. Fold the visually duplicate SyncedControls presentation into the PartyCard scenarios, retaining the real SyncedControls source/controller and its documented usage. Do not duplicate presentation to make a preview: render the real shared components with isolated fixtures, while route-only patterns remain explicit recipes until a production presenter is justified. The four deleted components lose their own preview entries; Toast and the shared ChartView show their replacements.

Still retained: IdentityCard/PartyCard, Avatar/MediaCard, FactList/MetricGrid, ProgressBar/PlaybackTimeline, RowFilter/RowStyleMenu/ChoiceGroup, separate medium command controllers and domain form owners. Administrative summary cards may adopt DetailCard/MetricGrid where the presentation matches, but dense benchmark comparison rows remain dense; no unspecified stats redesign is included in this proposal.

## Recommended replacements and consolidation

The table below records the initial source audit. The revised proposal above supersedes UC-05's RowFeedback adoption and the earlier decision to defer production chart replacement.

| ID | Priority / effort / risk | Candidate | Recommendation |
| --- | --- | --- | --- |
| UC-01 | High / medium / medium | Music and Games browse grids | Replace their route-owned card/grid/pagination rendering with controlled `Shelf` grids. Reuse the existing SSR results and domain URLs; preserve the search forms and distinct connection/empty/error states. Do not create another source request or introduce optional enrichment to a previously unenriched surface. |
| UC-02 | High / small / low–medium | Reading-history loading and navigation | Use the existing Shelf count, readiness, error/retry and page-control contracts. Its custom children currently show “No reading history yet” before the lazy read settles because no `itemCount` is supplied. This is a correctness fix as well as consolidation. Preserve the existing lazy activation and resource. |
| UC-03 | High / small–medium / medium | Ordinary local buttons | Adopt `Button` for the episode watched toggle, screen hero watchlist/favourite buttons, eligible toast close buttons and the sign-out menu item. Header panel triggers also need a narrowly scoped caller-supplied ID capability first. Preserve the existing sizing, selected appearance, anchors, badge placement, form submission and focus. Do not blindly replace specialized chart targets, rating stars, segment controls or the main media-card overlay. |
| UC-04 | Medium / small per family / low | Repeated field and form-footer markup | Use `Field` for equivalent single-input labels and `FormActions` for equivalent submit/cancel rows in reading/game/music commands, planning and schedule dialogs. Keep fieldsets, composite controls, native constraints, action order and disabled/cancel rules in their feature owners. Settings already has a shared `saveControls` snippet; do not replace it merely to increase component usage. |
| UC-05 | Medium / small per family / low–medium | Repeated ordinary error/retry presentation | Use `RowFeedback` where the local alert/status has the same contract. Keep full empty states in `EmptyState` and established empty shelves in Shelf. `RowFeedback` currently ignores `retry` when `tag` is supplied, so reconcile that narrow contract before migrating an alert that combines both. Preserve errors beside their operation and retain settled data on refresh failure. |
| UC-06 | Medium / small / low | `SocialControls` unused production modes | Narrow it to the media friend-head presentation actually used by MediaCard. Its sole production caller always sets `showLabel={false}` and `showReactions={false}`; the party-scrolling mode and reaction strip have no production callers. ReactionActions already owns real reaction reads/writes. Remove the redundant reaction demonstration/options rather than building a second reaction system. Retain the existing Avatar rendering, head limit/overflow and card-owned loading. |
| UC-07 | Medium / small / low | Work-menu trigger aliases | Use one canonical `showTrigger` prop instead of `showTrigger` plus `showMenuTrigger` and the two OR mappings. Update the containing-collection caller and screen adapter together. Keep the separate `menuOnly` contract: it suppresses primary actions and is not an alias for trigger visibility. |
| UC-08 | Low / small / low | WorkActions list pass-through | Render list-membership Button descriptors directly inside WorkListActions and remove the `section="lists"` mode. That mode has one caller and adds no list behavior; WorkListActions already owns the lazy read, paging, membership refresh and empty state. Retain shared rating/social/recommendation/relationship sections and medium-specific controllers. Do not inline those into both screen and catalogue menus. |
| UC-09 | Low / small / low | QueueList compact variant | Remove `compact` and its CSS after confirming the consumer census remains unchanged. No production or reference invocation supplies it. Keep QueueList itself: the administration overview still uses individual job actions. |
| UC-10 | Low / small / low | Unreachable legacy Glass demo | Remove Demo's `name==='Glass'` branch, its recipe, material sample list, now-unneeded import and sample styles. Glass is not a registered reference entry; both public preview hosts validate selection against the registered catalogue. Materials already has its own selected-only editor. Keep the production material presets and their browser fallbacks. |

Evidence and concrete acceptance boundaries:

- **UC-01:** [Music route](../../../src/routes/music/+page.svelte), lines 26–84; [Games route](../../../src/routes/games/+page.svelte), lines 27–94; [Shelf](../../../src/lib/ui/components/Shelf.svelte). The cards already reuse MediaCard; the duplicate is the surrounding page renderer. Keep server filtering/counts before pagination, occurrence keys and card artwork admission. Both routes now have header arrows as well as footer pagination; one shared owner should render the intended controls.
- **UC-02:** [Reading Details](../../../src/lib/reading/Details.svelte), lines 101–106; Shelf's `count`/`loading` and custom-children branches. Verify inactive, cold pending, empty, settled, refresh and failed states; no new observer or eager GET.
- **UC-03:** [episode toggle](../../../src/lib/media/Details.svelte), lines 114–120; [ScreenActions](../../../src/lib/ui/work-menu/ScreenActions.svelte), lines 802–820; [Header](../../../src/lib/ui/components/Header.svelte), lines 76–107; [NotificationToasts](../../../src/lib/ui/components/NotificationToasts.svelte), lines 68–85; [Button](../../../src/lib/ui/components/Button.svelte). Caller IDs must not collide with generated menu IDs. Toast whole-body activation and card overlay geometry are separate contracts.
- **UC-04/05:** [ReadingCommands](../../../src/lib/ui/work-menu/ReadingCommands.svelte), [GameCommands](../../../src/lib/ui/work-menu/GameCommands.svelte), [MusicCommands](../../../src/lib/ui/work-menu/MusicCommands.svelte), [PlanAction](../../../src/lib/experiments/PlanAction.svelte), [JobSchedule](../../../src/lib/ui/components/JobSchedule.svelte), [Field](../../../src/lib/ui/components/Field.svelte), [FormActions](../../../src/lib/ui/components/FormActions.svelte), [RowFeedback](../../../src/lib/ui/components/RowFeedback.svelte). Keep native tables/disclosures and deliberate multi-action confirmations.
- **UC-06:** [SocialControls](../../../src/lib/ui/components/SocialControls.svelte), lines 6–19; [MediaCard](../../../src/lib/ui/components/MediaCard.svelte), line 263; [ReactionActions](../../../src/lib/ui/components/ReactionActions.svelte). The preview currently demonstrates more modes than the app uses; preview usage alone does not justify retaining a production API.
- **UC-07:** [WorkMenu](../../../src/lib/ui/components/WorkMenu.svelte), lines 11–36; [containing-collection caller](../../../src/lib/media/Details.svelte), line 153; [MediaHero](../../../src/lib/ui/components/MediaHero.svelte), line 122.
- **UC-08:** [WorkActions](../../../src/lib/ui/components/WorkActions.svelte), lines 11–32; [WorkListActions](../../../src/lib/ui/components/WorkListActions.svelte), lines 26–28. Preserve membership keep-open behavior and lazy submenu ownership.
- **UC-09:** [QueueList](../../../src/lib/ui/components/QueueList.svelte), lines 17–22, 39 and 107–109; its sole production caller is [Settings](../../../src/routes/settings/[[section]]/+page.svelte). Both the production caller and the reference omit `compact`.
- **UC-10:** [Demo](../../../src/routes/ui-preview/Demo.svelte), lines 10, 111, 122, 231–232 and 383–386; [catalogue](../../../src/routes/ui-preview/catalog.ts); [standalone host](../../../src/routes/ui-preview/demo/+page.svelte). This is a dead branch inside a live module, which the module-reachability check cannot detect.

## Combine selectively, after reviewing the exact presentation

| Candidate | Useful consolidation | Boundary |
| --- | --- | --- |
| Administrative health tiles and benchmark summary facts | Reuse DetailCard/MetricGrid for matching summary presentations, instead of additional local card/value styles. | Current admin tiles contain icons/status styling, and benchmark probe rows are dense multi-value comparisons. MetricGrid's two-column large-value design is not a drop-in replacement for those rows or tables. Preserve units, unknowns, latency comparisons and information density; compare rendered examples before changing presentation. |
| Repeated described settings rows | One small presenter for the existing title, description, disabled reason and trailing control. | Field wraps a label/input and DetailCard adds a different surface; neither expresses this exact existing row. If extracted, the presenter owns no settings loading, policy decisions, draft state or writes. This is a justified missing capability, not a reason for a universal settings framework. |
| Onboarding and connection import progress | One shared operational-progress presentation, retaining native `<progress>` behavior and existing geometry. | Playback ProgressBar always emits a numeric percentage, so it cannot represent an unknown total truthfully. Unknown, queued, running, completed, error and zero-total states need explicit semantics. Do not turn unknown progress into 0%, or add a second poller. |
| Repeated playground views | Group a component's state demonstrations under its canonical entry, with source/usage links for feature controllers. | PartyCard and SyncedControls currently share the same reference renderer; the latter must remain identified as controller presentation, not a live controller test. PersistentPlayer and PlaybackStates also offer overlapping browsing entry points, but the latter has a richer state set. Consolidate navigation/recipes only after preserving scenario coverage and explicit fixture isolation. Production components must not be deleted just because their examples look alike. |

Sources: [admin health](../../../src/routes/settings/[[section]]/+page.svelte), lines 570–590; [benchmark results](../../../src/lib/benchmarks/BenchmarkSettings.svelte), lines 73–80; [settings rows](../../../src/routes/settings/[[section]]/+page.svelte), lines 230–238 and 832–833; [connection progress](../../../src/lib/ui/components/ConnectionCard.svelte), lines 294–303; [onboarding imports](../../../src/routes/onboarding/+page.svelte), line 43; [SocialExamples](../../../src/routes/ui-preview/SocialExamples.svelte), lines 105–127; [PlaybackStates registration](../../../src/routes/ui-preview/reference.ts). The earlier [design-system audit](README.md) records the settings/progress capability gaps as DS-11/12.

## Keep these separate

- **IdentityCard and PartyCard:** simple friend identity/actions versus clipping-aware member rail, invitation header and media footer. They were deliberately separated; a universal card would restore the coupling we removed.
- **Avatar and circle MediaCard:** small identity/status image versus a catalogue card with artwork admission, actions, fallback and card lifecycle. Party members deliberately use the latter. Keep lower-level image policies consistent without merging the components.
- **ProgressBar, ProgressChart and PlaybackTimeline:** passive fill, labelled multi-item completion chart, and seek/read-position presentation. ProgressChart and PlaybackTimeline already compose ProgressBar.
- **BarChart/BreakdownChart and the chart playground renderers:** the production charts support compact insight contracts, hyperlinks and accessible summaries. ChartView accepts a larger style/model experiment with no equivalent row `href` contract. Do not replace the production charts just to reduce file count. A future chart promotion needs approved visuals plus link, unknown/zero, keyboard and bundle parity.
- **FactList and MetricGrid:** label/value rows versus prominent summary metrics. One data-list switch would add modes without reducing meaningful duplication.
- **ChoiceGroup, RowFilter and RowStyleMenu:** radio-choice content, filter trigger/grouping and row-style overrides. They already share Button's menu owner and ChoiceGroup rendering. Keep styles/nullable defaults distinct from ordinary filter values.
- **QueueList, JobSchedule and JobsSettings:** individual job actions, aggregate scheduled-task presentation/editing and queue grouping. Combining them would blur job IDs, task-wide actions and account totals.
- **ScreenActions and CatalogueActions:** continue sharing WorkMenu, Button, work-action sections and submenu resources, but retain medium-specific tracking, editions, requests and playback commands. A single conditional monolith is not an improvement.
- **ProfileEditor, ProfileFeatureEditor and AccountFields:** separate domain forms/validation owners. Share the small elements rather than inventing a schema-driven form renderer.
- **Dialog, NotificationInbox, NotificationToasts and StreamsPanel:** shared container/controls already exist; the feature reads, automatic read-marking, dismissal and stream polling lifetimes differ.
- **Material variants and CSS fallbacks:** four intentional material roles with browser fallbacks are not duplicate elements to delete. No production layer, hover, scale or sizing changes belong in this cleanup.

## Complete component disposition

Every registered shared component is accounted for below. Feature ownership and a small number of consumers are valid reasons to retain a component; these rows do not recommend moving files just to rename their category.

| Family | Components | Disposition |
| --- | --- | --- |
| Foundations and ordinary controls | Avatar, Brand, Icon, Button, ChoiceGroup, Dialog, Field, FormActions, Heading, Pagination, RowFeedback, EmptyState, SegmentedControl | Retain. Increase adoption where contracts fit; only extend demonstrated missing capabilities. |
| Insight presentation | BarChart, BreakdownChart, ProgressChart, ProgressBar, FactList, MetricGrid, DetailCard | Retain distinct roles. Reuse matching facts/metrics/card surfaces; do not promote chart experiments implicitly. |
| Media and playback | MediaCard, Shelf, MediaHero, MediaPage, MediaDetailRows, MediaActivity, PlaybackTimeline, PersistentPlayer | Retain. Replace duplicate surrounding browse rendering, not the shared cards or playback engine owner. |
| Shell and social | Header, ActivityHeader, IdentityCard, FriendRoster, FriendsPanel, PartyCard, PartyMenu, SyncedControls, StreamsPanel, NotificationInbox, NotificationToasts, SocialControls | Retain feature owners. Narrow SocialControls; migrate eligible local controls without changing geometry. |
| Menus and commands | WorkMenu, WorkActions, WorkListActions, RowFilter, RowStyleMenu, Rating, ReactionActions, RecommendAction, RequestDialog, MetadataEditor | Retain shared entry points and command boundaries. Remove the trigger alias and list pass-through; keep specialized rating/reaction behavior. |
| Account and profile | AccountFields, AvatarPicker, ProfileEditor, ProfileFeatureEditor, ProfileRecap | Retain. Single-use profile copy/validation is domain ownership, not proof of dead UI. |
| Administration and providers | CollectionProjectionSettings, ConflictList, ConnectionCard, IntegrationSettings, ProviderAutomation, JobSchedule, JobsSettings, QueueList | Retain. Remove the unused QueueList variant; consolidate only equivalent presentation pieces. |

## Suggested implementation order

1. Remove the confirmed unused branches/variant and duplicate prop: UC-06–10. Keep working production interfaces and default visuals identical; update the reference and inventory together.
2. Address the reading-history contract, then controlled Music/Games grids: UC-02, UC-01. Test cold/refresh/error/empty, filters, back/navigation, stable keys and request counts.
3. Adopt ordinary controls, fields, form footers and feedback by feature family: UC-03–05. Use the existing preview scenarios for side-by-side geometry, focus, cancellation and coarse-pointer checks. Preserve disabled reasons and feature gates.
4. Review the conditional summaries, operational progress and described settings presentation before implementing those extractions. Fold overlapping preview entries together only when the same useful scenarios remain reachable.

No dependency, schema change, new scheduler, generic card framework or production material rewrite is required for the recommended cleanup. Do not promise a performance improvement based on fewer files. Preserve selected-only preview mounting, existing Resource/MenuResource disposal, lazy card/artwork admission, bounded paging and provider request budgets. Consolidation must not create extra requests or start optional work merely by opening a filter or rendering an SSR-ready grid.

## Checks and limitations

Re-ran `bun run code:inventory` and `bun run ui:inventory:check`. Parsed Svelte component invocations and import aliases to inspect consumer props, and manually followed dynamic shell/reference imports and the cited state branches. All 63 registered component names have explicit reference dispatches; `Glass` is the only extra named Demo branch outside that registry. The temporary census lives outside the repository.

This pass changed documentation only. It did not change application components, run provider commands, alter the development/live databases, measure runtime savings or certify new visual replacements. Those checks belong to the implementation steps above.
