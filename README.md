# Coast

Coast is a self-hosted movie and television tracker with playback, watch history, ratings, lists, discovery and profiles. Connect Jellyfin for your library and playback, TMDB for metadata and discovery, Trakt for optional account linking and tracking, and Seerr for requests. Coast's own tracking works without those services.

> **Early testing preview.** Coast is under active development. Back up your data before upgrades, expect breaking changes, and report problems with a reproducible description. This version requires a fresh installation; it does not migrate databases from the deleted prototype.

## Run with Docker Compose

Install Docker Engine with the Compose plugin. Create a folder for your Coast installation, save the [Compose file](compose.yaml) there, then run:

```sh
mkdir coast && cd coast
curl -fsSLO https://raw.githubusercontent.com/tdeverx/coast/main/compose.yaml
docker compose pull
COAST_ORIGIN=http://localhost:3000 docker compose up -d --no-build
```

This pulls the current `preview` image from GHCR, publishes port 3000 and creates a persistent Docker volume for the database, credentials, artwork and runtime state. Open `http://localhost:3000` and create the first administrator. For access from other devices, set `COAST_ORIGIN` to the exact LAN address and port users will open, such as `http://192.168.1.20:3000`.

To build from source instead of pulling the preview image:

```sh
git clone https://github.com/tdeverx/coast.git
cd coast
COAST_ORIGIN=http://localhost:3000 docker compose up --build -d
```

Set `DATABASE_URL` in the environment to use an existing PostgreSQL database. Coast otherwise runs a bundled PostgreSQL server in the container. Keep the `/data` volume mounted in either mode. See [deployment and recovery](docs/deployment.md) before changing storage, exposing the service beyond a trusted LAN, or upgrading.

## Connect services

Create the first administrator, then add shared service connections in **Settings → Integrations** and link personal accounts under **Connections**. Each service is optional. Do not put API keys in the image, Compose file committed to Git, or an issue report. Trakt import/export and sync need deliberate account testing before they should be relied on.

## Development

Requirements: Bun 1.4.2 and PostgreSQL. From the repository root:

```sh
bun install --frozen-lockfile
export DATABASE_URL='postgresql://coast:password@localhost:5432/coast'
export COAST_DATA_DIR="$PWD/.data"
bun run db:migrate
bun run dev
```

Run `bun run check`, `bun test` and `bun run build` before submitting changes. Database tests require their documented disposable PostgreSQL databases; never point them at a real installation.

## Data and security

The Docker volume stores Coast's database, encrypted provider credentials, artwork cache and runtime state. Back up the database and the entire `secrets` directory together. Loss of the credentials encryption key makes saved provider credentials unreadable. Restrict access to the volume and use HTTPS through a trusted reverse proxy when accessing Coast over an untrusted network. Coast has no telemetry.

## Project notes

- [Deployment and recovery](docs/deployment.md)
- [Product brief and project documentation](docs/README.md)
- [Current release readiness and known gaps](docs/readiness.md)
- [Contribution guide](CONTRIBUTING.md)
- [License](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md)

Coast is licensed under AGPL-3.0-only. Contributions are made under the same license. TMDB, Jellyfin, Trakt and Seerr are independent services; Coast is not endorsed or certified by TMDB.
