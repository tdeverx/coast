<div align="center">
  <img src="static/coast-mark.png" alt="Coast mark" width="112" />
  <h1>Coast</h1>
  <p>A self-hosted home for what you watch, play and listen to.</p>
  <p>Your library, progress and friends, together in one place.</p>
  <p>
    <a href="https://github.com/tdeverx/coast/actions/workflows/verify-and-publish-preview.yml"><img alt="Build and preview image" src="https://github.com/tdeverx/coast/actions/workflows/verify-and-publish-preview.yml/badge.svg?branch=main"></a>
    <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg"></a>
  </p>
  <p><a href="#what-you-can-do">Features</a> · <a href="#experiments">Experiments</a> · <a href="#start-coast">Get started</a> · <a href="docs/README.md">Documentation</a></p>
</div>

> [!WARNING]
> Coast is an early preview. Updates can include breaking changes, so **back up your data before upgrading**. Databases from the earlier prototype are not supported.

Coast brings your media and personal tracking together without making your collection depend on one server. Browse what is available, keep a watchlist, resume an episode, and see what your friends are enjoying. Connect Jellyfin for playback and Trakt for personal tracking; add other services when you need them.

Films and TV are the core experience. Music, games and shared playback are available as optional experiments. Coast runs on your own server and stores its data there.

## What you can do

| Feature | In Coast |
| --- | --- |
| **Find your next title** | Discover trending and recent releases. For You combines Continue, Next, favourites, friend recommendations and activity with personalised rows that appear as you scroll. |
| **Keep your own collection** | Track progress, history, ratings, favourites, saved titles and lists, including titles that are not currently playable. Choose what automatically joins your Collection. |
| **Browse your libraries** | Explore connected media and switch on Collection or Available filters when you want them. Both filters default off in Library; profile libraries show that person's Collection. |
| **Play from Jellyfin** | Watch films and episodes with resume positions, subtitles and a persistent player. Request missing media through Seerr when it is configured. |
| **Stay connected** | Add friends, send recommendations, react to activity and see taste matches. Friends and notifications open in panels so you can keep browsing. |
| **Choose what you share** | Profiles default to friends only, with public and private options. Control live activity sharing separately, and choose a private site, public profiles only, or public read-only browsing. |
| **Manage your installation** | Invite users, choose signup requirements, inspect sync jobs and view current server streams and recorded session history. Developer mode pauses automatic work while keeping manual actions available. |
| **Build on your data** | Use scoped API tokens for reads and supported writes, plus signed webhooks. Run local benchmarks and keep a history of results. |

Personalised rows use cached provider suggestions and your own taste signals across enabled media. Friend popularity is part of those rows; recommendations do not automatically add items to your Collection.

### Sync you can follow

**Settings → Jobs & schedules** shows what is running, waiting, needs attention, is scheduled next, or is manual. Each task shows its last result and timing, with **Run now**, **Retry** and schedule controls where applicable. Long imports can pause at saved checkpoints so higher-priority work can proceed; initial imports take priority over routine background work. Detailed job history remains in the logs.

The optional [Jellyfin companion](docs/jellyfin-companion.md) provides server change hints, live activity and stream updates so Coast can target changed items. It also supports trailer crop analysis. Native polling remains available when the plugin is unavailable.

## Experiments

Administrators enable these separately in **Settings → Policies → Experimental features**. They default off; disabling one hides it without deleting saved data.

| Experiment | What you can try |
| --- | --- |
| **Music** | Browse Jellyfin artists, albums and tracks; keep listening history and queues; listen while browsing. Playable albums and tracks use Play as their main card action. |
| **Gaming** | Discover games through IGDB, import Steam ownership, playtime and supported achievement progress, and track playthroughs and sessions. Steam ownership is availability evidence, not proof of a local installation. |
| **Parties** | Invite friends into a shared video or audio session with synced playback, participant controls and buffering policies. Each person needs their own permitted source; listening also requires Music. |
| **Planning & calendar** | Schedule titles and reminders. Upcoming on For You shows known releases for watchlisted titles and tracked shows. |
| **Media detail overlay** | Open the existing hero and details over the page you are browsing, with a full-page option. Its presentation is still under review. |

