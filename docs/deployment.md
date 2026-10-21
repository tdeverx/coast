# Running Coast

The default image contains Bun, Coast and PostgreSQL. `compose.yaml` builds it locally, exposes application port 3000 and persists everything under one `/data` volume. The Compose file sets `ORIGIN` to `http://localhost:3000` by default. For LAN or public access, edit that value to the exact address users open, including scheme and port. Leave `DATABASE_URL` blank for bundled PostgreSQL, or set it to an existing PostgreSQL database URL. Open the Coast address and create the first administrator. Later accounts register through the configured invite-only or open signup policy.

Coast supports ordinary HTTP on trusted local networks. Terminate public TLS at your reverse proxy and set Compose `ORIGIN` to the public HTTPS origin; HTTPS session cookies are Secure. Do not configure forwarded-header trust unless the proxy removes incoming client-supplied versions of those headers. Coast has no telemetry.

Page asset preload hints are carried in HTML rather than a large duplicate `Link` response header, keeping ordinary reverse-proxy header buffers sufficient. If an older image returns nginx's “upstream sent too big header” error, updating Coast resolves it; a host-specific `proxy_buffer_size 16k`, `proxy_buffers 8 16k`, and `proxy_busy_buffers_size 32k` also accommodates that image.

## Storage and PostgreSQL

The mount contains `postgres/`, `artwork/`, `secrets/` and `runtime/`. Credentials are encrypted using `secrets/credentials.key`; losing that key makes saved provider credentials unreadable. Back up the database and the entire secrets directory together. Stop the container before a filesystem-level database backup, or use PostgreSQL's supported logical backup tools while running. Keep the mount private to the installation administrator. Coast sets `secrets/`, `artwork/` and `runtime/` to mode `700`; secret files use mode `600`.

With no `DATABASE_URL`, startup initialises bundled PostgreSQL, creates a dedicated non-superuser Coast database owner, runs migrations and starts the application. PostgreSQL listens only on loopback inside the container. The supervisor stops both processes if either exits, and forwards shutdown signals. New private 0.x schemas do not promise upgrade compatibility; back up first and read release-specific instructions before changing images. A PostgreSQL major-version change requires the normal PostgreSQL upgrade procedure.

Set `DATABASE_URL=postgresql://user:password@database-host:5432/coast` in the Compose environment to use an existing PostgreSQL database. The database must already exist and its user must be allowed to run Coast migrations. Bundled PostgreSQL will not start. Keep `/data` mounted for credentials, artwork and runtime state even with an external database.

### Shutdown and readiness

TERM and INT stop new application work and close the application SQL pool with a two-second drain timeout. The supervisor gives the application or an in-progress migration five seconds to exit, then kills remaining owned descendants. Bundled PostgreSQL then receives fast shutdown (`SIGINT`), which disconnects clients and rolls back open transactions. After 18 seconds it escalates to immediate shutdown (`SIGQUIT`), waits two seconds, and kills remaining owned processes if needed. Repeated signals do not restart cleanup. Startup failures use the same cleanup path; the supervisor preserves the original exit status.

The supervisor's total wait budget is 27 seconds, plus bounded best-effort diagnostic writes. Keep the existing Compose `stop_grace_period: 40s`, and use an equivalent grace period with other managers. `COAST_SHUTDOWN_APP_SECONDS`, `COAST_SHUTDOWN_DATABASE_SECONDS` and `COAST_SHUTDOWN_IMMEDIATE_SECONDS` accept positive integer seconds only and may shorten their respective limits; they cannot extend them. Kernel processes stuck in uninterruptible I/O may remain unreaped, which is recorded when diagnostic storage is available.

Immediate shutdown and KILL are recovery fallbacks: they interrupt requests and require PostgreSQL crash recovery on the next start. This does not repair corrupt storage or guarantee durability after filesystem or hardware faults. Coast does not stop an external PostgreSQL server.

`GET /api/v1/health` returns 200 only after a successful database probe, or 503 when stopping or when that probe fails or exceeds one second. Health requests bypass the diagnostic-settings lookup. Concurrent polls share a probe, and a cancelled probe must settle before another starts. Responses use `Cache-Control: no-store`.

