# PostgreSQL 17 and automatic container upgrades

Coast runs PostgreSQL 17 for new and existing bundled installations. Replace the stopped old container with the new image using the **same `/data` volume**, as for an ordinary update. No separate migration command is needed. Do not run two containers against one database volume. External databases selected by `DATABASE_URL` remain administrator-managed; Coast does not upgrade or start them.

The image includes PostgreSQL 15 binaries only to read and upgrade the existing format. Startup selects 17 explicitly rather than whichever major the distribution happens to install. CI tests 17 and a populated 15-to-17 container upgrade.

## What happens during the first update

Before starting the application, the supervisor locks the bundled installation and detects `postgres/PG_VERSION`. A cleanly stopped 15 cluster is upgraded as follows:

1. Validate the original database password, stopped-cluster state, storage ownership and free space. Unsupported majors, active/stale PID files and externally linked database files stop startup with an error. An unclean cluster must complete recovery using the previous image and shut down cleanly first.
2. Create `postgres-upgrade/postgres-15-and-secrets.tar`, compare its contents against the stopped source, record its SHA-256 checksum and flush the backup to storage. This includes all databases, roles and the original provider credential key.
3. Initialise a separate 17 cluster and copy the existing PostgreSQL configuration. Run PostgreSQL 17's `pg_upgrade --check`, then `pg_upgrade --copy`. Copy mode keeps the old data independent after 17 accepts writes. Incompatible settings/extensions fail the check.
4. Start the staged 17 database on a private Unix socket and verify the existing Coast database and role. Stop it cleanly, flush it, then rename the original cluster to `postgres-15/` and install 17 at `postgres/`.
5. Remove the in-progress marker only after the switch is durable. Continue ordinary schema migration and app startup. Later restarts use 17 directly.

No original cluster or upgrade backup is automatically deleted. In addition to the source's existing space, allow roughly twice the combined database/secrets size plus 64 MiB for the backup and staged cluster. The preflight checks free space; later write failures also stop startup. Large installations take longer to become ready, so allow time for the first upgrade before treating an unhealthy container as failed.

Keep a separate off-volume database/secrets backup as well. A backup on the same volume cannot protect against loss of that volume. After validating the updated installation and retaining an independent backup, an administrator may archive/remove the retained 15 cluster and upgrade backup to recover space.

## Failure or interrupted upgrade

`postgres-upgrade/in-progress` means the upgrade did not finish. Startup refuses to select or initialise a database while that marker exists, including interruption between the two renames. Inspect the container output and private `check.log`, `upgrade.log` and `validation.log` inside `postgres-upgrade/`. Fix the reported capacity/configuration problem before retrying.

To recover, stop the container first and keep the entire current volume untouched. Work on a copy or restore into a **new** managed volume:

- If the backup and checksum exist, run `sha256sum -c postgres-15-and-secrets.tar.sha256` from `postgres-upgrade/`, then extract that archive into the new empty volume with ownership and permissions preserved. It restores `postgres/` and `secrets/`. Copy the installation's remaining artwork/runtime files as appropriate. Start the previous image on this restored volume to verify recovery, or the new image to retry the automatic upgrade.
- If interruption occurred before a complete backup, the original 15 cluster remains at `postgres/`, or at `postgres-15/` if the first rename occurred. Copy that cluster into a new volume as `postgres/`, alongside the original `secrets/`. Use the previous image to recover an unclean cluster and shut it down cleanly before retrying the new image.
- After a successful upgrade, `postgres-15/` represents the database at upgrade time. It does **not** contain subsequent writes to 17. Rolling back to that copy alone would lose those later writes. Keep the 17 database and use a current logical export or restore plan if rollback is needed after users resume writing.

Never remove `PG_VERSION`, delete a PID file without checking the old server, clear the in-progress marker to bypass recovery, or point an older binary at a newer cluster. The upgrade does not silently reset an existing installation.