Dynamic For You and personalised recommendations are standard features and no longer have experimental switches. The [experiment guide](docs/experimental-features.md) explains each feature's behaviour and limits.

## Still being refined

Coast is actively developed. These areas have implementations, but need broader acceptance or further polish:

- **Provider and playback compatibility:** real-account Trakt and Seerr journeys, reconnects, genuine sync conflicts and playback across more devices and sources.
- **Recommendations and first-run experience:** better exact-next-item choices, more useful guidance during imports, and clearer empty Collections for new users.
- **Performance and recovery:** continued measurement of imports, queries, rendering and resource use. Benchmarks and runtime diagnostics are available; a benchmark is not a live playback or browser performance test.
- **Social details:** validate privacy, live activity and taste scores with more real accounts, and revisit what friend avatars communicate.

See [release readiness](docs/readiness.md) and the [performance guide](docs/performance.md) for verification evidence. Fixture tests do not establish compatibility with every live provider or device.

## Planned and under consideration

These are roadmap ideas, not available features or promises of a release date.

**Planned follow-ups** include separate profiles under one account, playback without personal tracking, richer social recaps, and a dedicated pass on challenges and achievements. [The roadmap](docs/roadmap.md) records the privacy and provider requirements for these ideas.

**Ideas to revisit** include profile comparison charts, collaborative lists and groups, group queues and polls, chat or reaction overlays during parties, broader media such as books and comics, and more Library, search and playback conveniences. The chart gallery in the UI preview is a design exploration with fictional data, not a live statistics dashboard.

The full [roadmap](docs/roadmap.md) distinguishes selected work, parked proposals and open questions.

## Start Coast

Use Docker Desktop or another Docker installation with `docker compose` available. The default image includes Coast and PostgreSQL; no separate database service is required.

1. Create a folder for your installation and open a terminal in it.
2. Download the Compose file:

   **macOS, Linux, WSL or Git Bash**

   ```sh
   curl -fsSLo compose.yaml https://raw.githubusercontent.com/tdeverx/coast/main/compose.yaml
   ```

   **Windows PowerShell**

   ```powershell
   Invoke-WebRequest https://raw.githubusercontent.com/tdeverx/coast/main/compose.yaml -OutFile compose.yaml
   ```

3. Pull the preview image and start Coast:

   ```sh
   docker compose pull
   docker compose up -d --no-build
   ```

4. Open <http://localhost:3000> and create your administrator account. Enter a username, display name and matching passwords of 8–128 characters, including an uppercase letter, a lowercase letter and a special character. Email is optional for the first administrator.

The published image is `ghcr.io/tdeverx/coast:preview`, built for `linux/amd64` and `linux/arm64`. Compose exposes port `3000` and uses the persistent `coast-data` volume for the database, encrypted service credentials, artwork and runtime state. Keep that volume when updating.

### LAN access and reverse proxies

Set `ORIGIN` in `compose.yaml` to the exact address people use to open Coast, including the scheme and port. For example:

```yaml
ORIGIN: http://192.168.1.20:3000
```

Use your server's actual LAN address, then apply the change with `docker compose up -d --no-build`. Other devices can open that same address.

For a public domain, terminate HTTPS at your reverse proxy and use its public address, such as `ORIGIN: https://coast.example.com`. Administrators can keep the website private, allow public profiles only, or enable public read-only browsing; profile privacy still applies, and public browsing does not grant playback access. See [deployment](docs/deployment.md) for storage, proxy and external PostgreSQL configuration.

### Services and new accounts

Configure shared services in **Settings → Integrations**. Personal service accounts are linked under **Connections** or during registration.

In **Settings → Policies**, administrators choose:

- **Registration:** invite-only or open sign-ups.
- **Required connection:** Jellyfin, Trakt, either, or none.

The defaults are invite-only registration with Jellyfin required. Configure an approved Jellyfin server before inviting users under that policy. Administrators create expiring, single-use codes in **Settings → Accounts**.

New users create their Coast username, display name and password, connect their services, and optionally upload a profile picture or choose a connected-service image. Animated GIFs keep their animation. Selected initial imports finish on a loading screen before users enter the app; failed imports offer recovery actions.

Sign-in uses Coast credentials. Jellyfin is a media connection, not a sign-in method. Trakt onboarding imports history, progress, ratings, watchlist and lists without enabling outbound synchronization. Existing Jellyfin-only accounts need an administrator to set a Coast password.