After startup, a temporary external database outage leaves the frontend running but unavailable; existing queue workers retain durable work and retry on their normal schedule. Readiness returns to 200 only after a successful probe following database recovery. Coast does not retry interrupted transactions automatically or report them as committed. A bundled PostgreSQL process exit still stops the container as a unit so the container manager can restart it.

Some host bind mounts, including Apple Container's VirtioFS mounts, allow file writes but reject ownership changes (`chown`). With an external `DATABASE_URL`, Coast can use such a mount if the container's `coast` user (UID `10001`) can write the `secrets/`, `artwork/` and `runtime/` directories and their private permissions can be verified. Set the host directory ownership/permissions accordingly; Coast checks access as the actual service user before starting. The bundled PostgreSQL database additionally requires its data directory to be owned by the container's `postgres` user. If the mount cannot provide that, startup stops with guidance. Use the default POSIX-compatible named volume (`coast-data`) or another managed POSIX volume for bundled PostgreSQL, or configure an external `DATABASE_URL` when using a VirtioFS bind mount.

## Registration and onboarding

Administrators choose invite-only or open registration and require Jellyfin, Trakt, either service, or no connection under Settings → Policies. The defaults are invite-only and Jellyfin required. Accounts register with a username, display name and matching passwords (8–128 characters, including an uppercase letter, lowercase letter and special character), then connect their services, optionally upload a profile picture or use a connected service image, and wait for initial imports. The requirement is captured when each account registers. Trakt onboarding imports history, progress, ratings, watchlist and lists without enabling outbound synchronization. Initial imports use the existing serialized queue and provider cooldowns.

Sign-in uses Coast credentials. Jellyfin is connected during onboarding, not used as a sign-in method. Existing accounts without a Coast password need an administrator to set one in user settings. The startup administrator recovery credential and recovery route have been removed.

## Connected services and pending work

