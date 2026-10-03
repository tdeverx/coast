# Running Coast

The default image contains Bun, Coast and PostgreSQL. `compose.yaml` builds it locally, exposes application port 3000 and persists everything under one `/data` volume. The Compose file sets `ORIGIN` to `http://localhost:3000` by default. For LAN or public access, edit that value to the exact address users open, including scheme and port. Leave `DATABASE_URL` blank for bundled PostgreSQL, or set it to an existing PostgreSQL database URL. Open the Coast address and create the first administrator. Later accounts are created by an administrator in Settings.

Coast supports ordinary HTTP on trusted local networks. Terminate public TLS at your reverse proxy and set Compose `ORIGIN` to the public HTTPS origin; HTTPS session cookies are Secure. Do not configure forwarded-header trust unless the proxy removes incoming client-supplied versions of those headers. Coast has no telemetry.

Page asset preload hints are carried in HTML rather than a large duplicate `Link` response header, keeping ordinary reverse-proxy header buffers sufficient. If an older image returns nginx's “upstream sent too big header” error, updating Coast resolves it; a host-specific `proxy_buffer_size 16k`, `proxy_buffers 8 16k`, and `proxy_busy_buffers_size 32k` also accommodates that image.

## Storage and PostgreSQL

The mount contains `postgres/`, `artwork/`, `secrets/` and `runtime/`. Credentials are encrypted using `secrets/credentials.key`; losing that key makes saved provider credentials unreadable. Back up the database and the entire secrets directory together. Stop the container before a filesystem-level database backup, or use PostgreSQL's supported logical backup tools while running. Keep the mount private to the installation administrator. Coast sets `secrets/`, `artwork/` and `runtime/` to mode `700`; secret files and recovery credentials use mode `600`.

With no `DATABASE_URL`, startup initialises bundled PostgreSQL, creates a dedicated non-superuser Coast database owner, runs migrations and starts the application. PostgreSQL listens only on loopback inside the container. The supervisor stops both processes if either exits, and forwards shutdown signals. New private 0.x schemas do not promise upgrade compatibility; back up first and read release-specific instructions before changing images. A PostgreSQL major-version change requires the normal PostgreSQL upgrade procedure.

Set `DATABASE_URL=postgresql://user:password@database-host:5432/coast` in the Compose environment to use an existing PostgreSQL database. The database must already exist and its user must be allowed to run Coast migrations. Bundled PostgreSQL will not start. Keep `/data` mounted for credentials, artwork and recovery state even with an external database.

Some host bind mounts, including Apple Container's VirtioFS mounts, allow file writes but reject ownership changes (`chown`). With an external `DATABASE_URL`, Coast can use such a mount if the container's `coast` user (UID `10001`) can write the `secrets/`, `artwork/` and `runtime/` directories and their private permissions can be verified. Set the host directory ownership/permissions accordingly; Coast checks access as the actual service user before starting. The bundled PostgreSQL database additionally requires its data directory to be owned by the container's `postgres` user. If the mount cannot provide that, startup stops with guidance. Use the default POSIX-compatible named volume (`coast-data`) or another managed POSIX volume for bundled PostgreSQL, or configure an external `DATABASE_URL` when using a VirtioFS bind mount.

## Administrator recovery

Create a file named `/data/recovery-credential` in the persistent mount containing a randomly generated credential of 32–256 characters, readable by Coast, and restart the container. Startup consumes and deletes the file immediately. The credential is accepted once at `/recovery`, expires after four hours, and creates only a disposable in-memory recovery session. That session can reset one existing administrator password within 15 minutes and is invalid after a restart. Resetting the password revokes the administrator's regular sessions. Introducing another recovery file requires another restart. No persistent recovery account is created.

## Connected services and pending work

An administrator must approve service instances. Only HTTP(S) and approved ports are permitted. Private LAN addresses require explicit instance approval; loopback, link-local, cloud metadata, multicast and transition-network targets are rejected even with LAN approval. Coast resolves and checks every address, then pins the connection to one checked address while preserving HTTPS hostname verification. Redirects are rejected: configure the final service URL, including any reverse-proxy path prefix. Fetches have time and response-size limits. The [Bun networking documentation](https://bun.sh/docs/runtime/networking/fetch#connecting-to-a-specific-address) describes the native fetch mechanism used for pinned connections.

External actions remain durable in PostgreSQL without a default expiry. Transient failures retry with increasing delays, up to six hours between attempts. A permanent failure requires retry or cancellation and blocks later actions for that user's connection to preserve their order. Cancellation is available while pending or failed, not once an external action is running. Successful retries and cancellation clear the corresponding failure notice. Execution is at least once after a worker crash; adapter operations must use idempotent provider semantics or reconcile prior remote results.

## Local development and checks

Install the locked Bun dependencies, set `DATABASE_URL` for a development database, set `COAST_DATA_DIR` to a writable local directory such as `.data`, run `bun run db:migrate`, then `bun run dev`. The dev server listens on all network interfaces; use the Network URL printed by Vite (usually `http://<your-LAN-IP>:5173`) from another device on the same LAN. Sign in separately on each device. `bun run build` does not require a database connection. The development data directory and secrets are excluded from the OCI build context.

`bun test tests/platform-security.test.ts` checks the local security boundaries. The transactional platform suite requires a separate database whose name begins `coast_platform_test`: set `TEST_DATABASE_URL`, then run `bun test tests/platform-db.test.ts`. That suite resets its isolated database. Never point it at real data.


## Recovery verification

Back up the database and `secrets/` together. A logical database restore without the original credential key cannot recover provider tokens. Use a private backup directory (`umask 077`), and preserve secret-file permissions. Keep backups outside the application's transient/cache retention directories.

`TEST_DATABASE_URL=… bun run test:recovery` exercises a logical PostgreSQL dump/restore using only newly created disposable databases and fixture credentials. It requires matching `pg_dump`/`pg_restore` tools and permission to create databases. It verifies fresh-process decryption with the restored key, rejection with a different key, and retention of queued work. It does not restore an installation or alter its configured database. See [the audit follow-up](audits/2026-10-02-follow-up.md) for tested scope and the optional local container workflow.

Transient cleanup runs through existing provider maintenance: expired login sessions, unapproved previews, old unused invites, ended synced rooms and diagnostics. History, playback evidence, redeemed invites, approved cleanup previews and completed outbox evidence remain durable. Artwork cache has a separate bounded eviction policy.
