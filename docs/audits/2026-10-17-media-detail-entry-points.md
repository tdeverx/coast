# Media detail entry points — 17 October 2026

## Scope

The standard signed-in Media detail panel covers media detail destinations and their sections, including people/credits. Linked row titles also open supported Library, Progress, Discover, For You, list and profile-section destinations inside the panel, using their existing sources and permission checks. Ordinary navigation to those pages, Search and settings retains normal routing; this does not turn every in-app link into a modal.

## Shared entry point

One delegated root action handles eligible ordinary anchors: card artwork/captions, hero Learn more, menus, notifications, media breadcrumbs, chart links and row titles. Programmatic post-import/detail selections use the same navigation helper. The allowlist recognizes canonical works, remote reading/game previews, source-backed music, reading groups and people. Action/edit routes, external addresses, downloads, fragments and modified/new-tab clicks retain their original behavior. Direct visits, guest browsing and modified/new-tab links still use the full routes. No experiment or personal toggle disables signed-in panels.

A supported tap suppresses only its duplicate SvelteKit full-route preload during that event; it neither retains link nodes nor prevents focus/outside-menu behavior. One internal dispatcher calls the same feature-owned loaders as full routes; it does not fetch client-supplied URLs. Feature and permission checks remain in those loaders.

## Within the panel

- Breadcrumbs, related works, cast and detail-section titles replace content in the same native modal.
- An explicit Back control precedes edition selection. Browser Back/Forward follows the same shallow history; Close exits the complete detail trail to the original page.
- A new destination cancels the old request and remains in the existing panel until its component/data are ready. No separate loading panel opens. Local section/filter/page context belongs to the destination, not the underlying page's query. Navigation resets content to its top while preserving the current sheet expansion; only a fresh open starts collapsed.
- Native `showModal()` makes the background inert to clicks and focus. The document is scroll-locked while the expanding modal is open; the panel retains its own scroll. Escape/Close restores focus and ordinary document scrolling.
- A fixed outer 160px scroll track expands the sheet without advancing the content; a separate inner scroller owns page content once expanded. Neither track length nor content padding changes with expansion, avoiding scroll/layout feedback. A scoped wheel handoff continues an already-latched gesture into content without another pointer movement; nested scroll areas, horizontal gestures and zoom retain ownership. Further scrolling moves within the expanded page; short pages retain that expansion range. Section pages reserve only 72px for the floating controls instead of full-page navigation padding and a first-row margin.
- The rounded sheet has a static 2px overlay edge, fading as it expands. There is no panel hover scaling. Shared heroes support left, center and adaptive alignment; the adaptive capability retains its expansion progress, but detail heroes currently stay left-aligned while that transition is parked on the roadmap.

## Linked row views

The first grid Shelf supplies its title, segments and filter menu to the panel. Titles are centered in the floating header, segments use the existing navigation presentation in a floating bottom bar, and paging arrows are absent. Existing sources append bounded pages through the shared lazy sentinel; filters cancel/reset those same resources without rewriting the page underneath. Nested day groups retain their own headings. Profile favourites and insights use the existing profile-section API, including privacy and multi-medium results.

## Shared controls and social row

Plain segmented controls mount no glass renderer. Material controls have one material owner, with a separately scrolling inner rail so shadows remain unclipped.

The separate Friends row is removed. Item Activity combines real events with privacy-filtered current relationships, using the same medium-aware All, Watched/Read/Listened/Played, Watching/Reading/Listening/Playing, Watchlist/To read/Saved for later/Backlog, Lists and Favourites controls across supported media. A visible relationship with no matching event appears as a current-state card with no fabricated timestamp or event reaction. Real events keep their timestamps and reactions. The same scoped relationship SQL supplies ordinary media-card heads; their existing three-person limit remains.

Filtering happens before grouping and the 61-row cursor lookahead. Event and current-state phases share one stable cursor; stale work/filter requests are cancelled, selected links retain their relationship parameter, and ordinary For You activity keeps its existing event-only contract. Empty selections keep their segments.

