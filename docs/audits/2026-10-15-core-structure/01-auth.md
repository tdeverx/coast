# AUTH — authentication, onboarding, invitations, settings and access policy

## Scope and method

Reviewed the current working tree, including its pending edits, with static control-flow and direct-caller tracing. No application code, tests, configuration, provider data or credentials were changed. Only these two audit reports were written. No services, live providers, database suites, check/build commands or sub-agents were used. Prior dated audits were searched for relevant evidence without substituting old code for the current tree.

The scope covers local accounts and sessions, first-run bootstrap, registration/invites, connection/import onboarding, settings navigation and drafts, administrative accounts/policies, and the hook/layout access boundaries. Provider/network/sharing/social implementations were followed only far enough to establish the effects cited below.

## Coverage and healthy patterns

- Passwords use Argon2id; sessions and invites store hashes of random secrets. Session rotation locks rows and allows a brief concurrent-request grace period. Cookie options support both HTTPS and the documented trusted LAN HTTP case.
- First-admin creation and last-admin changes serialize their authoritative database checks. Account role/disable/password changes revoke sessions and API tokens; new requests rehydrate the current role and disabled state.
- Registration uses a single shared schema. Invitation use is locked and single-use; provisioning binds the issuing account generation and checks selected libraries. Onboarding completion pins account generations and actual personal import outcomes.
- Ordinary settings updates merge keys rather than replacing the whole object, validate chosen sync-account ownership, and keep administrative policy writes in the existing application/configuration workflow. Configuration patches serialize and diagnostic-level changes have an audit record.
- Settings labels/admin membership come from settings/sections.ts and are reused by loader and UI. The large Settings page is not itself a finding: its drafts, cancellation and feature-specific service calls generally follow the documented boundaries.
- Site access uses an explicit read-path allowlist and social audience checks; experimental media gates remain independent. Framework data-request URL normalization was checked, avoiding a false claim about public profile __data.json paths.

Substantive reads (whole small modules; Settings functional markup/logic, not decorative CSS):

- `docs/code-organization.md`
- `docs/architecture.md`
- `docs/performance.md`
- `src/lib/auth/registration.ts`
- `src/lib/server/auth/cookies.ts`
- `src/lib/server/auth/index.ts`
- `src/lib/server/auth/onboarding.ts`
- `src/lib/server/config.ts`
- `src/lib/application/configuration.server.ts`
- `src/lib/settings/sections.ts`
- `src/hooks.server.ts`
- `src/routes/+layout.server.ts`
- `src/routes/+layout.svelte`
- `src/routes/setup/+page.server.ts`
- `src/routes/setup/+page.svelte`
- `src/routes/login/+page.server.ts`
- `src/routes/login/+page.svelte`
- `src/routes/register/+page.server.ts`
- `src/routes/register/+page.svelte`
- `src/routes/logout/+server.ts`
- `src/routes/onboarding/+page.server.ts`
- `src/routes/onboarding/+page.svelte`
- `src/routes/settings/[[section]]/+page.server.ts`
- `src/routes/settings/[[section]]/+page.svelte`
- `src/lib/ui/components/AccountFields.svelte`
- `src/lib/social/public.server.ts`
- `src/lib/social/model.ts`
- `src/lib/social/privacy.server.ts`
- `src/lib/providers/jellyfin/provisioning.server.ts`
- `src/lib/providers/jellyfin/connection.server.ts`
- `src/lib/providers/trakt/connection.server.ts`
- `src/lib/providers/connections.server.ts`
- `src/lib/providers/maintenance.server.ts`
- `src/lib/providers/task-timing.ts`
- `src/lib/providers/schedule.ts`
- `src/lib/server/api/settings.server.ts`
- `src/lib/server/api/admin.server.ts`
- `src/lib/server/api/context.server.ts`
- `src/lib/server/security/csrf.ts`
- `src/lib/server/experimental.ts`
- `src/lib/experimental.ts`
- `src/lib/sharing/policy.ts`
- `src/lib/ui/client.ts`
- `src/lib/social/status.svelte.ts`
- `tests/registration.test.ts`
- `tests/site-access.test.ts`
- `tests/settings-db.test.ts`
- `tests/http-journeys.test.ts`

Targeted sections/searches rather than full-file review:

