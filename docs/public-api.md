# Public API

Coast exposes a token-authenticated API at `/api/public/v1`. Browser `/api/v1` routes remain private application interfaces. Public API tokens never grant browser access, administrator privileges, provider credentials, playback streams or another user's data.

Create a token in **Settings → API access**, choose its permissions and expiry (1–365 days, default 90), and copy the secret once. Coast stores only its SHA-256 hash. Revocation takes effect on the next request. Disabled accounts cannot use tokens; password changes and administrator account credential/role changes revoke them. Up to 20 active tokens are allowed per account.

```sh
curl --header "Authorization: Bearer $COAST_API_TOKEN" \
  'https://your-coast.example/api/public/v1/collection?level=root&page=1'
```

Keep tokens in an application's secret store. Use HTTPS outside your trusted local network. Tokens in query strings and browser cookies are not accepted. Cross-origin browser access is not enabled; this first pass is for server-side clients.

| GET endpoint | Permission | Result |
| --- | --- | --- |
| `/me` | Any valid token | Token owner's UUID, username and granted scopes |
| `/catalogue` | `catalogue:read` | Shared registered works; `category`, `kind`, `page` filters |
| `/catalogue/{workId}` | `catalogue:read` | One shared work's UUID, kind, title and year |
| `/collection` | `collection:read` | Owner's Collection, availability/freshness and membership reasons |
| `/library` | `library:read` | Library using the token owner's source permissions |
| `/progress` | `progress:read` | Owner's filtered tracking views and current concrete activity |

Catalogue and Collection also accept enabled experimental `book` and `comic` categories/kinds. Comic work DTOs include `attribution` with a label and source URL; clients displaying Comic Vine metadata must retain the source link. Collection accepts `level` (all/root), `category`, `kind`, `relationship`, `activity`, `availability`, `source`, and `page`, using the same filters/preferences as Coast. Library accepts `category` (all/screen/game/music/reading), `kind`, `source` (connection UUID/all), and `page`. It reads persisted accessible works and their parents; it does not contact provider browsing endpoints or expose personal tracking filters. Progress accepts `view` (watching/up-next/next/recommendations/watchlist/favourites/finished/dropped), `category`, `kind`, `scope`, and `page`. Games, music, books and comics obey their independent installation gates; unsupported views return a validation error. Progress supports `category=reading` with `kind=all/book/comic`; supported views expose the token owner’s `reading` object (state, current page, total pages and start/completion dates). Reading history is available at `GET /reading/{workId}/history?page=1` with `progress:read`, for the token owner only. File-reader sessions remain private browser operations.

All lists return `items` and `pagination`: `page`, `pages`, `total`, `pageSize` (60), `next` and `previous` (relative URLs or null). Filters apply before pagination. Page inputs must be integers 1–10,000; pages beyond the current result are clamped to the final page. Catalogue ordering is stable by UUID. Pagination is a current-state read, not an immutable snapshot.

Public work DTOs include UUID, kind, title and year. Collection adds `availability`, `stale` and `reasons`. Progress adds available/current screen state; game items include their latest playthrough status, percentage and total logged minutes; music tracks include position, duration and play count when recorded. Personal notes and provider identifiers/credentials are excluded. Album activity remains derived from its concrete track events; an album does not invent a track resume position.

Requests are limited atomically to **120 per token per minute**, shared across workers. A quota response includes `Retry-After: 60`. Unknown/repeated query parameters are rejected. Responses are private and not cached. Error bodies use:

```json
{"error":{"code":"insufficient_scope","message":"This endpoint requires collection:read."}}
```

Statuses: 400 invalid input, 401 invalid/revoked/expired token (with `WWW-Authenticate: Bearer`), 403 insufficient scope/onboarding incomplete, 404 missing endpoint/work or disabled medium, 405 unsupported method, 429 quota, 503 unavailable read model. Request correlation IDs remain in response headers. Provider connector claims and CORS grants are not exposed.

