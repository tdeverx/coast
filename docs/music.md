# Music browsing, tracking and playback

Music browsing uses an existing linked Jellyfin account and Coast's existing interface components. Library → Music opens the album grid, with Artists/Albums/Tracks filters, search, source selection and pagination. Artist pages open albums; album pages show ordered tracks; track pages retain album and artist links. Cards use the existing square shape, and pages reuse PageHeader, SegmentedControl, MediaCard, Pagination, RowHeader, DetailCard, FactList and the shared table styles. No new visual design or materials are introduced.

Albums and tracks persist as canonical works with credits, ordered membership, editions and provider mappings. Shared Jellyfin scans ingest music metadata; independent user sync establishes access, favourites, counts and progress. Server presence alone never adds music to personal Collection. Artists retain separate preference controls; album/track favourites use Coast state and durable delivery. Music retains its own listen/progress models rather than screen watch events, under the existing experimental feature gate.

## Listening and playback

Manual track logs create repeatable listens. Album logging records known member tracks atomically under a caller-supplied batch UUID; retries with that UUID cannot create duplicate listens. Album activity derives from track events. Supported Jellyfin exchange uses existing import and outbound reconciliation controls, preserving Coast history when the server exposes only counts/current state.

Audio uses native playback or existing `hls.js` through authenticated planning, relay and session routes. It reuses the persistent media controller with artwork, track/artist, play/pause, seek, volume, previous/next and queue menus. Browsing stays visible and audio survives navigation. Audio and title video stop each other; existing video navigation behaviour remains intact. Play starts at the beginning; Continue resumes progress.

One listen is recorded per traversal after 50% actually played by default. The integer 1–100% user preference is captured at session start. Seeking, buffering and pauses add no played time; preference changes do not rewrite history or the active threshold. Album, personal queue and music playlist order retains listened tracks and repeats. Unavailable tracks skip with a notice; unresolved gaps remain, create no listens, and playback stops when no playable entry remains. Screen sequences retain explicit-skip behaviour.

## API

All routes require a signed-in Coast user. `connectionId` is the Coast connection UUID returned by `GET /api/v1/providers`. The service checks ownership, connected status and the enabled Jellyfin instance, and uses the linked remote user ID and encrypted account credential. The existing provider transport enforces administrator network policy. Credentials, filesystem paths and upstream playback URLs are excluded from responses.

`GET /api/v1/providers/{connectionId}/music` accepts:

| Parameter | Behaviour |
| --- | --- |
| `kind` | `artist`, `album` (default), or `track`. Artists are album artists. |
| `offset` | Non-negative integer, default `0`. |
| `limit` | Integer from `1` to `100`, default `50`. |
| `search` | Trimmed search term, up to 200 characters. |
| `artistId` | Jellyfin artist GUID. Albums filter by album-artist credit; tracks filter by performing artist. Not valid for artist browsing. |
| `albumId` | Jellyfin album GUID. Valid only with `kind=track`. |

The result is `{ connectionId, items, total, nextOffset }`. Follow `nextOffset` until it is `null`. Album track pages ask Jellyfin to order by disc number, track number and title. Other pages sort by title. An incomplete page or an unexpected item type fails rather than returning a misleading catalogue.

`GET /api/v1/providers/{connectionId}/music/{itemId}` returns `{ connectionId, item }` for one music artist, album or audio track. Jellyfin IDs can be compact or hyphenated GUIDs. Screen items are rejected.

`GET /api/v1/providers/{connectionId}/music/{itemId}/artwork` relays Primary artwork as WebP after verifying account ownership, music item type and access. Images use the existing provider network policy, private browser caching and bounded responses. Jellyfin artwork is not cached on disk; raw upstream image URLs and tokens are never browser data.

Items retain artist and album-artist credits separately, album identity, disc/track numbers, duration in seconds (including fractional seconds), release date/year, genres, overview, favourite state and provider identities such as MusicBrainz release and release-group IDs. Missing optional metadata remains absent or an empty collection. Remote IDs require their service instance; equal IDs on different servers do not imply equal recordings. `workId` identifies the canonical Coast album/track; `/music/work/{workId}` remains usable without an active provider connection.

`POST /api/v1/providers/{connectionId}/music/{itemId}/favourite` accepts `{ favourite: boolean }`. Album/track actions update Coast relationships and queue supported delivery; artists retain their separate preference controls.

`POST /api/v1/music/{workId}/log` accepts `{ batchId: UUID, occurredAt?: ISO timestamp }` and returns `{ added, batchId }`. `GET /api/v1/music/{workId}/queue` expands a track or album in order, returning availability and a Continue target. `GET /api/v1/music/queue?listId={UUID}` expands an owned music playlist; omitting `listId` uses the personal music queue. Shared Collection, rating and list APIs accept canonical work IDs.

Example album-to-track drill-down:

```text
GET /api/v1/providers/{connectionId}/music?kind=album&search=interlude
GET /api/v1/providers/{connectionId}/music?kind=track&albumId={albumId}
GET /api/v1/providers/{connectionId}/music/{trackId}
```

## Verification and limits

Contract tests cover query construction, account-token use, music mapping, null metadata, pagination, filter validation, response sanitization and rejection of screen items. API tests cover authentication and malformed filters before any provider request. These fixtures do not establish compatibility with the configured live Jellyfin server.

Isolated desktop/mobile fixtures cover browsing, artwork, source switching, pagination, outages and ownership. Synthetic direct/HLS audio checks cover actual-play thresholds, seeking exclusion, navigation persistence, skip notices, queue gaps and audio/video handoff. Separate 1%/100% checks cover threshold endpoints, active-session preference capture and Continue progress. Database tests cover canonical identity, retry-safe logs, shared relationships and supported reconciliation. These checks do not establish live-server audio compatibility. Live Trakt remains deferred; prior live Jellyfin video evidence is separate.

Provider references: [Jellyfin music DTO fields](https://typescript-sdk.jellyfin.org/interfaces/generated-client.BaseItemDto.html), [item query filters](https://typescript-sdk.jellyfin.org/interfaces/generated-client.LibraryApiGetItemsRequest.html), and [album-artist controller](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/ArtistsController.cs).
