# Architecture and boundaries

One SvelteKit application runs on Bun and PostgreSQL. Svelte 5 components call Coast services through same-origin server routes; only server services call provider adapters. Drizzle defines concrete tables and handles ordinary queries. Parameterised SQL is appropriate for locks, search, queue claims and transactional projections. Bun's native SQL driver avoids an extra database dependency.

## Domain and database

Every work has a UUID, category and kind in `works`. Existing screen and game UUIDs and URLs are preserved. Concrete screen, game and music tables own metadata and activity; artists remain credit/browsing entities. Provider identifiers map onto canonical identities and server item IDs are scoped to their service instance. Episode orders reference stable episode IDs; relationships describe membership and order. Future media types add concrete tables using the shared identity and personal relationships.

Provider metadata snapshots remain separate from administrator overrides/locks and per-user presentation preferences. A shared snapshot is retained only for relevant or actively cached items. Shared Collected, watchlist, favourites, ratings, ordered lists and queue membership use canonical works. Screen watches, game playthroughs/sessions and music listens/progress retain their concrete activity models and retry identities. Server presence alone does not create personal Collection membership.

Provider definitions, service instances, per-user connections and per-user availability are separate. Service credentials are encrypted at rest. Availability is a local projection, never a live request on each card. Jobs and outbound actions live in PostgreSQL with per-connection ordering, retry and audit state.

## Application modules

- `core`: canonical tracking, history, ratings, ordered lists and collection state.
- `catalogue`: metadata resolution, canonical ingestion, search and availability.
- `collection`: personal membership and access assessments, missing demand, source-change previews and managed Trakt Collection projection.
- `music`: provider browsing, persisted albums/tracks and credits, retry-safe listen batches and ordered audio queues.
- `providers`: shared capability contracts, integration configuration in `instances.server.ts`, account connections beside each provider's adapter, and Seerr request handling in `seerr/requests.server.ts`. Queue handlers and maintenance scheduling have separate server modules. Routes import the module that owns each operation directly.
- `sync`: Jellyfin library/state synchronisation, Trakt imports, value exports and list exports have separate modules. `changes.ts` keeps canonical writes and outbound intent in one transaction; reconciliation, conflict preferences and history removal remain shared.
- `playback`: source planning, authorised sessions, progress and external scrobbling.
- `server`: database, local auth, encryption, network policy, queue and notifications. `server/queries` contains the read models for media details, home, library, lists and requests; routes import the relevant query directly.
- `ui`: shared Svelte components, icons, semantic tokens, materials and motion.

Native title creation belongs to `core/media`, alongside its transactional subtype and tracking writes. Query modules only read state. Collection, Library, Lists and Requests filter and count before selecting bounded 60-item pages and resolving media cards. Explicit detail queries retain complete membership. Collection uses the profile owner's personal reasons and the visitor's source permissions. Ordinary inbox, action and user projections use Drizzle column selection, so their camelCase field names and types match the UI without conversion fallbacks.

Settings navigation labels and administrator-only section membership come from `settings/sections.ts`, shared by the page and its server loader. `MediaActions` owns tracking and playback actions; `controls/requests.svelte.ts` owns lazy request-option loading, with Button supplying menu presentation, while confirmation and request dialogs retain their existing placement.

Provider objects and unvalidated JSON do not cross into the UI. JSON is reserved for provider boundary snapshots, constrained settings and action payloads; core identity and tracking are concrete columns.

## Security boundaries

Passwords use Bun Argon2id. Random session secrets are hashed in storage and held in HTTP-only SameSite cookies, Secure on HTTPS; trusted LAN HTTP remains supported. Mutating requests check origin and authenticated permissions. Administrative checks live in services/routes. Sensitive operations require a current session; an already-loaded expired session can retain safe local presentation while displaying a reauthentication action, never bypass authorisation.

Stored credentials use authenticated encryption with a persistent key under the single data mount. No provider token is sent to browser code.

User-supplied provider URLs are server-policy controlled: HTTP(S), allowed ports/hosts, explicit LAN allowances, validated DNS targets, no unsafe redirects, bounded responses and deadlines. Identity checks bind Jellyfin connections to the expected server. Playback relays enforce ownership and target policy. Errors presented to users are concise; detailed diagnostic events are visible only to administrators and redact credentials.

`user_identities` retains historical Jellyfin identity bindings; authentication now uses Coast credentials. Registration captures the configured connection requirement and onboarding gates access on successful account-scoped initial imports. Separate `sync_accounts` retain provider account and pinned-service evidence for baselines, delivery and projection ledgers. Account generations prevent queued or running work from using replacement credentials. Trakt uses its stable account UUID; a fresh authenticated matching profile can upgrade an older slug binding without losing same-account provenance.

## Deployment

One OCI container starts PostgreSQL and Bun under minimal supervision. `/data` stores database, keys, artwork and runtime state. `DATABASE_URL` selects an external database and skips local PostgreSQL startup. Reverse proxies handle TLS. There is no telemetry. The development environment follows the same PostgreSQL schema.