### Updates

From your installation folder:

```sh
docker compose pull
docker compose up -d --no-build
```

Back up the database and the entire `secrets/` directory together before upgrading. The credential encryption key lives in that directory; restoring the database without its original key cannot recover saved provider tokens. See [backup and restore verification](docs/deployment.md#recovery-verification).

### Build from source

```sh
git clone https://github.com/tdeverx/coast.git
cd coast
docker compose up --build -d
```

This uses the same Compose configuration and persistent volume. Set `DATABASE_URL` in Compose to use an existing PostgreSQL database instead of the bundled one. The database must already exist, and its account must be allowed to run migrations. Keep `/data` mounted for credentials, artwork and runtime state in either setup.

## Connected services

| Service | What it adds |
| --- | --- |
| **Jellyfin** | Accessible server media, playback, activity import and supported tracking reconciliation. |
| **TMDB** | Film and TV metadata, discovery and background catalogue maintenance. |
| **Trakt** | Account linking, tracking and list imports, live activity and independently configured exports. |
| **Seerr** | Media requests and request status. |
| **IGDB** · experimental | Game search, metadata and catalogue imports. |
| **Steam** · experimental | Owned games, playtime and achievement progress, with ownership-based availability. |

Personal tracking, profiles and lists can work without connected services when the registration policy allows it. Server availability is separate from personal membership: owning or tracking something does not make it playable. Steam ownership does not prove a game is installed locally.

Provider settings determine what is imported and exported. Trakt Collection export is opt-in and uses previews for projection changes and cleanup. Live Trakt and Seerr acceptance still needs deliberate real-account testing.

Keep API keys and passwords in Coast's settings. Do not include them in source control or bug reports. Saved provider credentials are encrypted, and Coast has no telemetry.

More detail: [Collection and Library](docs/collection.md) · [Music](docs/music.md) · [Games](docs/games.md) · [Social](docs/social.md) · [Provider behavior](docs/providers.md).

## API access

Create scoped, expiring tokens in **Settings → API access** for catalogue, Collection, Library and progress reads, tracking and relationship writes, and signed webhooks. Writes require idempotency keys; tokens do not grant playback, administrator access or another user’s data. See the [Public API guide](docs/public-api.md) for endpoints, permissions, pagination and webhook verification.

## Develop Coast

Development requires **Bun 1.4.2** and PostgreSQL. Create a development database, then run:

```sh
bun install --frozen-lockfile
export DATABASE_URL='postgresql://coast:password@localhost:5432/coast'
export COAST_DATA_DIR="$PWD/.data"
bun run db:migrate
bun run dev
```

Open the URL printed by Vite, usually <http://localhost:5173>. The server also listens on network interfaces for LAN testing. Use a development database rather than your deployed installation's data.

Run the local checks with:

```sh
bun run code:inventory
bun run ui:inventory:check
bun run check
bun run test
bun run build
```

For database regression tests, provide a PostgreSQL account allowed to create disposable databases:

```sh
export TEST_DATABASE_URL='postgresql://postgres:password@localhost:5432/postgres'
bun run test:db
```

The runner creates and removes an isolated database for each suite; it does not run tests against the database named in that URL. Provider fixtures do not establish live-service compatibility.

Administrators can open **`/ui-preview`** to inspect the shared typography, colors, materials, elements and components, including the material tweaker. **`/ui-preview?section=charts`** contains the non-approved chart exploration with isolated fictional data; its fictional data stays in the preview. See [Chart preview](docs/chart-preview.md), [Contributing](CONTRIBUTING.md) and [Architecture](docs/architecture.md) for development conventions.

Administrators can run bounded local measurements in **Settings → Benchmarking** and compare compatible runs in the saved history. These measure selected database and server workloads, not browser rendering or live playback. The [performance guide](docs/performance.md) documents the shared optimisation patterns, isolated regression harness, measurement limits and runtime diagnostics.

## Project

- [Documentation](docs/README.md)
- [Deployment](docs/deployment.md)
- [Release readiness and known gaps](docs/readiness.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Coast is licensed under **AGPL-3.0-only**, and contributions use the same license. Connected services are independent of Coast. Coast is not endorsed or certified by TMDB.
