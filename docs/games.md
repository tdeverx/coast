# Games backend

The initial games backend stores game metadata and provider identities separately from Film & TV. Game playthroughs and sessions are private to their owner. Games reuse Coast’s existing library cards, filters, overview panels, menus and dialogs. IGDB provides remote game search, details and catalog import. Configure it in Settings → Integrations, then open Games from Library or Search.

All endpoints require an authenticated Coast session. Writes use the existing same-origin checks and bounded JSON request reader.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/games/igdb/search?instanceId=UUID&q=title&page=1` | Search IGDB; 60 results per page, with a hasMore indicator. |
| `GET /api/v1/games/igdb/:externalId?instanceId=UUID` | Fetch game metadata from IGDB without importing it. |
| `POST /api/v1/games/import` | Import or refresh an IGDB game using instanceId and externalId. |
| `GET /api/v1/games?q=title&page=1` | Search the local game catalog; 60 games per page. |
| `POST /api/v1/games` | Create a game with title, overview, releaseDate, platforms, genres, developers, publishers and provider identities. |
| `GET /api/v1/games/:id` | Metadata, identities and the current user's latest 60 playthroughs. |
| `POST /api/v1/games/:id/playthroughs` | Create a playthrough with optional platform, repeat flag and initial planned/in-progress status. |
| `GET /api/v1/game-playthroughs/:id?page=1` | Owned playthrough, total minutes played and paginated sessions. |
| `PATCH /api/v1/game-playthroughs/:id` | Set status and/or progressPercent (0–100). |
| `POST /api/v1/game-playthroughs/:id/sessions` | Log a dated play session with id, minutesPlayed and optional note. |

## IGDB configuration

IGDB requires a [Twitch application client ID and client secret](https://api-docs.igdb.com/#getting-started). An administrator adds IGDB in Settings → Integrations and enters the Twitch client ID and client secret in the existing integration dialog. The same configuration is available through `POST /api/v1/providers` with this JSON:

```json
{
  "provider": "igdb",
  "name": "IGDB",
  "clientId": "YOUR_TWITCH_CLIENT_ID",
  "clientSecret": "YOUR_TWITCH_CLIENT_SECRET"
}
```

Use an authenticated, same-origin request; do not put credentials in source files or query strings. The response includes the instance ID but no credentials. Updating the same instance uses its id; omitted application credentials retain the stored values. Both credentials are required on first setup. Coast verifies app authentication and an IGDB metadata request before saving, so failure leaves any existing configuration intact.

Credentials use Coast's encrypted store. [Twitch app tokens](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow) are obtained server-side, cached in memory and renewed before expiry or once after HTTP 401. IGDB and Twitch requests use fixed HTTPS origins and Coast's transport limits. Requests share a conservative lane per Twitch client ID; 429 responses surface an actionable error instead of being retried repeatedly. Disabled integrations are checked before each call, including when an app token is cached. Rotating credentials invalidates the cached adapter.

Search and details expose normalized title, summary, first release date, cover/backdrop artwork, platforms, game genres, developers and publishers. Artwork URLs are derived from validated IGDB image IDs. Missing dates remain unknown. The provider is metadata-only: it does not import an owned library, playtime, achievements or account history.

Import fetches metadata before opening a transaction. Concurrent imports of the same IGDB ID produce one game. Importing again refreshes provider metadata while preserving the Coast game ID, playthroughs and sessions. Existing local metadata for an explicitly matching IGDB identity is replaced by the imported fields. Provider failures leave local records intact.

Provider identities use `{ provider, externalId }`; each provider/ID pair identifies at most one game. Conflicts roll back creation rather than leaving an incomplete catalog entry.

Statuses are planned, in-progress, paused, completed and dropped. A play session moves a planned playthrough to in-progress. Paused, completed or dropped playthroughs must be resumed before adding a session. Percentage is user-supplied progress, independent of total minutes, and reaching 100% does not automatically mark completion. Completing sets completedAt; reopening clears it without removing play history. Replays create a separate playthrough with repeat set to true.

Session IDs are caller-generated UUIDs. Repeating the same ID and payload returns the existing session, even after completion; changing its payload returns 409. Minutes are whole numbers from 1 to 1,440 per session; playedAt must be an ISO timestamp in the past. There is no game time estimate derived from runtime, and game genres and totals do not enter Film & TV statistics.

Run `bun test tests/games.test.ts` for validation checks. Run `TEST_DATABASE_URL=... bun test tests/games-db.test.ts` against a disposable PostgreSQL database for identity rollback, concurrent retry safety, ownership, completion and replay isolation. The database suite applies migrations and cleans its uniquely named fixtures.

`tests/igdb.test.ts` covers adapter validation, mapping, authentication caching, query escaping, 401 renewal and error handling. `TEST_DATABASE_URL=... bun test tests/igdb-api-db.test.ts` exercises the API, encrypted configuration, credential rotation, disabled integrations and concurrent imports against PostgreSQL with mocked Twitch/IGDB responses. No live credentials have been verified.

## Games interface

Library → Games opens the saved catalog; Discover searches the selected IGDB integration. Existing square media cards open a preview, and Add game imports the selected metadata and opens its saved details. Local catalog and IGDB searches use bounded pagination. The Games link in Search opens discovery directly.

Saved details reuse the existing overview panels and tracking dialogs. Start playthrough chooses a platform and optional replay flag. Log a play session records dated minutes and an optional note. Game actions supports progress/status edits, completion/unfinished, pause/drop and metadata refresh. A playthrough selector keeps replay histories separate, and session tables use existing pagination. Metadata-only IGDB integrations do not appear as personal account connections.

Browser verification used a disposable PostgreSQL database with mocked Twitch/IGDB responses and artwork; real credentials remain unverified.