- `src/lib/server/api/index.server.ts (authentication, public reads, invitations and dispatch)`
- `src/lib/server/queue/index.ts (enqueue deduplication and failure handling)`
- `src/lib/playback/service.server.ts (bitrate and subtitle preferences)`
- `src/lib/sharing/service.server.ts (sharing permission checks)`
- `src/lib/collection/demand.server.ts (shareDemand opt-out)`
- `src/lib/server/db/schema.ts (UserSettings)`
- `src/lib/providers/contracts.ts (default sync preferences)`
- `src/lib/providers/tasks.ts`
- `src/lib/providers/job-policy.ts`
- `src/lib/providers/actions.server.ts (Trakt import handlers)`
- `drizzle/0023_swift_the_captain.sql (social_visible)`
- `tests/platform-db.test.ts (authentication and configuration cases)`
- `tests/synced-onboarding-db.test.ts (registration/onboarding cases)`
- `tests/review-followups-db.test.ts (onboarding follow-up case)`
- `tests/invites-experiments-db.test.ts (permission/provisioning cases)`
- `tests/sharing-db.test.ts (administrator bandwidth controls)`
- `tests/experimental-features.test.ts`
- `tests/synced-playback.test.ts`
- `node_modules/@sveltejs/kit/src/runtime/server/page/index.js (action-before-load ordering)`
- `node_modules/@sveltejs/kit/src/runtime/server/respond.js (data-request URL normalization)`
- `docs/audits (prior auth-related evidence search)`

## Prioritized findings

### AUTH-01 · P2 · Restoring personal preferences erases administrator bitrate limits and privacy opt-outs

Confidence: **strong-static**. Category: security. Root cause: `profile-only-settings-reset-erases-policy-and-privacy`.

**Evidence**

- `src/lib/server/auth/index.ts:357` — Any authenticated user can reset settings; the SQL preserves only profile and removes every other settings key.
- `src/lib/server/auth/index.ts:260` — allowPlaybackSharing and personal/shared bitrate controls are administrator-only account patch fields.
- `src/lib/server/api/settings.server.ts:19` — POST settings/reset dispatches directly to the ordinary-user reset operation.
- `src/lib/sharing/policy.ts:9` — An absent personal ceiling defaults to the full server limit; absent shared ceiling defaults to 20 Mbps.
- `src/lib/playback/service.server.ts:198` — New playback reads current account settings and applies playbackLimits.personal.
- `src/routes/settings/[[section]]/+page.svelte:461` — Reset is described as appearance, notifications, playback and conflict resolution; privacy exposure changes and removal of administrator controls are not explained.
- `src/lib/collection/demand.server.ts:45` — Removing shareDemand:false opts the account back into administrator demand visibility.
- `drizzle/0023_swift_the_captain.sql:92` — Removing social privacy settings falls back to friends audience, including when previously private.

**Trigger:** An ordinary user with an administrator-set 4 Mbps personal ceiling calls POST /api/v1/settings/reset. A user who previously disabled demand sharing or chose private social visibility can trigger the same loss by clicking Restore defaults.

**Impact:** The personal playback limit rises to the installation ceiling (for example 4 to 120 Mbps) without administrator authority. The reset also removes privacy settings, can expose previously private sections to accepted friends, and re-enables missing-demand disclosure to administrators. Removing a sharing grant revokes it rather than granting sharing, so this is not an escalation to sharing permission.

**Minimal correction:** Reset an explicit allowlist of documented personal preference keys using JSONB key removal. Always retain administrator-managed sharing/bitrate fields. Preserve privacy/social/shareDemand unless the product explicitly adds those fields to the reset description and confirmation.

**Useful verification:** In a disposable DB set personalBitrateMbps=4, sharedBitrateMbps=8, allowPlaybackSharing=true, shareDemand=false and social.audience=private; call reset as that ordinary user and verify policy/privacy keys survive while resettable appearance/subtitle/conflict preferences inherit defaults. Verify subsequent playback remains capped at 4 Mbps.

### AUTH-02 · P2 · Trakt authentication failure during onboarding has no usable reconnect path

Confidence: **strong-static**. Category: correctness. Root cause: `onboarding-trakt-reconnect-requires-inaccessible-disconnect`.

**Evidence**

