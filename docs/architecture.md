# Architecture and boundaries

One SvelteKit application runs on Bun and PostgreSQL. Svelte 5 components call Coast services through same-origin server routes; only server services call provider adapters. Drizzle defines concrete tables and handles ordinary queries. Parameterised SQL is appropriate for locks, search, queue claims and transactional projections. Bun's native SQL driver avoids an extra database dependency.

## Domain and database

Every movie, show, season and episode has a UUID in `media`. Concrete subtype tables describe the hierarchy. Provider identifiers map onto those identities; they never replace them. Episode orders map stable episode IDs to display positions. Relationships express collections and franchises. New media kinds may add tables while reusing identity, lists and tracking.

Provider metadata snapshots remain separate from administrator overrides/locks and per-user presentation preferences. A shared snapshot is retained only for relevant or actively cached items. Tracking events preserve source identity and idempotency; per-user state projects events for fast reads. Playback progress can be source-specific while completion belongs to the canonical item.

Provider definitions, service instances, per-user connections and per-user availability are separate. Service credentials are encrypted at rest. Availability is a local projection, never a live request on each card. Jobs and outbound actions live in PostgreSQL with per-connection ordering, retry and audit state.

## Application modules

- `core`: canonical tracking, history, ratings, ordered lists and collection state.
- `catalogue`: metadata resolution, canonical ingestion, search and availability.
- `providers`: shared capability contracts, integration configuration in `instances.server.ts`, account connections beside each provider's adapter, and Seerr request handling in `seerr/requests.server.ts`. Queue handlers and maintenance scheduling have separate server modules. Routes import the module that owns each operation directly.
- `sync`: Jellyfin library/state synchronisation, Trakt imports, value exports and list exports have separate modules. `changes.ts` keeps canonical writes and outbound intent in one transaction; reconciliation, conflict preferences and history removal remain shared.
- `playback`: source planning, authorised sessions, progress and external scrobbling.
- `server`: database, local auth, encryption, network policy, queue and notifications. `server/queries` contains the read models for media details, home, library, lists and requests; routes import the relevant query directly.
- `ui`: shared Svelte components, icons, semantic tokens, materials and motion.

Native title creation belongs to `core/media`, alongside its transactional subtype and tracking writes. Query modules only read state. Library, Lists and Requests share page bounds and size, select before resolving media cards, and retain complete membership for explicit detail queries. Ordinary inbox, action and user projections use Drizzle column selection, so their camelCase field names and types match the UI without conversion fallbacks.

Settings navigation labels and administrator-only section membership come from `settings/sections.ts`, shared by the page and its server loader. `MediaActions` owns tracking and playback actions; `MediaRequestMenu` owns request-option loading and menu presentation, while confirmation and request dialogs retain their existing placement.

Provider objects and unvalidated JSON do not cross into the UI. JSON is reserved for provider boundary snapshots, constrained settings and action payloads; core identity and tracking are concrete columns.

## Security boundaries

Passwords use Bun Argon2id. Random session secrets are hashed in storage and held in HTTP-only SameSite cookies, Secure on HTTPS; trusted LAN HTTP remains supported. Mutating requests check origin and authenticated permissions. Administrative checks live in services/routes. Sensitive operations require a current session; an already-loaded expired session can retain safe local presentation while displaying a reauthentication action, never bypass authorisation.

Stored credentials use authenticated encryption with a persistent key under the single data mount. Startup-only recovery consumes a single-use file and creates an in-memory identity valid only for that process lifetime. No provider token is sent to browser code.

User-supplied provider URLs are server-policy controlled: HTTP(S), allowed ports/hosts, explicit LAN allowances, validated DNS targets, no unsafe redirects, bounded responses and deadlines. Identity checks bind Jellyfin connections to the expected server. Playback relays enforce ownership and target policy. Errors presented to users are concise; detailed diagnostic events are visible only to administrators and redact credentials.

## Deployment

One OCI container starts PostgreSQL and Bun under minimal supervision. `/data` stores database, keys, artwork and runtime state. `DATABASE_URL` selects an external database and skips local PostgreSQL startup. Reverse proxies handle TLS. There is no telemetry. The development environment follows the same PostgreSQL schema.

## Future connector contract

`/api/v1` is the versioned authenticated HTTP boundary. Future webhook connectors must have explicit capability grants, per-user/instance identities, request IDs, bounded validated payloads and replay protection. Arbitrary executable code is out of scope. No generic plugin platform is implemented. The [proposed connector protocol](connectors.md) defines the versioned endpoints, scoped credentials, idempotency and webhook verification without shipping that future runtime.
