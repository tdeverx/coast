# Jellyfin music support

Music browsing uses an existing linked Jellyfin account and Coast's existing interface components. Library → Music opens the album grid, with Artists/Albums/Tracks filters, search, source selection and pagination. Artist pages open albums; album pages show ordered tracks; track pages retain album and artist links. Cards use the existing square shape, and pages reuse PageHeader, SegmentedControl, MediaCard, Pagination, RowHeader, DetailCard, FactList and the shared table styles. No new visual design or materials are introduced.

Local catalogue import, audio playback, queues, playlists and listening-history sync remain unimplemented. Music cards open details and do not offer film/TV watched or request actions. Film and TV scans and tracking remain separate.

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

Items retain artist and album-artist credits separately, album identity, disc/track numbers, duration in seconds (including fractional seconds), release date/year, genres, overview, favourite state and provider identities such as MusicBrainz release and release-group IDs. Missing optional metadata remains absent or an empty collection. IDs must always be paired with their connection; equal item IDs on different servers do not imply equal recordings.

Example album-to-track drill-down:

```text
GET /api/v1/providers/{connectionId}/music?kind=album&search=interlude
GET /api/v1/providers/{connectionId}/music?kind=track&albumId={albumId}
GET /api/v1/providers/{connectionId}/music/{trackId}
```

## Verification and next work

Contract tests cover query construction, account-token use, music mapping, null metadata, pagination, filter validation, response sanitization and rejection of screen items. API tests cover authentication and malformed filters before any provider request. These fixtures do not establish compatibility with the configured live Jellyfin server.

The isolated browser fixture passed at 1440×1000 and 390×844: Library → Music → artist → album → track, album/track pagination, search, authenticated cover relay, source switching, empty results/reset, provider outage/retry control, unlinked-account state and rejection of another user's connection. The flow produced no console warnings or runtime errors. Screenshots were inspected after the existing route animations settled. Type checking passed with zero errors or warnings; 50 focused music, provider and media-model tests passed. Audio playback and the configured live server are not covered by these checks.

Next work is authenticated audio streaming, followed by album playback and a listening queue. Persistent listening state should use music vocabulary and semantics rather than film/TV watched state. No database migration or production dependency is introduced in this increment.

Provider references: [Jellyfin music DTO fields](https://typescript-sdk.jellyfin.org/interfaces/generated-client.BaseItemDto.html), [item query filters](https://typescript-sdk.jellyfin.org/interfaces/generated-client.LibraryApiGetItemsRequest.html), and [album-artist controller](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/ArtistsController.cs).
