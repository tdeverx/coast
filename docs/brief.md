Build Coast from scratch as a polished, self-hosted media tracker and playback frontend.

Coast is a beautiful, local-first alternative to Trakt that also becomes a unified frontend for Jellyfin and, eventually, other media servers. The product must own its tracking data and remain useful without Jellyfin, Trakt, Seerr, or any other external service.

The 1.0 goal is a genuinely usable release candidate for tracking movies and television, managing lists and collections, discovering and requesting media, seeing local availability, and playing available Jellyfin media directly from Coast.

Use this document as the required source of truth. Do not invent additional product features or architectural layers. When something is genuinely unresolved, record it clearly rather than silently designing an elaborate solution.

The later approved [Collection and Library](collection.md) extension refines this brief: personal Collection is separate from accessible server content, uses shared work identities and relationships, and includes experimental music listening/audio and game relationships. Books, audiobooks and comics remain future concrete models. Existing schedulers, sign-in bindings, menus and media controls remain the foundation.

## Product identity

The product is named Coast.

Coast should feel calm, refined, cinematic and cohesive. Preserve the established Coast identity and selectively carry forward the proven component system, materials, player presentation and interaction patterns from the previous Coast prototype.

Do not copy the previous application architecture wholesale. Treat it as a working design and behavioural reference, not as the foundation of the new domain model.

The original Coast project informed the visual language and interaction patterns during the redesign. This repository contains the fresh implementation.

## Product principles

- Coast owns the user’s canonical tracking data.
- External services are integrations, not Coast’s database or source of truth.
- Movies and shows are the 1.0 focus, but the data model must allow future first-class media types such as books, audiobooks, comics and games.
- Build concrete media models rather than a generic EAV or arbitrary JSON system.
- Use the simplest architecture that fully supports the requirements.
- Make provider integrations modular and replaceable.
- Keep the default self-hosting experience simple.
- Admin setup can be technical; ordinary user operation should be easy.
- Prefer one cohesive application over microservices.
- Avoid speculative abstractions, compatibility shims and premature plugin systems.
- During the private 0.x period, clean schema resets are acceptable. Do not preserve obsolete structures through migrations until compatibility is actually required.
- Monetisation must always remain optional.
- Coast must remain freely source-available and buildable. Use AGPL-3.0-only with inbound-equals-outbound contributions unless instructed otherwise.

## Required stack

Use:

- Svelte 5
- SvelteKit
- TypeScript
- Bun as runtime, package manager and test runner
- PostgreSQL
- Drizzle for schema definitions, migrations and ordinary database access
- Raw parameterised SQL where it is clearer or more capable than Drizzle
- Tailwind CSS 4 as a utility layer
- CSS custom properties for semantic design tokens
- Reusable local Svelte components rather than an external component kit
- Valibot for validation at API and provider boundaries
- Native `fetch` for provider integrations
- Native browser `<video>` for playback
- `hls.js` when HLS transcoded playback is implemented
- Playwright only for a small number of valuable browser journeys

Do not add Supabase, Redis, Kafka, GraphQL, Temporal, Elasticsearch, Meilisearch, an auth framework, a general plugin runtime or frontend state-management framework without a demonstrated requirement.

Do not package FFmpeg inside Coast. Jellyfin remains responsible for transcoding.

Ask before adding any production dependency not explicitly authorised above.

## Deployment

The default installation should be one OCI/Docker container containing:

- The Bun/SvelteKit application
- Bundled PostgreSQL
- The minimal process supervision needed to run both

Use one persistent configuration/data mount containing database data, artwork cache, secrets and runtime state.

Also support an external PostgreSQL database through `DATABASE_URL`. When an external database is configured, do not start the bundled database.

TLS is expected to be handled by the user’s reverse proxy. Coast must work over ordinary HTTP on trusted local networks.

Do not add cloud telemetry for 1.0. Nothing should be sent to the Coast developers.

## High-level architecture

Keep Coast as one repository and one application.

Organise the application approximately around:

