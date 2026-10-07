<div align="center">
  <img src="static/coast-mark.png" alt="Coast mark" width="112" />
  <h1>Coast</h1>
  <p>A self-hosted home for what you watch, play and listen to.</p>
  <p>
    <a href="https://github.com/tdeverx/coast/actions/workflows/verify-and-publish-preview.yml"><img alt="Build and preview image" src="https://github.com/tdeverx/coast/actions/workflows/verify-and-publish-preview.yml/badge.svg?branch=main"></a>
    <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg"></a>
  </p>
  <p><a href="#start-coast">Get started</a> · <a href="#connected-services">Integrations</a> · <a href="docs/README.md">Documentation</a> · <a href="#develop-coast">Development</a></p>
</div>

> [!WARNING]
> Coast is an early preview. Updates can include breaking changes, so **back up your data before upgrading**. Databases from the earlier prototype are not supported.

## Your media, together

- **Track your collection.** History, progress, ratings, favourites, saved titles and lists belong to you—even when the media isn't on a server. Library brings personal Collection and server browsing together, with separate Collection and Available toggles. Collection is on by default; automatic membership is configurable in your settings.
- **Pick up where you left off.** For You brings together Continue, Next, friend recommendations, favourites, activity and dynamic personalised rows, including popular titles among friends. Watching, playing and listening segments keep each medium within the same familiar layout.
- **Play from Jellyfin.** Stream films and episodes with resume positions and subtitles. Experimental music adds albums, tracks, repeatable listens, queues and audio that stays with you while browsing.
- **Share with friends.** Mutual friendships, activity, reactions, recommendations, live presence and taste comparisons. Sharing defaults to friends only, with public and private options. Notifications and friends live in persistent panels so you can keep browsing.
- **Watch or listen together.** Experimental parties support invitations, synchronized playback, participant controls and buffering policies. Each person uses their own authorized media source.
- **See what sync is doing.** Jobs groups tasks into Running, Waiting, Needs attention, Upcoming and Manual, with one compact row per service/task. Rows show user freshness, state or next run and the last result; action menus provide Run now, Edit schedule and detailed progress. Persistent job records retain the history. Background tasks discover missing user-linked TMDB records and refresh shared metadata. Long imports yield at committed checkpoints; each service serializes its scans and API requests while unrelated services can progress.

Music, games and parties are behind **Settings → Policies → Experimental features**. Films and TV remain the core experience. See [release readiness](docs/readiness.md) for verification limits; implemented features are not a guarantee of compatibility with every live provider or device.

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

Administrators can run bounded local measurements in **Settings → Benchmarks** and compare compatible runs in the saved history. These measure selected database and server workloads, not browser rendering or live playback. The [performance guide](docs/performance.md) documents the shared optimisation patterns, isolated regression harness, measurement limits and runtime diagnostics.

## Project

- [Documentation](docs/README.md)
- [Deployment](docs/deployment.md)
- [Release readiness and known gaps](docs/readiness.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Coast is licensed under **AGPL-3.0-only**, and contributions use the same license. Connected services are independent of Coast. Coast is not endorsed or certified by TMDB.

The optional [Jellyfin companion](docs/jellyfin-companion.md) adds authenticated trailer crop analysis and a shared change feed for targeted updates, live activity and server streams. Coast retains native polling when the companion is unavailable.