- `src/lib/server/auth/onboarding.ts:174` — An initial-import provider.authentication failure forces reconnect=true and traktLinked=false.
- `src/routes/onboarding/+page.svelte:39` — The recovery UI offers Connect Trakt through the onboarding trakt action.
- `src/lib/server/auth/onboarding.ts:106` — The onboarding action delegates to the normal startTraktDevice flow.
- `src/lib/providers/trakt/connection.server.ts:82` — startTraktDevice rejects any existing connected connection and requires disconnect first.
- `src/lib/server/queue/index.ts:372` — Provider failure changes the outbox action state/payload; it does not disconnect the connection.
- `src/hooks.server.ts:68` — Pending onboarding users are redirected away from Settings and receive 403 for ordinary APIs, including the disconnect route.

**Trigger:** Trakt initial tracking/list import returns 401 after the account has linked, leaving its provider_connections status connected. The user follows the displayed Connect Trakt recovery action.

**Impact:** The user receives Disconnect the current Trakt account before linking another, but cannot access the required disconnect action. Initial imports remain required, so an ordinary new account cannot recover through the supplied UI without administrator intervention.

**Minimal correction:** Add an owner-scoped onboarding reconnect path through the existing disconnect/source-change workflow, or adapt the existing device-link operation to replace an authentication-failed pending-onboarding connection safely. Retain account-generation invalidation, pinned import evidence and source cleanup; do not broadly exempt provider APIs from onboarding gates.

**Useful verification:** Extend the disposable onboarding fixture with a still-connected Trakt connection and failed initial import carrying provider.authentication. Exercise the actual recovery action with a local fake Trakt service, complete device authorization, verify stale jobs cannot qualify, then verify both replacement initial imports finish and onboarding completes.

### AUTH-03 · P2 · The public setup action hashes passwords after setup without a rate limit

Confidence: **strong-static**. Category: security. Root cause: `setup-password-hash-before-closed-bootstrap-check`.

**Evidence**

- `src/hooks.server.ts:56` — /setup is public regardless of whether installation setup is already complete.
- `src/routes/setup/+page.server.ts:8` — Only the page loader rejects an already configured installation.
- `src/routes/setup/+page.server.ts:12` — The POST action has no setup-state or client-rate guard and calls createFirstAdmin after valid registration parsing.
- `src/lib/server/auth/index.ts:107` — Argon2id with memoryCost 19456 and timeCost 2 runs before the transaction checks that users already exist at line 114.
- `src/lib/server/auth/index.ts:124` — The ordinary login path, unlike setup, applies its rate guard before password work.

**Trigger:** After initial configuration, an anonymous direct HTTP client repeatedly posts valid registration-shaped forms to /setup with the expected Origin header. SvelteKit executes actions before page loaders; enhanced JSON actions also directly execute the action.

**Impact:** Requests cannot create a second first administrator because the transactional lock/check is sound, but each request still invokes an intentionally expensive password hash. The route bypasses login/registration throttling and provides an avoidable unauthenticated CPU/memory pressure path on a small self-hosted server. No load test or resource-exhaustion claim was made.

**Minimal correction:** Reject already-configured setup POSTs before parsing/hashing in the existing action, and apply the existing client-rate limiter before password work while setup is legitimately open. Keep the authoritative locked existence check inside createFirstAdmin for concurrency.

**Useful verification:** Use an isolated test with a hash spy: when setupRequired is false, repeated valid setup POSTs must produce zero hash calls. When setup is open, requests above the existing client quota must be rejected before hashing; concurrent allowed first-admin attempts must still create exactly one administrator.

### AUTH-04 · P3 · Deleting a disabled administrator incorrectly trips the last-active-admin guard

Confidence: **strong-static**. Category: correctness. Root cause: `admin-delete-count-does-not-exclude-target`.

**Evidence**

- `src/lib/server/auth/index.ts:240` — deleteUser selects target id/role without considering its disabled status.
- `src/lib/server/auth/index.ts:242` — Every admin-role target is subject to count(active admins)<=1, even when the target is already disabled and would not lower that count.
- `src/lib/server/auth/index.ts:291` — updateUser correctly applies its last-active-admin guard only when the target was active and is losing active-admin status.

**Trigger:** Administrator A is the sole active administrator and B is another administrator account already disabled. A tries to delete B from Accounts.