```text
src/
  lib/
    core/
      media/
      tracking/
      history/
      collections/
      lists/
      ratings/

    catalogue/
      canonical-media/
      metadata/
      overrides/
      availability/
      search/

    providers/
      contracts/
      tmdb/
      jellyfin/
      trakt/
      seerr/

    sync/
      jobs/
      imports/
      exports/
      conflicts/

    playback/
      planning/
      sessions/
      progress/
      scrobbling/

    server/
      auth/
      db/
      queue/
      security/
      notifications/

    ui/
      components/
      materials/
      tokens/
      icons/
      motion/

  routes/
    api/v1/
    ...
```

These folder names may be adapted where SvelteKit conventions make another arrangement clearer, but preserve the domain boundaries.

The normal execution path should be:

```text
UI
→ Coast application/domain service
→ provider capability contract
→ provider adapter
→ external service
```

UI components and routes must not directly implement Jellyfin, Trakt, Seerr or TMDB behaviour.

## Canonical media model

Create a canonical Coast media identity independent of every provider.

Use:

- A common media root for universal identity and lifecycle fields.
- Concrete movie tables.
- Concrete show tables.
- Concrete season tables.
- Concrete episode tables.
- External/provider ID mappings.
- Stable episode identity independent of the currently selected display order.
- Media relationships for collections, franchises and future related-media needs.

Do not represent every media type and field through an EAV table.

Future media types should be able to add their own concrete tables while reusing shared identity, lists, ratings, tracking and provider mappings.

Support alternate episode orders in the data model without breaking episode watch history. Specials should be independently trackable but excluded from completion calculations by default.

## Metadata model

TMDB is the primary global metadata source for 1.0, but Coast must not become a full mirror of TMDB.

Store a shared local snapshot of TMDB metadata only when an item becomes relevant, such as when it is:

- tracked by a user
- added to a list
- collected
- rated
- requested
- locally available
- needed for active discovery caching

The shared snapshot should be reusable by all Coast users.

Keep these layers separate:

1. Current provider snapshot
2. Administrator overrides
3. Administrator field locks
4. Per-user presentation overrides

Never overwrite the provider snapshot with an override.

Resolve displayed metadata in this order:

```text
user preference
→ administrator override
→ current provider snapshot
→ fallback provider data
```

If an administrator locks a field, skip the user override for that field.

Users may choose presentation fields such as a preferred poster without changing shared metadata. Administrators may override and lock titles, artwork and other important fields.

Retain provider source labels and update timestamps so metadata can be safely refreshed.

Provider-supplied metadata and images should be preferred for locally hosted items by default. Administrators may opt into using TMDB data exclusively. Users do not control that global metadata-source policy.

English is the initial interface and metadata default. Structure text for straightforward localisation. Search must match both the chosen-language title and original title. Users may prefer original titles and override their region. Age certificates follow the selected region.

## Tracking model

Coast is the authoritative tracker.

Support for 1.0:

- watched and unwatched state
- play count
- viewing progress
- watch history
- collected/library state
- watchlist
- favourites
- dropped state
- ratings
- custom lists
- show, season and episode tracking
- movie tracking
- collection/franchise presentation

Ratings use five stars with half-star increments. Ratings can apply to movies, shows, seasons and episodes.

Watch history should be append-only where practical, with derived current-state projections for fast reads.

A partially watched movie or episode belongs in Continue Watching.

A started show should not remain in the ordinary unstarted watchlist view. Its underlying saved state may remain recorded so the UI can filter between To Watch, In Progress, Complete and Dropped.

Removing something from the watchlist should happen once meaningful progress is established:

- one complete episode for a show
- the complete movie for a movie

Dropped items remain dropped until progress genuinely changes or the user manually changes the state. A no-op update must not undrop an item.

Watched state belongs to the canonical title or episode, not independently to every video edition. Different editions may maintain independent playback progress, but completing the title completes the canonical tracked item.

Flag suspicious destructive tracking actions. Examples include:

- marking an earlier episode unwatched after later episodes were completed
- marking later episodes watched while earlier episodes remain unwatched
- clearing substantial progress unexpectedly

Warn the user before destructive actions. Where an external service produces an obviously contradictory change, retain enough evidence to avoid blindly damaging Coast’s state.

Do not build an elaborate configurable source-of-truth matrix. Coast remains authoritative; provider imports and exports are explicit integration operations.

## Lists and collections

Support:

- Watchlist
- Favourites
- User-created ordered lists
- Personal Collected state, separate from server Library availability
- Provider-imported lists with their source retained
- TMDB collections/franchises as media relationships

