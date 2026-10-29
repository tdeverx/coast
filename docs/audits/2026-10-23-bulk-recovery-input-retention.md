# Bulk recovery, preview limits and retention

23 October 2026. The user selected **existing 100-job batches**, **30-day compaction with permanent replay receipts**, **preservation of existing durable history**, and the proposed preview limits. Those choices are implemented locally. This supersedes this file's earlier decision draft and closes `BLOCK-BULK` and `BLOCK-POLICY` for the selected scope. It does not certify the rest of the performance audit or deploy these changes.

## Durable bulk controls

Migration `0065_task_control_commands` adds one owner for command identity, administrator/specification binding, at most 100 ordered job IDs, outcomes, revision and totals. No dependency was added. Admission freezes the existing selector's first 100 IDs; its 101st result only supplies `hasMore`. Later arrivals require another deliberate command. Empty admissions are terminal receipts too.

The browser creates and retains a UUID **before** sending admission. Admission has no job effects. Resume locks the command row and commits each existing canonical job operation and its receipt in one transaction. A savepoint rolls back a failing target's native effects, including notifications. Expected conflicts become skipped outcomes; unexpected errors stop with the exact committed prefix. No provider/account lock spans the whole batch. Retry arbitration, webhook attempt credit, benchmark restrictions, purpose and service gates retain their canonical owners.

Each Resume consumes a revision. Duplicate/stale continuations return current receipts without advancing work. A lost admission/completion response reuses the same identity; a changed specification conflicts, and another administrator cannot read or inherit the record. Fresh administrator authority is checked on each target. Promotion reconstructs registered request urgency from the committed job purpose after commit or replay, preserving stronger urgency and retry/service gates.

The existing Jobs surface offers Resume, Pause and Abandon, exact updated/skipped/remaining counts and recent results. Navigation/unmount/account withdrawal aborts the browser request; checks between transactions stop further work when cancellation reaches the server. A currently executing transaction can still commit, and response loss can mean more work committed than the browser observed. The durable receipt is authoritative. Pause does not undo effects. Reload never silently resumes. A per-account session-storage descriptor preserves unknown acknowledgements; server records remain discoverable if storage is unavailable. Abandonment of an unknown identity creates a terminal tombstone, fencing delayed admission.

Unfinished listing is capped at 100 plus lookahead, recent terminal results at 20. Partial indexes follow those status/order queries; there is no per-row polling/history walk. Completing or abandoning the displayed batch exposes additional unfinished commands.

API contract: `POST queue/tasks/{cancel|retry|promote}` requires `{commandId,kind,instanceId}` and returns admission; `POST queue/task-commands/:id/resume` requires `{revision}`; `POST .../abandon` requires the original `{kind,instanceId,action}`. GET collection/identity returns owned receipts. Existing single-job controls remain canonical. These are queue-control receipts, **not exactly-once eventual provider delivery**.

## Retention

Unfinished/interrupted commands never expire automatically. Existing maintenance compacts at most 500 terminal commands older than 30 days with `SKIP LOCKED`, clears target IDs/outcome details and retains identity, actor/specification binding, totals, terminal status and revision. Compaction does not change the receipt revision. Replay remains safe after compaction and abandonment. Account deletion retains its existing cascading ownership semantics.

Existing tracking/history, playback evidence, benchmark and outbox retention is preserved. Existing transient cleanup remains unchanged. No 90-day task-history deletion was selected or added. Small replay receipts deliberately accumulate; a future deletion policy must introduce an explicit expiring-command protocol before deleting identities.

## Preview policy

| Input | Selected bound |
|---|---|
| Complete accepted/exported configuration | 1 MiB UTF-8, including pretty formatting and preview metadata; 32 nesting levels, 10,000 values, 1,000 entries per array |
| Event inspection | Existing eight-event list; project a bounded display graph before serialization, at most 4 KiB per summary, with explicit omission markers |
| Background | Static PNG/JPEG/WebP; at most 10 MiB compressed, 16,000,000 pixels and 8,192 pixels per side |
| Rejection | Explicit existing error feedback; preserve the last accepted configuration/image; no truncation, resize or conversion |
| Ownership | One active image candidate plus the latest pending file; validate headers before URL/decode, stage decode before swap, generation-fence late work, release superseded/failed/replaced/destroyed URLs |

JSON byte limits run before parsing; structural validation precedes complete serialization/adoption. Accepted data is preserved. Metadata changes near the exact configuration budget can make an export over-budget; the derived view reports a controlled error and Copy refuses it. Event summaries intentionally omit data; configuration does not.

Header admission supports PNG IHDR/chunk bounds and rejects APNG, JPEG SOF0/1/2 dimensions before scan data, and static WebP VP8/VP8L/VP8X canvas/frame bounds. Unsupported/malformed/animated metadata is rejected. Header admission is not full image validation: successful native decode and matching dimensions are required before swap, including orientation-swapped JPEG dimensions. Compressed size and pixels do not establish a universal decoder/GPU memory guarantee. An in-flight file read may finish after cancellation, but only one bounded read/candidate runs and obsolete output cannot publish.

## Evidence and limits

