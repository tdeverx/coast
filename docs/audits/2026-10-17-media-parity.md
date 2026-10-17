# Non-screen media presentation and workflow audit

17 October 2026 · Baseline `e35720c` (PR #36).

Scope: saved and provider-backed music, artists, games, books and comics; their detail loaders, hero/card adapters, menus, related navigation and UI reference recipes. Movie/show details are the interaction and visual reference. This is an audit and implementation plan: no production code, database, user preferences or live sessions were changed.

## Evidence and boundaries

- Read the production detail routes, `MediaPage`, `MediaHero`, `WorkMenu`, catalogue commands, presentation adapters, reader launch/session paths and shared shelf contracts.
- Used the in-app browser against development on `http://192.168.0.18:5173`, at its existing 1280×720 desktop viewport: Library → 1989 album → Taylor Swift artist; Library → 7 Days to Die → its context menu; isolated reading-launch reference → Read → edition chooser. Settled pages had meaningful content and no relevant console warnings/errors in the captured logs. Screenshots were inspected for layout; this was not an exhaustive responsive or cross-browser acceptance run.
- Album and artist pages were actual development catalogue/provider routes. The reading chooser was the production component using the isolated reference's synthetic transport. Book/comic detail findings below are source-backed; the development catalogue had no saved reading titles. The reference detail recipe is not proof of actual reading/game route parity (MP-11).
- Earlier read-only live inspection confirmed 12 imported comic works. The deployed Library query returned 12 cards with `scope=all`, zero with `scope=available`; no per-user reading availability was present then. The user subsequently confirmed the titles are visible. This audit does not classify the prior empty screen as an unresolved importer failure.
- Did not play media, open real files, edit progress, change feature choices or run a live sync. Focused existing checks passed: 13 tests, 98 assertions across `music-presentation.test.ts`, `reading.test.ts`, `games.test.ts` and `reading-navigation-lifecycle.test.ts`. No full build, database suite or performance measurement was run for this source-only audit. Passing unit checks are not evidence that these detail-page presentation gaps are covered.

## Findings

All items are deduplicated. P2 means a functional, data/presentation or substantial consistency gap; P3 means lower-impact presentation/reference drift. There is no confirmed authorization bypass in the button-gating findings: server enforcement remains separate.

| ID | Priority | Finding | Smallest route forward |
| --- | --- | --- | --- |
| MP-01 | P2 | Read ignores known file mappings and always asks for another search. | Resolve the user's linked supported source first, revalidate permission/version, then open; chooser only for ambiguity or no source. |
| MP-02 | P2 | Read / Start reading / Resume reading describe different operations too similarly. | One reader primary action; explicitly named tracking action; deduplicate page actions. |
| MP-03 | P2 | Custom detail actions bypass the capability/pending-state presentation used by menus. | Share action eligibility and operation state between hero, card and menu. |
| MP-04 | P2 | Canonical music detail hydration drops child artwork and personal listening state. | Hydrate the bounded selected page through a shared presentation read model. |
| MP-05 | P2 | Availability changes meaning or disappears between browse cards and details. | Reuse viewer-scoped availability projections; separate ownership from opening a source. |
| MP-06 | P2 | Artist metadata is rendered with album/track labels. | Kind-aware facts and duration presentation. |
| MP-07 | P2 | Supplemental detail data does not follow one lazy-loading/navigation contract. | Selected, bounded, abortable section sources; retain shared Shelf pagination. |
| MP-08 | P2 | Reading source picker has no request/context lifetime protection. | Use existing abortable resource owner; cancel on close, target and connection changes. |
| MP-09 | P3 | Main actions, section names and history presentation differ despite using shared elements. | Compose existing elements through one detail-page contract with medium-specific data. |
| MP-10 | P2 | Legacy music/game browse navigation omits Read and ignores other medium gates. | Derive available destinations from effective capabilities, including Read. |
| MP-11 | P2 | UI reference detail recipes can conceal production-page gaps. | Reuse production composition owners with isolated fixture adapters. |

### MP-01 — Reader opening is disconnected from imported sources

`src/lib/reading/ReadingLaunch.svelte:11` resumes an already-open singleton for this work; otherwise it opens a dialog, fetches connections, selects the first connection and fills a search input with the metadata title. It never queries `work_editions` or the known provider-item mappings. No lookup happens until the user presses Search. This is true even when import has already linked the exact file. Verified by opening the connected reading-launch reference.

`src/lib/reading/sessions.server.ts:38` searches the connected account's entire Book catalogue by a text query. The selected work ID is used for permission/gating, not to constrain candidates to existing file links. Comic Vine story titles can differ from Jellyfin series/issue filenames, so prefilled title search is particularly unsuitable as the normal flow. Arbitrary file choice is useful for an explicit manual link, but should be secondary.

The existing party-only `matchingReading` resolves linked editions for a supplied edition hash, but regular Read does not use an equivalent resolver. Reuse its account-scoped permission/version principles; do not call it with a fabricated edition hash or equate catalogue metadata with file permission.

Desired behavior:

1. Active matching reader: **Continue reading** restores it.
2. One supported linked source: **Read** opens it after current Jellyfin permission, generation, format and version validation.
3. Multiple sources: show the known sources in the existing chooser, with a remembered/resumable edition preferred where evidence exists.
4. No supported linked source: explain that state and offer **Choose a file** / explicit linking. Unsupported CBR metadata must not promise that its file can open.

Local file bytes deliberately do not persist on the server. Reopening a local file can legitimately require selecting the file again; that is distinct from unnecessarily searching an already-linked Jellyfin item.

### MP-02 — Reading labels conflate file access and manual tracking

`src/lib/reading/Details.svelte:58` renders **Read** and **Start reading** together. The former opens an edition; the latter opens the progress editor, without opening any content. The hero repeats progress controls that also appear in the Reading progress heading and empty state (`:79`, `:100`). `CatalogueActions.svelte:150` uses **Resume reading** to change a paused/dropped tracking state, while `ReadingLaunch` restores a reader through another action.

Keep manual tracking for physical books and external readers. Label its editor **Update progress** or **Track reading**; reserve Read / Continue reading for opening the reader. File-source choice belongs behind the reader action or a secondary source menu. Use the same wording and behavior from cards, hero and menu.

### MP-03 — Custom buttons drift from gates and mutation state

- `src/lib/ui/pages/music.svelte.ts:35` emits Play/Continue whenever `canAct()` and `item.workId` are truthy. The real saved route supplies only signed-in status as `canAct`; the source route uses the default true. Neither considers `capabilities.playback`. The catalogue menu does check it (`CatalogueActions.svelte:118`).
- `src/lib/reading/Details.svelte:59` mounts the direct ReadingLaunch without checking `capabilities.reader`; the corresponding menu entry checks it (`CatalogueActions.svelte:122`). Reader-off should retain manual tracking and hide the file-opening action.
- Reading/game hero buttons delegate to `WorkMenu` but disable using a separate page operation's `busy`. A progress mutation's actual pending owner is `ReadingCommands`/`GameCommands`, so the visible hero does not reliably reflect that pending operation.
- `src/routes/games/[id]/+page.svelte:109` renders an empty-state Start playthrough button for guests, although the menu instance is only mounted for signed-in users. Its optional-chain handler does nothing. The hero correctly offers Sign in to track.

This is a UI contract defect, not permission to remove backend validation. Extract common eligibility and command status from the existing command owner; keep media-specific operations in their domains. Verify reader/playback off, guest, pending, error and policy withdrawal states.

### MP-04 — Saved music detail rows lose data already shown elsewhere

`src/routes/music/work/[id]/+page.server.ts:18` constructs MusicItems from canonical rows without artwork, progress or favourites. It separately resolves artwork for the main item only (`:22`), and progress/state for that main item only (`:19`). Child items built at `:31` receive credits and track/disc indices but no ordinary artwork or listening-state hydration. Personal artwork overrides may fill an image, but ordinary imported child images are omitted.

Consequences: track cards below a saved album can show fallback art, lose their progress bar or lack the Continue behavior that is present in other contexts. The source-backed detail path uses richer provider items and therefore behaves differently. The saved route also omits ordinary backdrop hydration, using the shared hero's cover fallback instead.

The bounded read model should return ordered membership plus viewer-scoped images, credits and personal state for only the selected page. Reuse existing catalogue/music hydration where possible. Do not fetch each track from Jellyfin or reintroduce per-card I/O. Preserve repeated track entries and disc order rather than deduplicating by work ID.

### MP-05 — Catalogue presence is presented as availability

- `src/lib/music/presentation.ts:38` declares every album/track available, regardless of whether it came from an authorized provider observation or a saved canonical catalogue row. A shared canonical item with no accessible source can therefore have a Play action and full-colour availability presentation. A known work ID is not evidence of current file access.
- `src/lib/core/games/service.server.ts:68` returns canonical metadata and Steam state but not the `ownedGameAvailable` projection used by `listGames`. `gameHero`/`gameCard` default missing availability to false (`src/lib/games/presentation.ts`). Owned-game browse and detail presentations can consequently disagree, including the ownership subtitle. Ownership still must not imply installation or a launch command.
- `readingDetails` does not supply availability/source state (`src/lib/reading/query.server.ts:39`). Its hero/menu card is constructed with `readingCard`'s default `available:false`, whereas `readingCards` hydrates viewer availability for browse rows. The file action is then offered independently of availability (MP-01/03).

Use one effective viewer-scoped availability projection per medium across browse, detail and action adapters. Preserve uncertainty, unsupported formats and permission revalidation. The unavailable-poster preference already lives in the shared card; feeding it inconsistent data defeats that consistency.

### MP-06 — Music needs kind-specific facts

Observed on the actual Taylor Swift artist page: Details shows **Released: 1989-12-13** and **Duration: 0:00**. `src/lib/providers/jellyfin/music.server.ts:84` maps PremiereDate/RunTimeTicks generically; `src/lib/ui/pages/music.svelte.ts:23` presents those fields as release date and duration for every kind. The artist date should not be asserted to be a media release. Label a verified birth date appropriately or omit it when its meaning is not established; omit meaningless duration.

`musicHero` rounds seconds to whole runtime minutes (`src/lib/music/presentation.ts:55`), while the details use m:ss. Short tracks can show no hero duration or a misleading rounded duration. Retain an appropriate music duration display without changing movie runtime semantics.

### MP-07 — Lazy section and pagination parity is incomplete

The source-backed music loader waits for the first album/track child page before returning (`src/routes/music/[connection]/[id]/+page.server.ts:29`). It does this even for `?section=insights`. The saved music loader also counts and hydrates album members for every section. The game loader fetches the selected playthrough's session history before the history is visible. In contrast, film/TV supplemental detail rows use selected, cancellable resources activated by their visible sections; reading history already uses the shared resource/lazy approach.

`MediaPage.svelte:65` renders supplied section arrays; it does not make their upstream loading lazy. In a horizontal music Tracks/Albums row, a server child-page total greater than one is supplied to Shelf, but automatic append is not configured; the row's right arrow scrolls the current page and the remaining pages require View all. This is bounded and safe, but differs from demand-paged rows elsewhere. Game and reading overview/progress headings also lack section links and selected-section routes, while music and film have them.

Use the existing Shelf source/resource system for bounded supplemental sections. Keep hero metadata local and fast; defer offscreen child/history work. View-all routes must load only their selected section. Define horizontal paging consistently and append only after the current page, preserving entry identity and scroll position. Do not add an alternative scheduler, cache or scroll algorithm.

### MP-08 — Reader picker request ownership is incomplete

`ReadingLaunch.svelte:11` and `:12` use a guarded operation but no AbortSignal, target key or destroy/close cancellation for connection/source requests. Closing the dialog does not cancel requests. Changing connection clears visible rows but an old response can publish afterward. Reopening the dialog while the prior operation is busy resets state, while the operation guard refuses the replacement request. Offset/nextOffset and connection state are also not fully reset on each target change.

Keep provider requests user-initiated. Own the finite picker requests through `createResource`, use work/connection/query/page identity, cancel on withdrawal and ignore obsolete results. Preserve the existing real reader opening cancellation and file-download/session fences; they solve a different lifetime.

### MP-09 — Visual consistency stops at the component boundary

Shared foundations are already sound: all media details use MediaPage/MediaHero, existing typography/gutters and shared Button, Shelf, DetailCard, FactList/MetricGrid and chart renderers. Do not replace them or redesign materials.

Composition differences remain:

- Music's PageCommand renderer emits standard-sized hero buttons (`MediaPage.svelte:57`); game/reading and screen actions use hero-sized controls. PageCommand cannot currently express that size/role (`src/lib/ui/pages/types.ts:6`). Primary-action order also differs by page.
- Movie/show **Insights** has Overview / Your activity / Community selections. Music uses Insights for static About/Details alone. Reading/games use Overview plus separate progress blocks and different history presentation: reading cards, game table, music menu dialog. The same data intent is reached differently.
- Reading places a persistent Experimental/metadata sentence and external-provider action near the hero (`Details.svelte:65`); movie provider attribution is attached to relevant detail content. Reading progress also adds an outer heading before another Progress shelf. These additions produce a different density and hierarchy.
- Non-screen genres are unlinked text in the shared hero. Credits for music are text links, reading authors/series are search buttons, game developers/publishers are plain fact strings. These are partly real data-model/destination differences, not permission to fabricate artist/author/company entities or provider reviews.

Adopt one section/action composition vocabulary while keeping honest medium-specific content. Present local Overview and Your activity consistently; add community/reviews/credits only when a real read model and destination exist. Related-title absence is a feature/data gap, not a CSS bug.

### MP-10 — Cross-medium navigation is hard-coded

`src/lib/ui/headings.ts:8` accepts only watch/listen/play and emits all three options based on a single `enabled` boolean. Legacy `/music` and `/games` pages use it. Read is missing even when enabled, and enabling music can expose a navigation option for a separately disabled gaming feature. A user leaving reading details through Library reaches another navigation model than a user leaving music/game details through these routes.

Build destinations from effective medium capabilities, include Read and reuse the existing Library/browse URL vocabulary. Do not introduce another Books/Comics route or segment outside the established filter menu.

### MP-11 — Preview recipes are not full production-detail acceptance

`src/routes/ui-preview/CatalogueExamples.svelte:62` reconstructs game/reading details with MediaPage, synthetic buttons and panels rather than mounting their complete production detail composition. It omits some real hero/menu controls, repeats simplified progress layouts and supplies fixture artwork. Consequently the reference cannot expose MP-03/04/05 or certify production page parity. The artist card fixture even supplies a workId, unlike an ordinary source artist, so it is not a faithful action-state fixture.

Keep isolation; do not mount operational routes or enable live commands. Extract feature-owned presentation compositions with explicit data/command inputs so real routes and reference scenarios share the same rendered structure. Supply fake data and local commands at the fixture boundary. Add honest missing/unsupported source, permission-off, loading, empty, progress, repeat-entry and long-copy cases.

## Recommended implementation order

1. **Reading workflow and truthfulness:** MP-01/02/03/08. Introduce a bounded linked-source read model; automatically open a single validated supported source; reserve manual search/linking for fallback. Share action gates/status and use clear tracking labels.
2. **Data parity:** MP-04/05/06. Reuse bounded batched music hydration; carry viewer availability into all detail adapters; make artist/track facts truthful. Preserve canonical identities, privacy and private overrides.
3. **Composition and lazy sections:** MP-07/09/10. Extend existing MediaPage/Shelf contracts only where required, standardize hero action roles and row titles/navigation, defer child/history data, and keep existing tokens/materials.
4. **Reference and acceptance:** MP-11, plus targeted tests below. Production composition and isolated reference must exercise the same structure.

No new production dependency or schema is proposed for this plan. Existing work/file/account tables contain the information needed for normal linked-source resolution. Anything requiring new persisted entities, provider capability or a policy choice should be treated separately rather than hidden in a presentation refactor.

## Required verification for implementation

- Reader: zero/one/multiple linked sources; supported vs CBR-only; stale generation/disconnected source/revoked permission; changed edition; active/local session; reader off; close/switch while request is pending; physical-book manual tracking remains usable. No title-based automatic file linking.
- Music: album/track/artist data contracts; accessible and inaccessible saved works; art/progress/favourites preserved in child rows; repeated tracks/disc order; source-backed and canonical routes; playback off; no synthetic artist release/duration.
- Games: Steam-owned vs unowned consistency across card/detail; installation remains unknown; guest/paused/replay/no-playthrough states; selected history remains bounded and lazy.
- Shared UI: movie/show regression reference; action role/size/order, linked title/segments/spacer/previous/filter/next, shared menus, unavailable poster preference, long captions and consistent panel/row rhythm.
- Performance: no per-card provider/database calls; only selected/visible supplemental sections activate; page/row requests abort on context change; repeated open/close does not accumulate requests/listeners/renderers; content revisions retain scoped invalidation.
- Reference: same production composition with isolated DTO/commands, no escaped account/provider mutations. Desktop and narrow mobile checks, settled route identity/content/error logs and representative interactions. Real PDF/EPUB/CBZ playback and browser/party acceptance remain separate from synthetic layout checks.


## Implementation follow-through — 17 October 2026

The dated findings above describe the audited baseline. The implementation keeps the accepted components/materials and does not change the Reader renderer, controller or layering. The proposed shared controller/background music experience is parked on the roadmap at the user's request.

| Finding | Implemented outcome |
| --- | --- |
| MP-01/02 | Read first checks bounded saved source links. One supported copy opens through normal permission/version validation; multiple copies remain a choice. Manual tracking is Update progress; paused/dropped tracking commands say Resume tracking. Redundant hero and empty-state progress buttons were removed. |
| MP-03 | Direct reading/playback actions respect effective feature capabilities. Menu mutations expose their busy state to game/reading controls; guests get a real sign-in destination. Artist menus retain their artist identity without inventing a playable work. |
| MP-04/05 | A bounded music hydration query restores artwork, canonical credits, personal progress/favourites and effective source availability while retaining repeated release-entry identity. Reading and game details use the viewer availability projection. Canonical music IDs alone do not imply playback access. |
| MP-06 | Artist release/duration assertions are omitted. Music hero durations retain m:ss; film runtimes are unchanged. |
| MP-07 | Music children use the existing lazy Shelf/resource lifecycle and ordered horizontal append. Game history is deferred; root routes return summaries. Selected section links reuse established routes. Root data loading does not fetch unrelated child/history pages. |
| MP-08 | The edition picker owns finite cancellable requests and resets connection/page state. Close, context replacement and disposal suppress stale results. Cancellation reaches Jellyfin search/preparation; late prepared sessions are retired and the loading owner clears. |
| MP-09 | Hero sizing, Insights/Your activity vocabulary, linked section headings and panel/history components are consistent. Music now has an on-demand activity row; game session history uses shared DetailCard/Shelf presentation. Reading source attribution lives in Credits content. Real medium differences remain explicit: no invented provider reviews, author/company identities or community scores. |
| MP-10 | Browse medium options use independent effective capabilities, including Read. |
| MP-11 | Music, game, remote game, reading and reading-group routes delegate to feature-owned detail components. Preview fixtures mount those same components with finite local transports. Removed duplicate non-screen detail/history markup; no live command fallback. |

The separately approved verified-group addition uses migration `0060_reading_groups.sql`: Comic Vine volume IDs own ordered issue membership, while issue UUIDs and private tracking remain independent. Existing exact cross-provider aliases can acquire their verified volume on demand. Open Library editions are alternate publications under one work, not title-matched new works. The current sources do not establish structured book-series IDs/order reliably; automatic book-series grouping remains a documented gap rather than an inferred relationship.

Verification: full non-database unit suite; focused disposable Reading identity/source/session, music persistence/hydration and games database suites; Svelte diagnostics, production build and UI/source inventory checks. Live provider reads validated one Open Library edition page and the six issues belonging to Comic Vine volume `4050-138023`, without importing user state. Browser checks on the development server covered saved album artwork, artist facts/actions and lazy albums, game details, and isolated production reading/collection compositions. These checks do not certify every document, a live rollout or narrow/mobile layout. The development database was backed up and migrated; the live database was not changed.