Imported lists should be managed separately enough to support future resynchronisation.

A list may contain unavailable media. Availability and tracking are separate concerns.

## User and authentication model

Coast requires its own product identity and account model because it must function as a standalone tracker.

External accounts are linked connections belonging to a Coast user.

Provide:

- First-run administrator creation
- Secure local sessions
- Optional email address
- Linked Jellyfin accounts
- Linked Trakt accounts
- Future linked provider accounts
- Administrator-controlled account and integration policies

Keep the initial account-creation flow intentionally small. Do not build a large invitation or registration platform unless it is explicitly included in the project documentation.

Implement sessions using:

- HTTP-only secure cookies where applicable
- CSRF protection
- sensible rotation
- administrator-configurable lifetime
- refresh activity that can extend an active session

If a session expires while a page is already open, allow that loaded session to continue safely where possible, notify the user that authentication has expired and require reauthentication on reload or before a sensitive operation. Offer an immediate reauthentication action.

Password recovery should support an optional single-use recovery credential file in the persistent configuration mount:

- read only during application startup
- consume and delete it immediately
- require a restart to introduce a new recovery credential
- create only a temporary disposable recovery identity/session
- never persist the recovery session across restarts

Use Bun’s secure password hashing facilities and authenticated encryption for stored provider credentials.

## Provider model

Represent integrations through:

- Provider definitions, such as Jellyfin or Trakt
- Service instances, such as a particular Jellyfin server
- User connections/accounts on an instance
- Provider items linked to canonical Coast media
- Capabilities implemented by each provider
- Per-user access and availability

Capability contracts should cover:

- authentication
- catalogue access
- metadata
- availability
- playback
- scrobbling
- tracking import/export
- list import/export
- requests

Each adapter implements only the capabilities it actually supports.

First-party adapters must be explicit code, not configuration-driven magic.

Design a versioned HTTP/webhook connector API for future external integrations, but do not implement an untrusted JavaScript plugin runtime inside Coast for 1.0.

## Jellyfin integration

Jellyfin is the primary media-server target for 1.0.

Each Coast user may connect their own account to a Jellyfin server. The architecture must allow different users to connect to different servers and must permit multiple connections later.

The 1.0 interface may keep this simple, but the schema and provider boundaries must not assume one global Jellyfin account.

For arbitrary user-supplied server URLs, protect against SSRF:

- allow the administrator to disable arbitrary servers
- support server allowlists
- restrict protocols and ports
- reject unsafe redirects
- protect against DNS rebinding
- apply strict timeouts and response limits
- verify that the endpoint is actually Jellyfin
- store and verify the Jellyfin server identity

Maintain a local availability projection rather than querying Jellyfin from scratch on every screen.

The availability projection should record:

- canonical media mapping
- Jellyfin instance
- Jellyfin item ID
- user access
- media source information needed to plan playback
- edition/version labels where provided
- last verification time
- availability state

Synchronisation should support:

- initial library scan
- incremental/recent-item scans
- checkpoints
- reconciliation after missed updates
- safe removal or invalidation of disappeared items

Do not import unnecessary full library metadata when an availability record and provider mapping are sufficient.

## Playback

Use two persistent media elements at the application level, reflecting the later approved playback design. Do not create unrelated video players per route.

- A dedicated hero trailer player occupies the active hero.
- A title player behind the content handles full playback and post-play.
- Pausing the title reveals browsing content and allows the hero trailer to run; resuming hides the content and pauses the hero.
- There is no separate Show UI switch.

Navigation must not unnecessarily destroy an active trailer or playback session.

For Jellyfin playback:

1. Request Jellyfin playback information through its API.
2. Evaluate all media sources.
3. Prefer compatible direct play.
4. Respect administrator policy and source-specific bitrate limits.
5. Fall back to Jellyfin transcoding when permitted.
6. Use native playback where supported.
7. Use `hls.js` for compatible HLS playback when required.
8. Report progress to Coast.
9. Optionally report live progress to configured external connections.

Administrators need a global playback-delivery policy:

- Allow direct and relayed/transcoded playback
- Relay/transcode only

Do not expose a user control that violates administrator policy.

Quality selection must distinguish:

- quality/source/version
- edition