The common detail composition orders rows as hero → Seasons/Episodes/Issues (or Tracks/Albums) → credits → reviews → insights → Activity → collections/editions → similar titles, omitting unsupported rows. Feature adapters own data and lazy activation; they do not define alternate rendering orders. A universal Activity row follows Insights and precedes collections, using the For You feed source and cards. Movies, episodes, games, books and comics filter to the work; shows/seasons, albums, music artists and comic volumes use their verified membership. Separate reading/music/game history rows are removed; game progress and playthrough selection remain under Insights → Your progress. Raw history storage and API contracts remain unchanged.

## Verification

Pure routing tests cover eligible section/filter links, intentional exclusions, delegated event disposal, modified clicks, preload suppression, signed-out/preview boundaries and nested history. Disposable database tests cover relationship filters, more than three friends, private avatars/ratings, hidden/disabled/removed friends and existing reading/social behavior. Browser checks cover actual hero/section navigation, the centered sheet, static edge, scroll expansion, material ownership and background scroll/focus isolation.

Isolated rendered checks exercised the actual production components at 1280×800 and 390×844: expansion, content scrolling, section replacement without collapsing, working bottom segments, 24→27 item append and fresh-open reset. Twenty-five settled animation-frame samples retained identical expanded geometry. These checks do not establish cross-browser smoothness or production provider latency.

Follow-up scroll and responsiveness checks reproduced a single uninterrupted Chromium gesture stopping at expansion before the fix (outer 160px, content 0px), then continuing into content afterward without a pointer move (outer 160px, content over 600px). Reverse travel, nested scrolling and retained expansion passed. Standard/navigation segmented controls, plain and glass, kept their outer surface stationary while their options scrolled at 1280px and 390px viewport widths; keyboard selection and runtime-error checks passed. These isolated component checks do not certify physical trackpads or other browser engines.

## Pre-PR housekeeping and performance review

- Promoted panels to standard signed-in navigation. Removed experimental configuration, administrator/personal controls, capability admission and the experimental module location. Ordinary medium/command authorization remains authoritative. Canonical detail routes remain thin direct-link/new-tab adapters rather than obsolete alternate interfaces.
- Removed the unused Friends-detail endpoint and paginated person projection. Item Activity owns the relationship view; card heads still select only three people per work, with presence fetched only for those selected identities. Migrated its privacy/filter regression to Activity instead of dropping that coverage.
- The screen menu's viewing link now opens item Activity. The history-removal page remains because it supplies selective/bulk removal, snapshot-count confirmation and connected-service reconciliation that Activity does not replace. Its obsolete read-only mode and remove-query switch are removed; it now opens directly as a management tool and Done returns to item Activity.
- Reviewed the selected-format worker ownership, bounded archive inputs/output, detail-only artwork sampling, lazy detail imports, shared Shelf cancellation/append and stale-response fences against the performance guide. No second scheduler or per-card colour extraction was introduced. Decoder libraries remain absent from the ordinary entry path.
- Exercised fifteen consecutive retained-panel open/close cycles through Close, Escape and browser Back without reloading the fixture. The same mounted panel reopened for another destination afterward. This confirms the retained component/native-dialog/history lifecycle in isolation; development hot reload and real SvelteKit navigation need separate acceptance.

The real signed-in dev app also reopened a title, Continue and Next consecutively without refreshing or console warnings/errors. The shared Dialog now ignores an older queued native close event if the element has already reopened; a lifecycle regression protects that race.

The stale-link sweep also found game/reading menu links to deleted `#play-history` and `#reading-history` anchors. All media-menu viewing links now open the shared Activity section with its consumed filter; the redundant listening-history dialog and its private loader were removed. Raw history APIs remain available to their existing callers.

## PR review follow-up

The person and reading-collection route adapters now translate known application/validation failures into the intended 403/404/400 responses. The same pass fixed adjacent game and music adapters; unexpected errors still propagate to diagnostics, and source-backed music retains its existing provider-outage response. Eight focused route regressions cover known failures and successful payloads.

The reported missing synced-room constraint was not reproducible: migration 0048 declares an inline CHECK, which PostgreSQL automatically names `synced_rooms_reading_format_check`. A disposable transaction reproduces that exact 0048 statement, verifies the generated name, runs the actual 0061 upgrade, and accepts all six supported formats. The migration remains unchanged; it also passed the fresh PostgreSQL 15/17 CI migrations.