The [receipts](2026-10-23-bulk-recovery-input-retention/receipts/) and [probe/source pins](2026-10-23-bulk-recovery-input-retention/pins.json) record a new selected-policy epoch. Probe files are saved as `.txt` transcripts so tooling cannot load an audit harness as application configuration; restore their original filenames only in an isolated scratch directory. Historical audit fingerprints and measurements retain their original epochs; current-owner indexes explicitly link this report.

- **Actual restored data:** original PG15 archive mounted read-only, restored/upgraded to PG17 on a marker-owned disposable copy; shipping Linux Bun `6bb5dc195`. No application worker, real provider delivery or remote fetch ran. Controlled states used existing jobs/accounts, without inventing provider replies or inserting media/jobs/accounts.
- **Process interruption:** exact 100-of-121 membership; process killed after target 39's transaction committed; restart completed 61 remaining original targets. A later existing-row arrival stayed excluded. All 121 canonical job DTOs matched the serial baseline except the separately disclosed wall-clock update field/controlled late-arrival state. Completed replay had no effects. The actual notification cohort was empty; positive notification rollback uses an authored native database fixture.
- **Browser:** production JobsSettings/Recovery and playground components, native copied-data authentication and queue handlers, temporary navigation adapters; Chromium 156.0.8078.4, WebKit 27.2 and Firefox 157.0. Desktop 1440×900 and narrow 390×844 layouts pass without runtime errors/overflow. A lost real completion response for 100 jobs survived reload/replay without repeated effects. Actual queue configuration preserved 23 representative records; shipped PNG pixels and existing Sharp JPEG/WebP re-encodings passed. Size/header rejection preserved the accepted preview. Decoder failure, supersession, orientation and destroy cleanup passed with controlled scheduling/corruption cases labelled. Browser plugin unavailable: project-installed Playwright was used. This harness does not certify full deployed routing, physical devices or screen readers.
- **Storage sample:** final indexes, one native 100-job command: about 69 ms, 277,968 WAL bytes including native job effects, command writes and indexes. `pg_column_size` of its row changed from 1,832 to 160 bytes after controlled terminal aging/compaction; identity/count replay passed. Row size excludes index/page overhead. This is neither isolated-overhead measurement nor production throughput/p95. The earlier index sample is retained separately.
- **Regression gates:** native command, existing queue/maintenance/webhook/retention suites; preview boundary and client identity tests; full supplementary unit suite, Svelte check, build and inventories. See [final gates](2026-10-23-bulk-recovery-input-retention/receipts/gates.json) for exact results. Authored fixtures remain distinct from actual-data acceptance.

Initial validation caught JSONB double encoding, a missing internal UI inventory owner, the preview navigation guard and a same-account refresh that could abort the initial admission; these were corrected before final acceptance. Temporary browser harness attempts also exposed a wrong stylesheet/root glob, a duplicate Svelte entry and a replacement measurement taken before decode completed; failed browser receipts remain alongside corrected passing runs. None is relabelled as passing.

## Required future audit procedure

1. Read this contract, `docs/performance.md` and the current blocker register. Preserve the 100-job boundary and canonical operation owners. Do not restore the historical all-matches proposal or delete durable history by inference.
2. Pin source, migration, Bun revision/image, PostgreSQL major, actual browser versions and real-data provenance. Keep actor IDs, tokens, database URLs and backup material out of receipts. Verify exact database name/marker on an isolated copy before writes. Never start workers against copied real accounts. Repeated real provider delivery still needs the separately recorded authorization/environment.
3. Run command/client/preview regressions and affected canonical database suites. Exercise empty/100/101 admission, later arrivals, stale/concurrent replay, native-effect/receipt rollback, error prefix, revoked/foreign actors, unknown abandonment, pause and promotion reconstruction. Check 30-day terminal compaction, permanent identity replay, unfinished retention and unchanged existing history.
4. Use actual configurations/images to verify exact accepted values before/after rejection, bounded events, header/byte/pixel limits, decode failure, rapid replacement, unmount and URL ownership across engines. Label injected faults and authored edge cases. Physical-device checks stay distinct.
5. If an owner changes, rerun affected acceptance, append an evidence epoch and update current source/evidence indexes. `tests/performance-audit-register.test.ts` rejects drift; changing hashes alone is not acceptance. Preserve failed trials and finite benchmark context.
6. Close browser contexts/owned servers, verify zero active clients, drop only the exact marker-owned copy, gracefully stop/delete the owned container and record [cleanup](2026-10-23-bulk-recovery-input-retention/receipts/cleanup.json). Preserve originals/live/dev.

A second independent restore verified the initial JobSchedule menu action through the native same-account admission refresh, disabled duplicate controls while applying, Pause before dispatch with zero effects and Resume of the original 100 jobs. A compiled production-rune regression also checks same-account refresh versus account withdrawal. See [starter lifecycle](2026-10-23-bulk-recovery-input-retention/receipts/browser-start.json).

Six unrelated boundaries remain in the [roadmap](../roadmap.md#performance-follow-up--remaining-acceptance-23-october-2026): repeated provider-job authorization, physical devices, hosted companion/encoders, missing natural cohorts/formats and defined deployment capacity. No new deployment, device or universal performance claim is made here.
