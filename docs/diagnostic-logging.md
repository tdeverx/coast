# Diagnostic logging

Administrators can select Off, Error, Warn, Info, Debug or Trace in **Settings → Activity & diagnostics** and download recent events as JSON Lines. Info is the default; Debug and Trace are opt-in. Configuration is persisted in the existing system settings. Saving changes the running server immediately. Other browser tabs learn the level on their next API response or within 30 seconds. No restart is needed.

Events cover HTTP outcomes, provider calls, durable job execution, browser errors and playback. Debug adds request/job starts and playback lifecycle events; Trace adds provider starts and playback position, buffering and elapsed timing. Provider duration measures response headers; playback measurements describe the browser video element, rather than decoded frame performance. Direct provider playback cannot expose server-side stream activity; browser playback events still apply.

Replacing or closing a player cancels relay requests. Caller cancellations are recorded at Info by the provider transport; cancellation before stream headers returns 499 instead of an application 500. Provider timeouts and failures remain errors. An `aborted` event by itself does not establish an upstream outage. Repeated 400s or generic browser errors need reproduction: the redacted export intentionally excludes the URL and exception text, and a browser correlation ID can cover several requests.

A random browser correlation ID travels in `X-Coast-Correlation-Id`. Server async context carries it into provider calls and queued actions. The ID is persisted with jobs and playback sessions so retries and relay requests remain connected. Session and action IDs supply additional links. Correlation IDs are opaque diagnostic labels, never authentication or authorization evidence. Browser reports are untrusted and rate limited.

The event schema admits only named events, closed classifications, finite numeric measurements and random session/action IDs. It excludes identities, titles, provider addresses, URL paths/queries, cookies, credentials, tokens, request/response bodies, exception messages and stacks. Browser errors are classified without reading their text. Detailed job failure codes and scan phases come from a closed vocabulary. Downloads contain this same safe schema.

Server-stream scan failures identify the phase: module loading, account validation, connection loading, administrator permissions, session reading or observation recording. If saving the failure also fails, diagnostics retain the original exception classification and phase.

Logs stay in `COAST_DATA_DIR/diagnostics`, with a private directory and owner-only files. One application process writes a serialized queue of at most 128 pending events. Four segments rotate at 1 MiB each, keeping at most 4 MiB. Seven-day retention is enforced on reads and periodically on writes; entire expired segments are discarded. Diagnostics are best effort: queue saturation, inaccessible storage or full disks drop events without failing application actions. A download can therefore be empty when storage is unavailable. Logs are never sent to a remote collector.

Logging-setting changes are recorded transactionally in `diagnostic_setting_audit`, with the administrator, previous/new level and timestamp. This audit and the existing metadata audit stay in PostgreSQL, independent of diagnostic levels and retention; recent audit activity remains visible when diagnostics are Off. Existing authentication/session security behavior is unchanged.

Apply the generated database migrations through the normal Coast migration workflow before running the updated app. No production dependencies were added.

Focused validation: `bun test tests/diagnostic-logging.test.ts`, the isolated `tests/platform-db.test.ts` suite, and `bun scripts/browser-diagnostics-check.ts`. The browser harness targets only localhost:5175 and expects a disposable installation; it creates synthetic admin/member accounts and verifies controls, runtime changes, persistence, download redaction and admin authorization. Use the existing fixture harness for actual provider/media playback checks.

## Container crash evidence

The container retains application stderr in `COAST_DATA_DIR/runtime/application-stderr.log` and one rotated `.1` segment, each limited to 256 KiB. These owner-only files survive restarts and include a timestamp for each application start. Stderr still reaches the container console; unavailable diagnostic storage does not change application exit status. Shutdown signals are forwarded to the application and stderr is drained before its exit is reported.

Unlike the structured diagnostic export, these files contain raw runtime errors and may include sensitive details. They are local operator diagnostics and are never included in the web diagnostic download. Inspect them privately alongside `runtime/child-exits.jsonl` after an unexpected shutdown.

## Developer mode

Settings → Policies → Development has an installation-wide Developer mode switch, off by default. It pauses automatic scheduling, queued background jobs (including live reads, recommendations, taste refreshes, reminders and webhook deliveries), retries and retention cleanup. Already running jobs finish their current run. Explicit tracking/playback changes, first imports requested by connecting an account, benchmarks, Run now and Retry remain available. Manual job failures wait for another Retry while the mode is enabled. Pending automatic work is retained and resumes when the switch is disabled. Run now authorizes an already queued task without duplicating it.