Edition is a first-class selector on the playback/details screen. Source and quality selection should automatically choose the best version for the device, user preference and administrator limits, with a manual override where allowed.

Playback sources should display their provider so future Jellyfin, Plex, Emby or other sources can coexist.

Subtitles should support:

- administrator defaults
- user preferences
- preferred languages
- always enable subtitles
- optional prompt before playback
- manual switching during playback

When playback fails, show a concise user-facing error and automatically create an administrator-visible diagnostic event. Do not tell ordinary users to diagnose Jellyfin.

## Trakt integration

Trakt is optional and configured using administrator-supplied application credentials.

Each user may connect their own Trakt account.

Allow users, within administrator policy, to independently enable synchronisation for:

- watch history and progress
- collected/library state
- ratings
- watchlist
- custom lists
- live scrobbling

Coast remains authoritative after import.

Store imported records with their source and provider identity. Retain disconnected Trakt-originated tracking data so reconnecting later can reconcile it.

Use a durable outbound queue so Trakt outages do not block Coast. Provide deterministic conflict handling and an audit trail without implementing a giant source-authority engine.

## Seerr integration

Seerr support is required for 1.0.

A Seerr instance is associated with the media-server instance it manages.

Support:

- discovery of unavailable titles
- request creation
- request state
- viewing and managing a user’s requests
- administrator/moderator request management when Seerr permissions allow
- movie requests
- partial season requests
- standard and 4K request variants
- duplicate prevention per item, server and relevant season scope

When requesting, show each destination server once. If the user may request 4K, expose a 4K toggle within that server choice rather than listing the server twice.

If some seasons were requested by another person, show them as unavailable for cancellation while still permitting unrequested seasons.

Request presentation rules:

- If an item is available from any permitted source, the primary action is Play or Resume.
- Request actions then live in the contextual menu when still relevant.
- If unavailable everywhere and requestable, the primary action is Request.
- For partially available shows, use Request More.
- Hide request actions when the user lacks permission or there is nothing valid left to request.
- A request can optionally add the item to the watchlist through one simple checkbox, enabled by default.
- Requests cannot be hidden.
- Provide a dedicated Requests page.

Issues are post-1.0 unless required by the underlying request workflow.

## Discovery, search and navigation

Primary navigation:

- For You
- Library
- Discover
- Search

For You:

- Personalised home
- Continue Watching
- Watchlist
- Recently watched or relevant activity
- Recommendations such as “because you watched”
- Dynamic horizontal shelves
- A user-relevant hero

Library:

- Dedicated local availability browser
- No hero
- Switch between media types
- Filter by source, availability and tracking state
- Support All and Available scopes
- Designed to accommodate future books, games and other types

Discover:

- Titles not necessarily available locally
- Seerr/TMDB-backed discovery
- Trending and recently released material
- Request-oriented presentation
- Hero may use Seerr/TMDB trending items

Search:

- Unified search
- Available results ranked and presented first
- Unavailable/requestable results clearly separated
- Search both local/provider data and global metadata
- Support original and translated titles
- Allow future switching between media types such as people, games and books
- Results may open a detail modal without losing search position
- Every item must also have a stable shareable details URL

Use polling where updates are needed. Do not introduce WebSockets solely for convenience.

## Core page and hero behaviour

Use the established unified Coast hero system across applicable screens.

The same hero presentation should be reusable for:

- For You
- Discover
- Movie details
- Show details
- Collection details

Library does not need a hero.

The hero should:

- span edge-to-edge
- extend behind the persistent header
- keep its content within the selected content-width preference
- begin with artwork
- wait a few seconds before starting a trailer
- keep artwork visible until the trailer and any crop information are ready
- return to artwork when the trailer pauses, stops or ends
- pause or stop video when no longer visible
- transition between items with a fade rather than a slide
- support controlled one-item horizontal trackpad/wheel navigation
- support seamless presentation handoff from Discover/For You to details
- avoid restarting the same trailer during that handoff
- keep artwork, logo, metadata and gradients pixel-consistent between contexts

Hero actions are context-aware:

- Discover: Learn More
- Movie: Play Movie or Resume Movie
- Show: Play or Resume the next episode, labelled with `S00E00`
- Collection: Start Collection or Resume Collection

