# Music/gaming implementation

Implemented MEDIUM-01 through MEDIUM-06 in the current working tree. Root reports the first focused disposable Steam/music persistence pass succeeded; final integrated gates and browser validation remain with root. No commits, pushes, dependencies, services, credentials or live providers were used by this agent.

## Changes

- **MEDIUM-01:** One stable selected release supplies canonical album detail/queue/log membership. Track editions remain occurrence identities, including repeated recordings. Collection keeps a deduplicated selected-release graph, counts exact occurrences for completeness and accepts only selected-edition membership proofs. Album listens use retry-safe occurrence sub-batches under the original frozen request batch.
- **MEDIUM-02:** Music item/album/artist GUIDs normalize at the Jellyfin mapper and persistence boundaries. Indexed equivalence lookups preserve existing stored mapping/artist/edition UUIDs. Pre-existing mappings of one GUID to conflicting canonical works reject with 409 for review instead of silently merging private histories.
- **MEDIUM-03:** Source cards use connection/item entryId; canonical release occurrences retain edition entryId; Music grid uses that key and shared Shelf already honors it.
- **MEDIUM-04:** Ownership totals, stat eligibility, achievement schema cache and progress are AppID scoped. Canonical detail presentation sums exact app totals and counts only schemas for the account's observed apps. Ambiguous old aggregates follow the explicit discard/resync migration choice.
- **MEDIUM-05:** Canonical detail hydrates persisted role-specific credits. Artist links use only the viewer's enabled owned Jellyfin connection; disconnected/public viewers retain credit text without invalid canonical artist links. Album-only credit names also persist as subtitle fallback.
- **MEDIUM-06:** A full root IGDB refresh clears a removed provider-owned parent relation in the import transaction. Embedded parent snapshots do not revoke the parent's own relation because those snapshots omit ancestor fields.

## Schema and migration

Migration: `drizzle/0052_music_editions_and_steam_apps.sql`. Root owns the final journal/snapshot.

- music_works.selected_edition_id nullable FK to work_editions(id), ON DELETE SET NULL
- work_editions.metadata stores albumExternalId, position, discNumber and trackNumber for exact provider occurrences
- game_account_state.app_id required; primary key(account_id,app_id), canonical game_id retained
- game_achievements.app_id required; unique(game_id,provider,app_id,external_id)
- Indexed normalized GUID lookup for music artists/provider items/work editions and indexed release membership

Backfill and authorised data treatment:

- Track occurrence metadata backfilled from a deterministic latest provider snapshot per instance/normalized item/work.
- Existing albums select a deterministic instance/provider release when exact membership is known; native/unattributable album relationships remain explicit native membership until a provider release is selected.
- Selected release's deduplicated recording projection replaces unioned provider-release relationships; ordered occurrence rows remain in work_editions.
- Existing single-AppID imported observations retain totals/schema/progress and gain that exact AppID.
- Per explicit user choice, old account/game imported totals and Steam achievement definitions/progress are discarded when zero or multiple Steam identities prevent exact attribution.
- Affected steam-user checkpoints and retained job snapshots/cursors are invalidated. No live tasks are invoked; normal authoritative jobs repopulate exact AppID observations.
- Manual game playthroughs/sessions, Collection choices and music listen history are untouched. Prior availability suppresses accidental re-collection during resync.

The selected album release is stable after first selection. New albums choose their first known provider release; existing attributable releases use deterministic migration ordering. Native albums without a provider edition keep their explicit memberships. This uses the current work/edition boundary and preserves the approved interface.

## Verification

- `PATH="$PWD/.tools/bun-darwin-aarch64:$PATH" bun test tests/igdb.test.ts tests/steam.test.ts tests/games.test.ts tests/jellyfin-music.test.ts tests/music-presentation.test.ts tests/provider-contracts.test.ts tests/task-timing.test.ts`: 75 passed, 0 failed, 365 assertions after new GUID/card regressions.
- `env -u TEST_DATABASE_URL -u COAST_DB_TEST PATH="$PWD/.tools/bun-darwin-aarch64:$PATH" bun test tests/jellyfin-music-persistence-db.test.ts tests/steam-db.test.ts tests/taste-cache-db.test.ts tests/collection-db.test.ts`: 49 skipped, 0 failed; imports/transpilation succeed with DB disabled. This does not validate DB behavior.
- `Compile collectionCTE and musicAlbumMembersSql through PgDialect without executing SQL`: SQL generated; parameter binding and parentheses balance checked. Not a PostgreSQL execution/syntax/plan test.
- `git diff --check over owned changed tracked files`: Passed.

## Remaining integration checks

Root's first disposable pass confirmed the selected Steam/music persistence suites passed. Later added occurrence-completeness and nested-parent regressions remain part of root's final gates.

- Root sequential typecheck/build and migration journal/snapshot generation.
- Disposable PostgreSQL migration test: pre-0052 single-AppID plus dual-AppID account/schema/progress fixtures; assert single values survive, ambiguous imported data/cursors are removed and dated manual sessions/Collection remain.
- Run focused DB regressions for selected standard/deluxe order, repeated recordings, wrong-release completeness evidence, album batch retry counts, normalized old GUID mappings, viewer-scoped artist links, dual-owned Steam aliases/reversed response order and nested/full removed parent cases.
- Render Music grid/shared Shelf with canonical copies and repeated release occurrences to confirm no duplicate-key errors and unchanged visual design.
- No live APIs, credentials, databases or services were used by this agent.

Exact changed-file inventory is in `implementation-mediums.json`.