**Impact:** Deletion is refused with Keep at least one administrator account even though A remains active. Operators must first demote B or create another active administrator to perform ordinary cleanup.

**Minimal correction:** Under the existing administrator lock, count active administrators excluding the target and reject only if deleting the target would leave none; alternatively apply the current count check only to active admin targets. Preserve the self-delete restriction.

**Useful verification:** Disposable account tests should allow deleting disabled admin B while active admin A remains and retain rejection when deletion would actually remove the last active administrator.

### AUTH-05 · P3 · The first-run HTTP journey no longer supplies the required setup fields

Confidence: **confirmed**. Category: verification. Root cause: `http-bootstrap-fixture-stale-registration-contract`.

**Evidence**

- `tests/http-journeys.test.ts:21` — The first-run setup POST contains only username and password.
- `src/routes/setup/+page.server.ts:16` — Setup now validates the complete registrationSchema before calling createFirstAdmin.
- `src/lib/auth/registration.ts:6` — displayName and passwordConfirmation are required registration fields.
- `tests/http-journeys.test.ts:33` — After setup validation fails, the fixture attempts login with the same not-yet-created account.

**Trigger:** Run COAST_HTTP_TEST_URL HTTP journeys against a fresh disposable Coast installation without an already seeded coast-browser-test user.

**Impact:** The advertised first-run journey cannot establish its initial cookie, and subsequent tracking/page tests fail downstream. An existing account can hide the stale setup contract, so the fallback weakens first-run coverage.

**Minimal correction:** Add displayName and matching passwordConfirmation to the setup payload, and keep login credentials as a separate payload. Make fresh bootstrap and existing-installation login expectations explicit so validation failure cannot masquerade as successful first-run coverage.

**Useful verification:** The current exact fixture object fails a harmless v.safeParse(registrationSchema, fixture) check for both missing fields. After repair, run the HTTP journey against a fresh disposable server/database and verify setup itself supplies the session cookie before later tests.

## Checks and limits

- `PATH="$PWD/.tools/bun-darwin-aarch64:$PATH" bun test tests/registration.test.ts tests/site-access.test.ts tests/experimental-features.test.ts tests/synced-playback.test.ts` — PASS: Bun 1.4.2; 13 tests, 180 assertions, 0 failures. No database/provider calls.
- `Harmless bun -e: v.safeParse(registrationSchema, {username:"coast-browser-test",password:"Local-test-password-2026!"}); playbackLimits(120,{personalBitrateMbps:4}); playbackLimits(120,{})` — Fixture invalid; missing displayName and passwordConfirmation. Pure personal limits: 4,000,000 before, 120,000,000 after policy-key removal. This verifies schema/fallback behavior, not the unexecuted DB reset.
- `Read installed SvelteKit server page/index.js and respond.js` — Confirmed action execution precedes server page data loading; data-request URL suffix is normalized before hooks, so no public-profile __data.json routing finding was raised.

Unverified or deliberately excluded:

- No database, HTTP server, browser, real credentials or live providers were used. Database and HTTP suites were inspected, not executed.
- Session cookie delivery/rotation under interrupted responses, reverse-proxy address/origin settings, real Trakt device reconnect and Jellyfin provisioning remain runtime acceptance work.
- Public profile audience implementation and provider/scheduler/sharing infrastructure were followed only at directly relevant boundaries; their full audits belong to other sections.
- Settings page logic/markup was reviewed substantively through account administration and policies; decorative CSS was not audited.
- An ordinary failed Trakt maintenance job without initialImport could prevent ensureTraktImports from obtaining evidence, but fresh connections default all sync opt-ins false, so a normal fresh-onboarding trigger was not established and this is not a finding.

## Minimal ordered recommendations

1. Restrict preference reset to its documented personal fields and retain administrator controls/privacy opt-outs. This is the clearest permission-boundary correction.
2. Complete the existing onboarding recovery path for Trakt reauthentication, preserving source-change cleanup and account generations.
3. Close the configured setup action before password work and reuse the existing limiter during bootstrap.
4. Correct the disabled-admin deletion guard and stale HTTP bootstrap fixture with focused regression cases.
5. Run the affected disposable database/HTTP flows after corrections. Keep the approved interface and current domain/service boundaries; these findings do not justify a new auth framework, broad Settings redesign or production dependency.