Follow the primary action with high-value icon actions, then a contextual overflow menu.

## Persistent interface layers

Structure the application into three persistent layers.

Top layer:

- Always-on-top application header
- Coast icon and name
- Primary navigation
- Notifications
- User menu
- No page-transition animation
- Optional contextual filter/control row below it

Content layer:

- Route content
- May transition or hand off between pages
- Use a restrained fade-out/fade-in for ordinary route changes
- Preserve heroes when performing a hero-to-detail handoff

Bottom layer:

- Two persistent players: a dedicated hero trailer and a title player behind the content
- Title play/pause controls content visibility; both players retain their positions across navigation
- One persistent media control bar when relevant

The media control bar should visually relate to the primary navigation material and include:

- Play/pause
- Scrub bar
- Current time and duration
- Subtitle control
- Quality/source control
- Crop control for full playback
- Show/hide UI control
- Contextual overflow menu

Hero trailers are always presentation-cropped when reliable crop information exists. Full playback exposes a unified crop toggle that accounts for both encoded black bars and viewport fitting.

## Design system

Carry forward the useful Coast design language:

- Inter
- Semantic CSS tokens
- Clear glass material
- Opaque light and dark glass materials
- Blur fallbacks
- Shared strokes, inner highlights, shadows and radii
- Consistent icon sizes
- Segmented sliding pills
- Unified context menus and nested menus
- Unified buttons and icon buttons
- Unified cards, posters, thumbnails and shelves
- Unified motion timings
- Persistent nav and player materials
- Material/element editor where it remains useful

Glass, fallback blur and related effects must be reusable materials, not independently recreated CSS on every component.

The default stable glass implementation should remain separate from experimental rendering methods.

Every new visible pattern must either use an existing reusable component or become a reusable component. Do not create route-specific lookalikes with slightly different spacing and tokens.

Preserve established UI and UX once approved. Do not perform unsolicited redesigns.

## Content width and responsive behaviour

Heroes always remain edge-to-edge.

Hero content and ordinary page content obey a user preference:

- Full-width content, enabled by default
- Constrained content width

Desktop navigation displays icons and text. Compact/mobile navigation may use icons alone.

Use responsive layouts rather than device-specific duplicated interfaces wherever possible.

Scrollable shelves must allow enough visual overflow for future hover effects without clipping cards.

## External action queue

If Jellyfin, Trakt, Seerr or another connected service is temporarily unavailable, Coast itself should remain usable.

Store outbound external actions in PostgreSQL.

Requirements:

- no default expiry
- ordered execution per user and connection
- retry with backoff
- replacement/compaction of obsolete pending edits
- visible pending state where useful
- allow users to cancel pending actions
- notify the initiating user if an action reaches a genuine failure state
- remove transient failure notifications if the retry later succeeds

This queue is for unavailable external services. Coast does not need offline browser support when the Coast backend itself is unavailable.

Use PostgreSQL row locking and an outbox/job model. Do not add Redis or another queue service.

## Notifications

Maintain a persistent per-user notification inbox.

Notification presentation levels:

- Silent: inbox only
- Normal: temporary toast plus inbox
- Persistent: requires dismissal

Administrators may:

- control defaults
- send important notices
- prevent a particular notice from being silenced
- disable user silencing globally if needed

Relevant notifications include:

- request approvals or denials
- requested/watchlisted media becoming available
- failed external sync actions
- administrative broadcasts
- future social interactions

## Administration

Provide a unified Settings area with user, account and administrator sections rather than separate disconnected settings applications.

The administrator landing page should focus on:

- System health
- Integration health
- Activity
- Requests needing attention
- Failed jobs/actions
- Important notifications

Keep secondary administrator pages minimal and task-oriented.

Administrators need visibility into user/provider state for support and debugging. This is an administrative capability, not ordinary social access.

Settings may require a service restart when that is the honest and simplest implementation. Clearly label those settings instead of removing them.

Provide a reset-to-administrator-defaults action for user-overridable settings.

## Security and privacy

Protect:

- Local credentials
- Provider access and refresh tokens
- Session secrets
- Arbitrary provider URLs
- Playback authorisation
- Administrator actions
- Destructive account actions

Never expose raw provider tokens to the browser unnecessarily.

Use capability and permission checks in application services, not merely hidden UI controls.