## Future connector contract

`/api/v1` is the versioned authenticated HTTP boundary. Future webhook connectors must have explicit capability grants, per-user/instance identities, request IDs, bounded validated payloads and replay protection. Arbitrary executable code is out of scope. No generic plugin platform is implemented. The [proposed connector protocol](connectors.md) defines the versioned endpoints, scoped credentials, idempotency and webhook verification without shipping that future runtime.

## Ownership and naming conventions

`application/*.server.ts` owns a focused workflow spanning domains, such as configuration changes or disconnecting/disabling a source with Collection cleanup approval. Provider repositories own instance/account storage and adapter access; they do not call Collection workflows. Canonical Trakt identity resolution lives in `catalogue/trakt-identity.server.ts`, below import, list and projection callers. Pure TMDB artwork URL construction lives beside its adapter without importing server ingestion.

`server/api/index.server.ts` retains the common authentication, viewer/subject, body-size and error boundary. Domain handlers in `server/api` dispatch existing commands and read projections. The route file exports the existing HTTP methods; URLs, account-generation checks and outbox ordering remain stable. This is not a universal data orchestrator or a second scheduler.

Use `.server.ts` for new server-only services and `.svelte.ts` for reactive component resources. Pure contracts/mapping helpers use `.ts`; rendered components use PascalCase `.svelte`. Existing `core` and `server/queries` modules keep their established ownership until a bounded domain change warrants moving them. Do not cosmetically rename persisted identifiers, migrations, UUIDs or routes.

Use `workId` for shared work identities, `instanceId` for a configured service, `connectionId` for a user's linked account, `subjectId`/`ownerId` for whose relationships are displayed, and `viewerId` for whose permissions apply. Existing `mediaId` database/API contracts remain unchanged. A provider's external ID is not a Coast UUID and server IDs require an instance scope.

The shared Shelf renderer consumes a discriminated local/page/cursor pagination contract. Pure Library/Collection filter mapping lives in `library.ts`; source adapters own cancellable loading and medium-specific data, rather than separate rendering implementations. Mutations use the injected client, targeted `coast:*` route dependencies and one local resource refresh. The viewer injects local API and playback contexts without replacing global fetch or the real controller.

`bun run ui:inventory` generates rendered component composition and production consumers using the Svelte compiler. `bun run ui:inventory:check` validates the saved manifest and preview recipe coverage in CI. Preview components load only when needed, retain state after first viewport activation, and link to their direct composition and consumers.

## Steam games

Steam uses Valve OpenID to link the authenticated Coast user to a verified SteamID64; the administrator's Web API key is encrypted and sent only in the `x-webapi-key` header to Valve's fixed API origin. Linking does not create a Coast sign-in identity. Single-use challenges pin the callback, issuer, signed account, nonce and owner. Same-account reconnect retains the existing synchronization-account evidence and import preferences; account switches invalidate queued work through existing account generations.

`steam.sync` imports a complete owned-game response into the shared games registry, personal Collected state and account-scoped cumulative playtime. Exact Steam AppIDs link to IGDB only through matching verified Steam store URLs. A metadata outage leaves usable minimal Steam records. A separate shared `igdb.steam-metadata` task enriches verified Steam identities without delaying ownership completion or changing UUIDs. A complete traversal publishes negative ownership; private, incomplete and failed reads retain previous positive evidence. Ownership is availability evidence, with installation explicitly unknown. Imported totals never manufacture dated sessions or completion.

`steam.achievements` rotates through at most 20 eligible owned games per run, retaining per-account unlock state and reported dates. Missing dates remain unknown. Failed titles retain prior progress and rotate rather than starving the batch. The existing Connections preferences, experimental gate, Jobs schedules and outbox provide controls and durable execution; no second scheduler or production dependency is introduced.

Provider traversal jobs run one at a time per service instance. Atomic claims and held PostgreSQL advisory locks prevent overlapping traversals even during stale-lease recovery. Long imports commit bounded chunks and release their worker and service lane between chunks. Request intent can promote existing work; a common per-origin HTTP lane admits urgent requests between background requests while retaining rate limits and fairness. Playback reports and user edits keep their existing connection lanes. Retry backoff and actual provider cooldown are reported separately; only an active worker's confirmed rate-limit/service response can publish a service cooldown.


Job purposes distinguish playback, user actions, initial imports, manual requests, live observations and scheduled maintenance. Account-scoped deduplication pins both connection and account generation; service metadata uses instance scope. Manual priority promotion retains retry and service cooldown gates. Initial imports have reserved urgent worker capacity, and aging prevents ready background work from starving. The Queue read model uses the same priority calculation as claims.

Trakt category observations and list members are staged in PostgreSQL before authoritative reconciliation. Fetch cursors, applied markers and account generations survive yields and restarts; activity fences protect removal decisions. Steam ownership retains its complete upstream census in a job-scoped snapshot and publishes absence only after every title is committed. Snapshots and stages are removed on successful completion, cancellation or account replacement, with retention as a final bound. See [job scheduling](job-scheduling.md).
