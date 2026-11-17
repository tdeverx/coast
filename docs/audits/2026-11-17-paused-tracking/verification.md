# Paused tracking verification

Coast records screen pause and resume through the existing tracking transaction. The new flag leaves episode history, edition progress, the existing queue and rewatch boundaries intact. Playthroughs and reading keep their existing local statuses. Provider playback and history exports keep their current behavior.

- Paused progress reads the current statuses scoped to the owner and medium. It applies feature gates, progress visibility, and optional availability before counting and paging. Only the retained page reaches the existing card hydrator. The screen migration adds a partial index for the new flag, and the game and reading reads use their existing per-user indexes.
- The existing Continue and Next planners exclude paused titles, including queued seasons and episodes from a paused show. PostgreSQL fixtures cover the pause and resume round trip, unchanged position and viewing history, repeat pause, and existing reading and game progress. Mixed and category-scoped reads cover privacy and availability.
- Chromium used a built Coast app and a disposable PostgreSQL fixture to pause and resume both a partially watched movie and a queued title through their card menus. Profile tabs were Watching, Next, Paused, Finished, Dropped. The desktop submenu opened on hover alongside its parent at 1440px. At 390px the submenu opened on click and showed Back. No page errors occurred.

## Progress presentation

- Continue, Next, Paused, Later, Favourites, and Finished use their own shared artwork and caption settings. The screen hydrator uses a single fixed-shape batch to read one representative episode and its artwork hierarchy only for eligible roots on the current page. Saved cards can resolve one named collection. Reading and game captions keep their existing data.
- Chromium verified all six caption and artwork combinations against a local built app at 1440px, plus Paused at 390px. Shape, artwork type, source priority, and overlay followed the selected segment. Choices returned on segment re-entry and cleared on reload. The layout keeps the overrides in the rail instance.

## Request playback readiness

- Seerr's accepted and processing statuses stay separate from playable availability. The existing sync uses one fixed-shape scoped candidate query per page, with at most three sources per eligible request. Jellyfin PlaybackInfo and a bounded, bodyless HEAD run on the existing provider lane under the requester's account, outside the write transaction. Subsequent observations give a previously verified source priority while it remains mapped and carries no pending signal.
- The change preserves the Seerr page checkpoint and notification transaction. Controlled PostgreSQL/provider fixtures exercised an empty playback response, a 404 streaming endpoint, a successful endpoint superseded by a newer Jellyfin catalogue observation, and a current successful endpoint. Only the current success produced the ready notice. The same fixture verifies that newly mapped alternatives do not trigger additional probes when prior proof remains usable. Pending source evidence rides in the existing local card projection without remote calls on page render.
- Chromium confirmed an indexed title with no playable stream shows Open details on the card, disabled Stream pending in its card menu, Stream pending on its detail hero and In progress in Requests. The test used local fixtures and recorded no application errors.