An administrator must approve service instances. Only HTTP(S) and approved ports are permitted. Private LAN addresses require explicit instance approval; loopback, link-local, cloud metadata, multicast and transition-network targets are rejected even with LAN approval. Coast resolves and checks every address, then pins the connection to one checked address while preserving HTTPS hostname verification. Redirects are rejected: configure the final service URL, including any reverse-proxy path prefix. Fetches have time and response-size limits. The [Bun networking documentation](https://bun.sh/docs/runtime/networking/fetch#connecting-to-a-specific-address) describes the native fetch mechanism used for pinned connections.

External actions remain durable in PostgreSQL without a default expiry. Transient failures retry with increasing delays, up to six hours between attempts. A permanent failure requires retry or cancellation and blocks later actions for that user's connection to preserve their order. Cancellation is available while pending or failed, not once an external action is running. Successful retries and cancellation clear the corresponding failure notice. Execution is at least once after a worker crash; adapter operations must use idempotent provider semantics or reconcile prior remote results.

## Bun runtime pin

The image and CI use **Bun 1.4.4-canary.1+6bb5dc195**, explicitly selected on 21 October for the upstream SQL cache/type fixes. Stable 1.4.4 was not yet published. Both Docker dependency stages inherit one `bun-runtime` image, pinned to the multi-platform digest `sha256:8902bf25498a9ac3c75ce0d5c8f87771d113ea5a1bd75084bdaa82bf70ab7ab1`. CI extracts Bun from that same image and asserts `bun --revision`; it does not install a moving canary tag. Update the Dockerfile, workflow digest/assertion and package metadata together after acceptance.

For local development use a verified 1.4.4 canary or a later accepted stable release; check `bun --revision` rather than trusting `bun --version` alone. The official GitHub canary currently supplies a newer revision (`963452075`); its earlier actual-data results are recorded separately from the selected image. A rolling canary download may change, so verify its checksum and revision before relying on those receipts. Container builds provide the reproducible selected Linux runtime. See [runtime adoption and verification](audits/2026-10-21-live-freeze/runtime-adoption.md) and [dependency update inventory](audits/2026-10-21-live-freeze/dependency-updates.md). This source change does not update an already running installation.

## Local development and checks

Install C++17 and libarchive development headers (`g++ libarchive-dev` on Debian, libarchive with Homebrew on macOS), then install the locked Bun dependencies, set `DATABASE_URL` for a development database, set `COAST_DATA_DIR` to a writable local directory such as `.data`, run `bun run db:migrate`, then `bun run dev`. The dev server listens on all network interfaces; use the Network URL printed by Vite (usually `http://<your-LAN-IP>:5173`) from another device on the same LAN. Sign in separately on each device. `bun run dev` builds the native comic extractor; `bun run build` produces its shipping binary without a database connection. See [server reading delivery](reading.md#server-comic-delivery) for private disk ownership, budgets and non-container operation. The development data directory and secrets are excluded from the OCI build context.

Run `bun run code:inventory`, `bun run ui:inventory:check`, `bun run check`, `bun run test` and `bun run build`. For database suites, set `TEST_DATABASE_URL` to an account allowed to create databases and run `bun run test:db`. The runner creates and removes a disposable database for each suite; it does not test against the database named in that URL. Never point mutation suites at a deployed database. Approved actual-data checks use a private disposable restore, with its scope and cleanup recorded. See [performance methods](performance.md) for focused regression and browser checks.


## Recovery verification

Back up the database and `secrets/` together. A logical database restore without the original credential key cannot recover provider tokens. Use a private backup directory (`umask 077`), and preserve secret-file permissions. Keep backups outside the application's transient/cache retention directories.

`TEST_DATABASE_URL=… bun run test:recovery` exercises a logical PostgreSQL dump/restore using only newly created disposable databases and fixture credentials. It requires matching `pg_dump`/`pg_restore` tools and permission to create databases. It verifies fresh-process decryption with the restored key, rejection with a different key, and retention of queued work. It does not restore an installation or alter its configured database. See [the audit follow-up](audits/2026-10-02-follow-up.md) for tested scope and the optional local container workflow.

Transient cleanup runs through existing provider maintenance: expired login sessions, unapproved previews, old unused invites, ended synced rooms and diagnostics. History, playback evidence, redeemed invites, approved cleanup previews and completed outbox evidence remain durable. Artwork cache has a separate bounded eviction policy.

## Runtime diagnostics and image builds

The image sets Bun’s production `IDLE_TIMEOUT=60` to allow requests that take longer than the adapter’s earlier ten-second default. A handler’s recorded 200 response does not prove the proxy or browser received it. Check client and proxy failures alongside application timings before changing timeouts.

The supervisor retains bounded child-exit evidence in `/data/runtime/child-exits.jsonl` and its rotated file, plus shutdown stages in `runtime/shutdown-events.jsonl` and `.1` (128 KiB each). Application and migration stderr each have two private 256 KiB segments in `runtime/application-stderr.log` and `runtime/migration-stderr.log`. Inspect these after an unexpected shutdown; restarting can replace ordinary container console logs. Raw stderr may contain sensitive details and is excluded from web diagnostic exports. See [diagnostic logging](diagnostic-logging.md) for safe exports and retention. Current memory counters alone cannot establish the cause of an earlier process exit.

The preview workflow verifies inventory, types, tests, isolated database suites and the production build. Images then build on native AMD64 and ARM64 runners with separate caches and health smoke checks; the combined manifest is published after both succeed. A green verification job alone does not mean image publishing has finished. Publishing an image does not update a running installation.

### Shared playback links behind a proxy

Reusable playback links need the same correct public `ORIGIN` as the browser app. Use HTTPS for Android/Quest clients. The resolver supports browser document requests, native media requests and HEAD probes; do not cache share pages, playlists, redirects or segments. Redact `/share/*` bearer paths and `/api/share/*` query capabilities from proxy access logs. Revocation blocks subsequent requests, not media already downloaded by a player.

Coast uses the adapter's client address for approximate cookie-free viewer leases. Behind a reverse proxy, configure the adapter's `ADDRESS_HEADER` and `XFF_DEPTH` for the actual trusted proxy chain only if the proxy removes incoming forged forwarding headers and Coast cannot be reached around that proxy. Without trustworthy forwarding, many viewers with the same player user agent may appear as one proxy address and merge into one estimate. Do not trust arbitrary `X-Forwarded-For` values in application code to inflate or separate viewer counts. Browser grants remain separate. See [playback sharing](synced-experiences.md#reusable-playback-links) for budget semantics and native-player acceptance limits.
