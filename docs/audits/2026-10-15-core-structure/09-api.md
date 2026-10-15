# API boundary audit

Reviewed the current working tree, including pending feature implementations, on 2026-10-15. This is a read-only engineering review of the public token API, its OpenAPI description, webhook subscription/delivery code, and the browser API dispatcher/domain handlers. No application code, databases, live providers, credentials or services were changed or accessed.

## Scope and method

Substantively read every module under `src/lib/server/public-api` and `src/lib/server/api`, `src/lib/public-api.ts`, and the public catch-all route. Followed direct calls into tracking, sync export orchestration, reading writes/history, games/playthroughs, music logging, the shared JSON reader, feature gates/hooks, database pool/schema and queue retry handling. Read `docs/code-organization.md`, `docs/architecture.md`, `docs/performance.md`, `docs/public-api.md`, and the relevant public API, webhook, body-boundary and experimental-gate tests. The JSON report records the detailed inventory.

Existing focused non-database tests passed: `bun test tests/public-api-response.test.ts tests/request-body.test.ts tests/api-body.test.ts` using the bundled Bun in PATH: **6 passed, 21 assertions**. Two isolated Bun invocations exercised actual handler/delivery code with in-memory authentication/database mocks; neither contacted a database or network. These establish the narrow dispatch and attempt-limit behavior below, not full integration correctness.

## Coverage and healthy patterns

- Personal machine tokens use hashed secrets, explicit scopes, bounded expiry, account/onboarding checks and an atomic persistent per-token quota. Browser session cookies do not authorize public requests.
- Public mutation ownership and provenance are assigned by Coast. Strict request schemas and the shared streaming 64 KiB JSON limit guard writes. Idempotency replay, native changes and outbound intent share a transaction, with account/token locks and a canonical request hash. Replay responses are encrypted, including webhook creation secrets.
- Public reads use explicit DTOs and bounded hydration, reject cross-profile parameters, and filter disabled categories before counts. Concrete game/music/reading progress omits private notes. Reading history retains owner-only reads and its category gate.
- Webhooks use encrypted signing secrets, an immutable event envelope, HMAC over the exact timestamp/body, public HTTPS policy and revalidation at delivery. Removed subscriptions, expired/revoked creating tokens and disabled users suppress queued delivery. Duplicate delivery is explicitly an at-least-once contract.
- Browser handlers preserve the shared authentication/body/error boundary and call existing domain operations. Owner and viewer remain distinct for profile/Collection/Progress reads. Provider transport, canonical writes and availability logic generally remain in their existing owning modules.
- Compared public paths and mutation request fields against OpenAPI. Main endpoints/scopes match dispatch. A few schema refinements (nonempty update input, reading restart combinations, past timestamps) remain enforced by domain validation rather than expressed fully in OpenAPI; these are not reported as independent defects.

## Prioritized findings

### API-01 — P2 — Exhausted webhooks cannot be recovered with Jobs → Retry

**Confidence: confirmed narrow control-flow behavior; full queue lifecycle not run.** `src/lib/server/public-api/webhooks.server.ts:49` rejects every delivery with `action.attempts > 8` before constructing or sending the request. The queue increments attempts when claiming (`src/lib/server/queue/index.ts:238`), while administrator `retryAction` only restores pending state/purpose and next-attempt time (`src/lib/server/queue/index.ts:626`); it retains the exhausted attempt count. After eight failed network deliveries the next claim fails permanently at attempt nine. An administrator who repairs the receiver and presses Retry gets attempt ten, which fails at the same guard without contacting the repaired endpoint.

The message itself asks for endpoint review before retrying, and `docs/public-api.md` promises repeated failures can be reviewed in Jobs. The UI recovery operation therefore cannot recover this immutable event; recreating a subscription does not replay it. The existing webhook test checks rejection at attempt nine but does not follow it through manual Retry.

An isolated invocation of actual `deliverWebhook`, with an active subscription returned by an in-memory database mock, returned `PermanentActionError` at attempts nine **and ten** before reaching transport. The persistence of attempts across Retry is established by the SQL above.