Deleting a Coast user should offer:

- Delete only the Coast account
- Also attempt deletion of linked service accounts where supported and explicitly selected

Never silently delete external accounts.

## Future foundations, not 1.0 implementation

The schema should avoid blocking these areas, but do not build their user interfaces for 1.0:

- Books
- Audiobooks
- Comics
- Games
- Plex
- Emby
- Simkl
- External connector API ecosystem
- Social friends
- Profiles and statistics
- Reactions
- Personal and global recommendations
- “Watch together” invitations
- Temporary anonymous sharing links
- Multiple profiles under one account
- Offline browser operation
- Human-readable in-app changelogs
- Issues from Seerr
- Advanced accessibility settings
- Full plugin integration

For future social functionality, user relationships belong to the Coast installation rather than external providers. External social information, such as Trakt friends who watched something, may still be displayed with its source clearly labelled.

Do not distort the 1.0 architecture to prebuild these features.

## Documentation

Before major implementation, create concise source-of-truth documentation covering:

- Product scope
- 1.0 requirements
- Explicit non-goals
- Architecture
- Domain model
- Provider contracts
- Database model
- Tracking semantics
- Metadata resolution
- Playback planning
- Sync and queue semantics
- Security boundaries
- UI architecture
- Design-system inventory
- Future roadmap
- Open questions

Keep documentation updated as implementation decisions are made.

Documentation should be readable by humans and useful to future coding agents. Avoid repeated prose across many files; link to one authoritative explanation.

## Implementation approach

Work proactively and continue through work that does not require product-owner input.

Use subagents selectively for bounded, parallel work such as provider research, schema review or security review. Do not spawn them excessively or duplicate work.

Prefer substantial implementation passes followed by proportionate verification. Do not interrupt progress to test every tiny edit.

Do not:

- invent new features
- create unnecessary abstractions
- preserve obsolete 0.x structures
- make every concept generic
- add speculative configuration
- build every future provider now
- continually expand the goal after its requirements are complete
- commit, push, publish or deploy unless explicitly authorised

When a consequential product choice is missing:

1. Record it in the open-questions document.
2. Continue with independent work.
3. Ask the user only when the answer is truly required to proceed safely.

Make reasonable, documented defaults for ordinary implementation details.

## Suggested delivery order

1. Establish source-of-truth documentation.
2. Establish the new database and canonical domain model.
3. Implement authentication and first-run administration.
4. Implement TMDB metadata ingestion and overrides.
5. Implement Coast-native tracking, ratings, lists and history.
6. Implement provider contracts.
7. Implement Jellyfin authentication and availability projection.
8. Implement the persistent playback engine.
9. Implement Trakt import/export and scrobbling.
10. Implement Seerr discovery and requests.
11. Port and consolidate the Coast design system.
12. Build For You, Library, Discover and Search.
13. Build details, lists, requests, settings and administration.
14. Complete integration, security and failure-handling passes.
15. Perform focused browser and provider validation.
16. Produce a clear 1.0 readiness report.

## Definition of done

The goal is complete only when Coast provides a coherent 1.0 release-candidate implementation in which:

- A new administrator can complete first-run setup.
- Users can securely sign in.
- Movies and shows can be discovered and searched.
- Relevant TMDB metadata is stored locally and refreshed.
- Admin and user metadata overrides resolve correctly.
- Users can track movies, shows, seasons and episodes.
- Users can manage watchlist, favourites, collections, ratings and custom lists.
- Users can connect a Jellyfin account.
- Coast maintains a usable local availability projection.
- Available media can be directly played or transcoded according to policy.
- Playback progress updates Coast correctly.
- Users can optionally connect and synchronise Trakt.
- Users can discover and request unavailable media through Seerr.
- External outages produce queued, retryable actions rather than lost state.
- The core interface follows the consolidated Coast design system.
- The persistent header, hero and player architecture works coherently.
- The default container works with bundled PostgreSQL.
- External PostgreSQL remains supported.
- Security-sensitive operations are enforced server-side.
- Documentation matches the implementation.
- Remaining post-1.0 work is explicitly listed without being partially invented.

Once these requirements are genuinely satisfied, stop the goal. Do not continue inventing cleanup projects, features or architectural rewrites merely to remain active.
