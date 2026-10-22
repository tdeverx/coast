# Browsing consistency pass — 22 October 2026

Scope: action navigation and the requested browsing consistency and performance pass, based on main `4025ce7088cfec9f73d8ee9fe6097af182d60e6a`. This is dev acceptance, not a production benchmark or deployment.

## Shared presentation

For You, Library and Discover use the existing Shelf, Heading, RowFilter, Button, artwork and continuation owners. Row titles are 20px/800; filters use the same nested menu and keyboard/focus handling. Availability is labelled “Available only” through the shared control. Secondary filter names are Media type, Reading type, Status, Sort by, Relationships, Availability and Sources as applicable.

Discover has no persistent provider row subtitles or page description. Provider setup guidance remains available in expanded empty views; failures retain the shared error/Retry feedback. Listen discovery already contains accessible music, so an inert availability toggle is omitted. Recently added remains combined within its action, without subtype segments. Requests remains Watch-only, with the existing ordinary-user/admin visibility rules.

| Action | For You | Library | Discover |
| --- | --- | --- | --- |
| Watch | Progress, Requests, combined Recent, recommendations/activity | Movies, Shows, Collections; matching count | Trending and recent; Movies/Shows filter |
| Listen | Native music Library, combined Recent, saved/favourite and activity/recommendation rows; no Progress | Albums, Artists, Tracks, Playlists; no progress statuses | Accessible music; square artwork |
| Play | Shared Progress, combined Recent, activity/recommendations | Games; Unplayed/Continue/Next/Finished etc. | Game discovery; posters |
| Read | Shared Progress, combined Recent, activity/recommendations | Books, Comics, verified Series; Unread/Continue/Next/Finished etc. | Book/comic discovery; Reading type filter |

Progress retains thumbnails for Continue and posters for Next/Later/Favourites (and profile history). Music artwork is square; game activity/recommendation artwork uses posters. No new hero designs or playback owner were introduced.

## Resource corrections

- Home music formerly stopped at a 12-item provider preview. It now uses the shared Library source, native provider pages, entity controls, one horizontal rail and bounded page retention. The expanded link opens the matching Library entity. Existing legacy preview consumers retain their destinations.
- Activity publishes its viewer/target/filter scope atomically with cards. Account/feature changes hide old cards immediately, cancel the old cursor and prevent late publication. Unactivated sources remain lazy.
- Saved rows fence viewer, view, type and availability changes. Recommendation availability changes likewise cannot display cards from the previous filter while fetching. Ordinary same-context transient refresh failures retain settled content.
- Expanded action-scoped saved rows preserve their medium. Requests expansion explicitly selects Watch, independent of the saved action.
- Discover responds to capability withdrawal as well as experimental gates. It reuses one feature-config read and checks cancellation before hydration after shared provider work. Shared flights keep their existing lifetime and ownership.
- Library missing-demand queries restrict the shared collection assessment roots to the selected category, then filter before deduplication, count and pagination. Administrator demand remains across enabled categories. No schema, index or dependency change was needed.

## Acceptance

Actual signed-in dev UI: all twelve route/action combinations checked at desktop and 390px mobile width. Titles and control presentation agree; the document does not overflow horizontally. Requests now has Available (default), Pending, Accepted and Declined; Recently added follows Requests and has no sort control. Activity has no inline segments: Audience (All/Friends/Me, default Friends), Media type, Activity type and Time period use the shared filter menu.

Live music row continuation loaded 100 cards beyond the first provider page and changed cleanly to Artists. Library sorting retained the total of 162 albums; scrolling to the bottom retained 50 cards until explicit Load more, then displayed 100 while the total stayed 162. Native sources may use smaller pages than the 60-card ceiling. Existing retained-page leases and reverse restoration remain in the shared owner.

Keyboard acceptance covered Enter into filters, ArrowRight into nested choices, Escape back to the parent/trigger, and sorting. The music Status menu contains All/Later/Favourites; reading uses Unread. Desktop and mobile menus were visually inspected. Browser console inspection found no warnings/errors. An upstream Open Library metadata failure was observed with the existing visible Retry feedback; provider success is not guaranteed by this audit.

Compiled-source tests cover lazy activation, viewer replacement failure, cancelled cursors, superseded availability, disabled capabilities, native music continuation and scoped expansion. Disposable PostgreSQL tests cover collection demand, category boundaries, discovery, playlist/series access and reading routes. Their output is separate from guarded skips in the unit run.

The initial consistency gates recorded **975 unit passes, 727 guarded skips, zero failures**, plus **63 distinct disposable-database passes** (collection 24, feature boundaries 12, discovery 3, action Library 2, reading 22). The demand suites were repeated after restricting assessment roots. Type checking reported zero errors/warnings; production build, adopted-source style, code inventory, UI inventory and diff whitespace checks passed. Database coverage used the existing PostgreSQL 17 test container; PostgreSQL version standardisation remains separate. The Avatar and UI-preview prop-manifest user edits retain their original hashes and are excluded from the browsing PR.

The final review caught a Series URL defect: the query retained personal Collection scope while the refresh URL discarded it. The shared path builder now preserves Collection scope for containers, with a regression test and signed-in filter/refresh acceptance. Browser rechecks covered Watch/Listen switching, Back, playlist counts, music Status choices, Discover scope, Requests ordering and the Activity audience menu at desktop and 390px. No relevant browser console warnings or errors were observed. Final verification totals and CI results are recorded in the PR.

No CPU, latency percentile, heap plateau or uninterrupted playback benchmark was performed. This pass verifies presentation, correct scoping and existing structural work bounds; it does not claim a measured speedup.