The proposed external provider connector protocol in [connectors.md](connectors.md) is separate and remains on the roadmap.


## Writes and retries

Every mutation requires its own permission, `Content-Type: application/json`, and an `Idempotency-Key` containing 1–128 letters, numbers, dots, underscores, colons or hyphens. The key is bound to the token, method, endpoint and canonical JSON body. Repeating that request returns the original response with `Idempotency-Replayed: true`, without another event or delivery. Reusing the key for a different request returns 409. Failed transactions leave no replay record. Responses, including subscription secrets, are encrypted at rest. Keys persist until their token is deleted; use a fresh key for each intended change.

| Method and endpoint | Permission | Body |
| --- | --- | --- |
| `POST /tracking` | `tracking:write` | `mediaId`, `action` (watch/unwatch/progress/drop/restore), optional position/duration, occurrence date, rewatch and acknowledgement |
| `POST /tracking/bulk` | `tracking:write` | Parent `mediaId`, action watch/unwatch/progress; optional includeSpecials, onReleaseDate, occurredAt, rewatch, acknowledged |
| `PUT /relationships/{workId}` | `relationships:write` | relationship collected/saved/favourite, boolean value |
| `PUT /ratings/{workId}` | `ratings:write` | value 0.5–5 in half-star steps, or null to remove |
| `POST /music/{workId}/listens` | `music:write` | Caller UUID batchId, optional occurredAt; albums atomically log known tracks |
| `POST /games/{gameId}/playthroughs` | `games:write` | Optional status planned/in-progress, platform, repeat |
| `PATCH /playthroughs/{playthroughId}` | `games:write` | status and/or progressPercent 0–100 |
| `POST /playthroughs/{playthroughId}/sessions` | `games:write` | UUID id, minutesPlayed 1–1440, past playedAt, optional owner-only note |
| `PUT /reading/{workId}/progress` | `reading:write` | Optional state planned/reading/completed/paused/dropped, page, totalPages; restart with state reading and page 0 for an explicit reread |
| `POST /webhooks` | `webhooks:manage` | url and events |
| `DELETE /webhooks/{webhookId}` | `webhooks:manage` | No body |

The authenticated account owns every change. Provider provenance and another user's identity cannot be supplied. Existing domain validation, history retention, conflict acknowledgement and provider delivery rules apply. Music and games require the installation's experimental gate. Machine credentials cannot change administrators, credentials, installation policy or another account.

The machine-readable description is available at `/api/public/v1/openapi.json`.

## Webhooks

`GET /webhooks` lists your subscriptions without their signing secrets. Subscribe to `tracking.changed`, `relationship.changed`, `rating.changed`, `music.listened`, `game.changed`, and `reading.changed`. Creation returns a random signing secret once (an idempotent replay returns the same secret). Up to ten enabled subscriptions per account are allowed. Endpoints must use public HTTPS on port 443, without credentials, query or fragment. Every delivery rechecks DNS/network policy; redirects and restricted addresses are rejected.

Changes and delivery intents commit together. The existing outbox retries independently of provider synchronization. Delivery is at least once: deduplicate the envelope's `id`. Each body has `id`, `type`, `occurredAt` and a small `data` object with relevant work/activity IDs and state. Private notes, provider credentials and unrelated account data are excluded. Imported events use their concrete domain change path; the envelope date is the emission time, not an invented historical watch date.

Verify `X-Coast-Signature: sha256=<hex>` using HMAC-SHA256 with the subscription secret over `X-Coast-Timestamp + "." + raw request body`. Reject old timestamps and compare signatures in constant time; do not reserialize JSON before verification. `X-Coast-Event-Id` matches the envelope ID. Reply with a 2xx status after safely accepting the event. Connection failures, 408, 429 and 5xx retry with the outbox's backoff; other 4xx and repeated failures require review in Jobs. Revocation/expiry of the creating token, disabling its account, or deleting the subscription prevents further delivery.
