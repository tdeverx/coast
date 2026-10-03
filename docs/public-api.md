# Read-only public API

Coast exposes a token-authenticated API at `/api/public/v1`. Browser `/api/v1` routes remain private application interfaces. Public API tokens never grant browser access, administrator privileges, provider credentials, playback streams or another user's data.

Create a token in **Settings → API access**, choose its read permissions and expiry (1–365 days, default 90), and copy the secret once. Coast stores only its SHA-256 hash. Revocation takes effect on the next request. Disabled accounts cannot use tokens; password changes and administrator account credential/role changes revoke them. Up to 20 active tokens are allowed per account.

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

Collection accepts `level` (all/root), `category`, `kind`, `relationship`, `activity`, `availability`, `source`, and `page`, using the same filters/preferences as Coast. Library accepts `category` (all/screen/game/music), `kind`, `source` (connection UUID/all), and `page`. It reads persisted accessible works and their parents; it does not contact provider browsing endpoints or expose personal tracking filters. Progress accepts `view` (watching/up-next/next/recommendations/watchlist/favourites/finished/dropped), `category`, `kind`, `scope`, and `page`. Games and music obey the installation's experimental gate; unsupported views return a validation error. Future media categories do not yet have concrete read models.

All lists return `items` and `pagination`: `page`, `pages`, `total`, `pageSize` (60), `next` and `previous` (relative URLs or null). Filters apply before pagination. Page inputs must be integers 1–10,000; pages beyond the current result are clamped to the final page. Catalogue ordering is stable by UUID. Pagination is a current-state read, not an immutable snapshot.

Public work DTOs include UUID, kind, title and year. Collection adds `availability`, `stale` and `reasons`. Progress adds available/current screen state; game items include their latest playthrough status, percentage and total logged minutes; music tracks include position, duration and play count when recorded. Personal notes and provider identifiers/credentials are excluded. Album activity remains derived from its concrete track events; an album does not invent a track resume position.

Requests are limited atomically to **120 per token per minute**, shared across workers. A quota response includes `Retry-After: 60`. Unknown/repeated query parameters are rejected. Responses are private and not cached. Error bodies use:

```json
{"error":{"code":"insufficient_scope","message":"This endpoint requires collection:read."}}
```

Statuses: 400 invalid input, 401 invalid/revoked/expired token (with `WWW-Authenticate: Bearer`), 403 insufficient scope/onboarding incomplete, 404 missing endpoint/work or disabled medium, 405 non-GET method, 429 quota, 503 unavailable read model. Request correlation IDs remain in response headers. No history/relationship writes, webhooks, connector claims, CORS grants or mutation idempotency are shipped by this read-only API.

The proposed external provider connector protocol in [connectors.md](connectors.md) is separate and remains on the roadmap.
