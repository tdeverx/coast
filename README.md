<div align="center">
  <img src="static/coast-mark.png" alt="Coast mark" width="112" />
  <h1>Coast</h1>
  <p>A self-hosted home for your movie and TV library, watch history and lists.</p>
  <p>
    <a href="https://github.com/tdeverx/coast/actions/workflows/verify-and-publish-preview.yml"><img alt="Build and preview image" src="https://github.com/tdeverx/coast/actions/workflows/verify-and-publish-preview.yml/badge.svg?branch=main"></a>
    <a href="LICENSE"><img alt="AGPL-3.0-only" src="https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg"></a>
  </p>
</div>

> [!WARNING]
> Coast is an early preview and may change in ways that require a fresh install. **Back up your data before upgrading.** This release does not migrate data from the earlier prototype.

## Start Coast

Coast runs in Docker Compose. Use **Docker Desktop** or another Docker installation where `docker compose` is available. Check that `docker compose version` works in a terminal before continuing.

1. Make a folder for this Coast installation and open a terminal in it.
2. Download Coast's Compose file into that folder. On macOS, Linux, WSL or Git Bash, run:

   ```sh
   curl -fsSLo compose.yaml https://raw.githubusercontent.com/tdeverx/coast/main/compose.yaml
   ```

   In Windows PowerShell, run:

   ```powershell
   Invoke-WebRequest https://raw.githubusercontent.com/tdeverx/coast/main/compose.yaml -OutFile compose.yaml
   ```

3. Pull the preview image and start Coast:

   ```sh
   docker compose pull
   docker compose up -d --no-build
   ```

4. Open <http://localhost:3000> and create the first administrator account. Coast requires a username and a password of at least 12 characters; email is optional.

The Compose file downloads the published `preview` image from GitHub Container Registry. It publishes Coast on port `3000` and creates a persistent Docker volume named `coast-data`. That volume contains the database, encrypted service credentials, cached artwork and runtime state. **Do not remove the volume when updating Coast.**

To use Coast from another device on your LAN, create a text file named `.env` beside `compose.yaml` and put this line in it, replacing the example with the IP address of the computer running Coast:

```dotenv
COAST_ORIGIN=http://192.168.1.20:3000
```

Then run `docker compose up -d --no-build` again. Open the same address from the other device. Coast does not configure your router or firewall.

> [!TIP]
> To update, run `docker compose pull` and then `docker compose up -d --no-build` in the installation folder. Preview updates can change the database schema; keep a backup before updating.

### If you prefer to build from source

Clone the repository, then build and start the Compose service from its root:

```sh
git clone https://github.com/tdeverx/coast.git
cd coast
docker compose up --build -d
```

The source-build command uses `http://localhost:3000` unless you create a `.env` file beside `compose.yaml` and set `COAST_ORIGIN` there. To use an existing PostgreSQL database, add `DATABASE_URL` to that file. The database must already exist and permit Coast to run migrations. Keep the `coast-data` volume in either setup. See [deployment and recovery](docs/deployment.md) before changing database or storage settings, exposing Coast beyond a trusted local network, or upgrading.

## What Coast connects to

Coast can connect to Jellyfin for library and playback, TMDB for metadata and discovery, Trakt for optional account linking and tracking, and Seerr for requests. These connections are optional; Coast's own profiles, lists, ratings and watch history work without them. Add shared service connections in **Settings → Integrations**, then link personal accounts under **Connections**. Trakt sync still needs more real-account verification before it should be relied on.

Keep API keys and passwords in Coast's settings. Do not put secrets in the image, a Compose file committed to Git, or a bug report.

## Develop Coast

Development requires Bun `1.4.2` and PostgreSQL. From the repository root, install the locked dependencies, configure a development database and data directory, migrate the database, then start the app:

```sh
bun install --frozen-lockfile
export DATABASE_URL='postgresql://coast:password@localhost:5432/coast'
export COAST_DATA_DIR="$PWD/.data"
bun run db:migrate
bun run dev
```

Open the local URL printed by Vite (usually <http://localhost:5173>). The dev server listens on network interfaces too; to test from another device on the same LAN, use the Network URL Vite prints. Do not point development at a real Coast database.

## Data and security

Back up the database and the entire `secrets` directory together. Coast encrypts saved provider credentials using a key in that directory; without it, those credentials cannot be read. Keep the Docker volume private to the installation administrator. For access over the public internet, terminate HTTPS at a trusted reverse proxy and set `COAST_ORIGIN` to the exact public HTTPS address. Coast has no telemetry.

## Project

- [Deployment and recovery](docs/deployment.md)
- [Project documentation](docs/README.md)
- [Release readiness and known gaps](docs/readiness.md)
- [Contributing](CONTRIBUTING.md)
- [License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

Coast is licensed under **AGPL-3.0-only**. Contributions are made under the same license. TMDB, Jellyfin, Trakt and Seerr are independent services; Coast is not endorsed or certified by TMDB.