**Minimal correction:** give a manually retried exhausted webhook a renewed bounded delivery budget through the existing retry/action state. Preserve immutable event IDs, lifetime audit evidence and claim fencing; do not simply remove the retry bound or reset an active lease counter indiscriminately.

**Verification:** in a disposable database fixture, fail a webhook eight times, claim its exhausted attempt, repair a mocked receiver, invoke the real `retryAction`, then claim/process again. Assert one HTTP delivery of the original event ID/body, a succeeded action and no additional domain event. Also retain the automatic failure cap.

### API-02 — P3 — Exported public HEAD handlers always reject readable resources

**Confidence: confirmed with an in-memory-auth handler reproduction.** The route explicitly exports `HEAD=publicApiHandler` (`src/routes/api/public/v1/[...path]/+server.ts:3`), but the handler sends every method other than GET into mutation dispatch (`src/lib/server/public-api/handler.server.ts:32`). Mutation dispatch has no HEAD operation and returns 405. With the same mocked valid token, actual `GET /api/public/v1/me` returned 200 and `HEAD /api/public/v1/me` returned 405. The unauthenticated OpenAPI GET exception also only matches GET (`handler.server.ts:29`).

Clients using HEAD to verify reachability/authorization or inspect the representation headers get a false method failure on existing read resources. Explicitly exporting HEAD also prevents the framework's ordinary GET-derived HEAD handling from serving this purpose.

**Minimal correction:** use the normal GET-derived HEAD route behavior, or deliberately dispatch HEAD through the same authenticated read path with an empty response body. Preserve scope checks, error status and private/no-store headers. Apply the same policy to the public OpenAPI document.

**Verification:** exercise the actual route's GET and HEAD with valid, missing and insufficient-scope credentials; assert matching statuses/relevant headers and no HEAD response body. Include `openapi.json`.

## Uncertainties and limits

- Did not run database suites, start a server, exercise browser UI, send signed deliveries to a receiver, inspect real tokens, or verify DNS/TLS behavior dynamically. Existing DB tests were read, not executed.
- Public Library independently selects persisted availability and ancestors. Its owner/connected/enabled constraints are explicit; source replacement and stale-availability cleanup were traced only to existing boundaries and remain a disposable-database acceptance case, not a newly established authorization defect.
- There is an unmeasured pool-contention lead: public mutations hold a pooled transaction/account lock (`mutations.server.ts:41–44`), then reading writes call global `getConfig()` (`core/reading/service.server.ts:38`), which obtains another connection from the shared ten-connection pool (`server/db/index.ts:27`). Tracking sequence resolution also uses global query helpers inside a transaction. A coordinated full-pool fixture is needed before claiming starvation or quantifying its impact; this is deliberately not a confirmed finding. Prefer using the already loaded config/transaction when that fixture establishes the failure, preserving authorization and lock order.
- Reading-history page validation uses the shared 1,000,000-page maximum (`reading/query.server.ts:127`, `server/queries/pagination.ts:8`) rather than the public API/OpenAPI documented 10,000 maximum. Hydration is still bounded and final pages clamp, so this is a small validation/documentation inconsistency, not an unbounded read finding.
- Cross-domain runtime semantics are owned by the domain/provider reviewers. No duplicate finding is raised for the separately reported Open Library comic preview gate or for list/export transaction behavior.

## Minimal ordered recommendations

1. Restore manual recovery of exhausted webhook events within the existing queue retry lifecycle and add the targeted disposable-database regression.
2. Align HEAD dispatch with the read routes and verify authentication/status/body parity.
3. When extending public contract tests, cover the reading-history page ceiling and express useful existing schema refinements in OpenAPI. Reproduce the nested pooled-read lead before treating it as a performance defect; avoid new dependencies, schedulers or API frameworks.


## Coordinator follow-up

The nested-pool lead above was subsequently reproduced in a fresh migrated synthetic PostgreSQL database by the coordinator. It is retained once as **CROSS-03** in [13-cross-boundary.md](13-cross-boundary.md), with its single-operation control, ordered ten-transaction blocking case and scoped cancellation result. The API report does not add a duplicate finding. Other nested global-query paths still need their own verification.
