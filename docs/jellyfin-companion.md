# Jellyfin companion updates

The optional [Coast Plugin](https://github.com/tdeverx/coast-plugin) 0.3 targets Jellyfin 12.1 and .NET 10. Install/update it through Jellyfin’s plugin catalogue and restart Jellyfin to register event subscriptions. Existing crop support remains independent. A server without this plugin continues using native Jellyfin polling.

## Connection and task controls

Coast discovers `GET /Coast/Changes` using an existing connected account that is an administrator in both Coast and Jellyfin. **Settings → Jobs → Plugin updates** selects the server administrator account and an interval (one minute by default), using the existing schedule menu. The source is shared with Server streams. There is no callback endpoint, new public URL, shared secret, or token in a URL. Jellyfin enforces its elevated authorization policy on the endpoint. Turning off the plugin’s Live updates option, Coast’s Plugin updates schedule, or developer mode preserves the appropriate native fallback/manual behavior.

`jellyfin.updates` has one current-generation queue identity per server. It uses the live priority lane and can run between a long import’s requests without holding the import traversal lock. Each page acknowledges its cursor only in the transaction that stores its follow-up jobs. The provider HTTP request queue still serializes service calls by priority; this does not bypass cooldowns or permissions.

## Protocol and recovery

Protocol 1 returns `serverId`, `epoch`, numeric `cursor`, `reset`, `more`, up to 200 ordered `changes`, and a sanitized complete current-session snapshot. Change fields are `Sequence`, `Kind`, `ItemId`, `UserId` and `ItemType`. The DTO excludes tokens, IPs, filesystem paths and full media sources. The four kinds are `item-updated`, `item-removed`, `user-data` and `user-updated`.

The plugin retains up to 4,096 coalesced hints in memory. Restart, configuration change, future/invalid cursor or evicted data explicitly requires a reset. Coalescing replaces an earlier hint with a later sequence for the same kind/user/item, retaining removal/re-addition ordering. Coast validates server identity, epoch, increasing sequence and page boundaries before acknowledgement. Failed acknowledgement does not partially advance the cursor or enqueue half a page.

A reset invalidates cached screen-library census proofs and queues full shared-library and user reconciliation according to their task switches. Polling continues while these baselines or failed delta jobs need reconciliation. A replacement successful baseline can satisfy a cancelled/failed earlier run. A missing/disabled plugin (404) is a successful capability fallback and rechecks at least every ten minutes. Authentication, permission and transport failures retain their usual retry/attention meaning and disable the healthy feed state. Account reconnects reject old-generation cursors and observations.

## What changes replace

- A caught-up feed supplies the server-stream snapshot and all linked users’ live states, replacing separate automatic `jellyfin.streams` and `jellyfin.live` polls. Account `liveRead`, service switches and social sharing privacy remain respected. Unknown live work identities are not fabricated.
- Shared item changes queue one metadata delta and each linked account’s targeted item lookup. Individual account credentials remain authoritative for availability, user state and music. A server deletion revokes only that server’s existing availability. Permission edits revoke the affected account’s cached availability and require authenticated reconciliation.
- User-data changes queue only that user's changed items. `jellyfin.delta` reuses the screen and music import paths for watched state, favourites, resume positions and retained reconciliation intent. It commits 25-item batches and resumes from a durable task checkpoint when yielding to higher-priority work. Multiple editions reconcile at canonical work level. Incremental reads never advance a full scan checkpoint, infer removals outside their requested IDs, or claim a completed census.
- When caught up, full library/user reconciliation uses the configured full interval (24 hours by default). First imports still run immediately; manual Run now still requests native reconciliation. Stale/unavailable feeds restore the normal minute schedules. A later positive delta is protected from removal by an older resumed census watermark.

Artist-only metadata and unknown item types are left to periodic native scans. Coast remains responsible for outbound tracking/scrobbles, metadata hydration, external providers, jobs, and durable history; the plugin sends hints rather than executing Coast’s business logic.

## Verification

- `bun test tests/jellyfin-companion.test.ts tests/task-timing.test.ts` verifies protocol validation, source selection, private-field stripping, ordering and fallback schedules.
- `TEST_DATABASE_URL=<disposable-database-capable-url> bun scripts/test-database.ts jellyfin-companion-db.test.ts jellyfin-reconciliation-db.test.ts maintenance-runner-db.test.ts task-timing-db.test.ts` verifies durable acknowledgement, targeted access, personal isolation, cursor preservation, account/worker fencing and existing queue/reconciliation behavior in disposable databases.
- In the plugin repo: `dotnet build Coast.slnx --configuration Release` and `dotnet run --project Tests/Coast.Journal.Tests.csproj --configuration Release` verify the exact SDK and bounded journal behavior.

These tests verify contracts and persistence. Activating live updates requires installing the companion and restarting Jellyfin; local tests do not establish live deployment coverage.
