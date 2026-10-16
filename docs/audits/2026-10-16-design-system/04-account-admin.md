# Account, onboarding and administration design coverage audit

Date: 16 October 2026. Scope: account/admin surfaces in `/Users/admin/Documents/ChatGPT/coast-new`, including the uncommitted row-consistency work observed during this audit. Read-only source audit: no app edits, builds, servers, database operations, provider requests or publication. Findings are implementation/reference evidence, not claims of visual browser validation.

## Overall assessment

This area is already substantially mapped: all operational buttons use `Button`; account/admin modals use `Dialog`; jobs use the shared menu/context-gesture system; section titles use `Heading`; connections, integrations, jobs, schedules and conflicts are owned reusable components. Native inputs, selects, checkboxes, tables and disclosure elements receive shared `app.css` styling and are valid system elements even without a Svelte wrapper. Their use alone is not fragmentation.

The largest gaps are **reference coverage of compositions and states**, not a need to replace the approved interface. The genuine missing reusable composites are (a) a described settings row and (b) determinate/indeterminate operational progress. `Field` and `FormActions` cover only simpler subsets. Benchmark and administrator metrics have usable existing candidates (`DetailCard`, `MetricGrid`, `FactList`), but adopting their visual treatment must be an explicitly reviewable variant rather than an automatic redesign of the dense operational displays.

Priorities: P1 = important behavior/semantic risk; P2 = common consistency gap; P3 = reference/documentation gap or optional consolidation. Confidence reflects source evidence; visual severity is unmeasured. Stable IDs are local to this report.

## Findings

### ADM-01 — Described settings rows and draft-save state are not represented by a usable shared composition

- **P2 / high confidence. Classification:** genuine missing reusable composite for the described toggle row; variant/composition missing from reference for dirty-save actions.
- **Evidence:** `src/routes/settings/[[section]]/+page.svelte:183` owns `saveControls` (busy/dirty/error/success/save/discard); `:227` renders feature choices; `:275` onward renders appearance rows; `:818`, `:826`, `:833` repeat the same policy toggle rows; route-local `.setting` structure/spacing is at `:1166`. The lowest-level candidates are `src/lib/ui/components/Field.svelte:3` (one wrapping label and optional hint) and `FormActions.svelte:4` (row + optional Cancel). Neither can faithfully represent title + description + remembered/unavailable reason + trailing checkbox + busy state. Native checkbox styling is intentionally shared at `src/app.css:170`.
- **Affected states:** normal on/off, administrator ceiling unavailable but personal choice remembered, prerequisite unavailable, dirty/busy/saved/save failed/discard, narrow viewport, disabled fieldset.
- **Smallest safe route:** first add an exact specimen of today's row and save composition to the UI reference. Extract the existing `.setting` markup/CSS as a small snippet/composite only after approving that specimen. Keep the settings route as draft/save owner; compose existing Field/Button/RowFeedback/FormActions where they actually fit. Do not replace native checkboxes with an invented switch or a full settings-form framework.
- **Performance/lifecycle:** no new observer, request or settings cache inside a display row; incoming refresh must not reset unsaved state (`+page.svelte:130`).
- **Accessibility:** retain explicit input names/labels, associate prerequisite/help copy with the input (`aria-describedby`), preserve legends/fieldset disabling; do not make disabled installation capabilities look like a failed user choice.
- **Reference / acceptance:** appearance row + personal unavailable row + administrator ceiling row; dirty/saving/error/saved examples; equal approved padding desktop/narrow. Save only intended section fields, preserve unsaved edits through unrelated refresh, exactly one writer, keyboard interaction and explanatory text work.

### ADM-02 — Existing feedback element can cover scattered notice/error semantics

- **P2 / high confidence. Classification:** reuse gap, with static notice composition missing from reference.
- **Evidence:** `src/lib/ui/components/RowFeedback.svelte:19` already supplies alert/error and status/message semantics while accepting a `p`/`div` and `.notice.error` class. Connections/integrations/jobs/conflicts use it. Other account/admin paths inline equivalent notices: login `src/routes/login/+page.svelte:12`, setup `setup/+page.svelte:29`, settings save errors `settings/[[section]]/+page.svelte:184`, generic errors `:220`, token reveal `:411`, reset/delete/edit errors `:1017`, `:1042`, `:1085`; avatar errors `src/lib/ui/components/AvatarPicker.svelte:81`; benchmark errors `src/lib/benchmarks/BenchmarkSettings.svelte:54`. Onboarding import errors and device errors at `src/routes/onboarding/+page.svelte:43` and `:46` lack the alert role used by its form-error notice.
- **Smallest safe route:** use RowFeedback for dynamic errors/status that match its contract and retain current classes/copy. Leave static policy warnings as native `.notice` compositions; do not misclassify every warning as a runtime alert. No new Alert dependency/component is necessary to close this gap.
- **Performance/lifecycle:** renderer only; keep retry writer and mutation ownership in the existing feature. Avoid duplicated live-region announcements when status and error are adjacent.
- **Accessibility / acceptance:** injected import/device failure must be announced once, remain beside its affected form, and not erase successful connection/provider sections. Reference loading, informational notice, warning, action error, retry and successful status independently.

### ADM-03 — Import/sync progress lacks an indeterminate-safe shared operational element

- **P2 / high confidence. Classification:** genuine missing usable primitive/composite, rather than a blind ProgressBar reuse gap.
- **Evidence:** onboarding renders native progress only for truthy known totals at `src/routes/onboarding/+page.svelte:43`; ConnectionCard uses a known or indeterminate native progress at `src/lib/ui/components/ConnectionCard.svelte:265`–`:295` and owns browser-specific styling/animation at `:375`–`:421`. Shared `src/lib/ui/components/ProgressBar.svelte:2` accepts only a determinate fraction, defaults its label to playback, and converts nonfinite input to zero. It cannot faithfully represent unknown total / queued / waiting / failed operational states. The UI recipe at `src/routes/ui-preview/Demo.svelte:294` shows only a 42% determinate media bar.
- **Smallest safe route:** retain native `<progress>` semantics; represent the current operational treatment in reference first. Add an explicit unknown-total/status composition or a narrowly scoped determinate/indeterminate variant to the shared owner, using existing progress-track/fill tokens and reduced-motion support. Do not normalize an unknown total to 0%, and do not use the interactive media timeline for jobs.
- **Accessibility:** known progress exposes max/current; unknown progress omits current; textual processed count, stage, waiting/failure remain readable independent of color/animation. Limit announcements to useful stage/count changes.
- **Performance/lifecycle:** bar displays supplied values and never polls. Current task/connection/onboarding owns refresh; no per-item animation scheduler.
- **Reference / acceptance:** queued/unknown-total, running/known-total, yielded/waiting, complete, failed/reconnect, zero total, reduced motion and long labels. Native appearance checked in Chromium/WebKit/Firefox before replacing current CSS.

### ADM-04 — Authentication/account flows have a shared visual vocabulary but no complete reference recipes

- **P2 / high confidence. Classification:** variant/composition missing from reference; intentional route specialization is not itself fragmentation.
- **Evidence:** auth shell is already shared CSS (`src/app.css:583`–`:615`) and Brand/Button/Field. Login has Field at `src/routes/login/+page.svelte:13`; register/setup reuse `AccountFields` (`register/+page.svelte:16`, `setup/+page.svelte:30`). AccountFields owns password-match validity at `src/lib/ui/components/AccountFields.svelte:3`–`:9`. In contrast onboarding provisioning uses its dedicated credentials at `onboarding/+page.svelte:29`; change password is at `settings/[[section]]/+page.svelte:429`; admin account create `:766` and reset/edit `:1068` intentionally have different contracts. Reference currently shows only an isolated AccountFields form (`src/routes/ui-preview/Demo.svelte:212`), a single Field (`:215`) and FormActions (`:216`).
- **Smallest safe route:** add exact current shell/login/register/setup/onboarding/password-change/admin-reset compositions, including error and submitting states. Reuse Field for equivalent label+control markup; use AccountFields only where its full username/displayName/password/confirmation contract is correct. Do not force administrator account creation, password reset or existing Jellyfin sign-in to adopt registration fields or server behavior. A new AuthPage wrapper is optional after reference capture, not required for correctness.
- **Accessibility/performance:** preserve native form POST/progressive enhancement, autocomplete, password-match validation and form focus; no remote calls to preview auth and no real invite/token values in specimens. Setup `setup/+page.svelte:23` clears busy after update without `finally`, unlike login/register; keep rejected-enhancement recovery in acceptance rather than claiming a browser-reproduced defect.
- **Reference / acceptance:** invite-required/open registration, invalid confirmation, rejected credentials, optional email, server unavailable, provisioning uncertain, current/new password and admin optional reset, desktop/narrow and no-JS form fallback.

### ADM-05 — Connection/integration/job reference fixtures do not cover real operational states and can show synthetic errors as normal

- **P2 / high confidence. Classification:** reference/fixture drift, not missing production components.
- **Evidence:** current examples at `src/routes/ui-preview/Demo.svelte:243`–`:270` render a single connected Jellyfin account, one integration and one pending job; `:331`–`:334` similarly show one automation and queue state. Production ConnectionCard immediately calls its scan API (`src/lib/ui/components/ConnectionCard.svelte:63`–`:87`), but `src/routes/ui-preview/demo/fixtures.ts:33`–`:65` has no `/providers/:id/scan` response; default is 409 at `:65`. That causes the default connected-card preview to show “Could not refresh scan progress” instead of an intentional normal scan state. Every non-GET fixture except stream refresh returns409 (`:38`), so dialogs can be inspected but successful form/busy/notification transitions cannot be selected as deliberate scenarios.
- **Smallest safe route:** add finite named fixture scenarios to existing isolated transport/recipes; do not replace global fetch. Cover Jellyfin/Trakt/Steam/Seerr behavior and configured/missing/reconnect differences; task success/failure/busy/paused/manual/upcoming/empty are first-class selectable scenarios. Keep realistic unknown-total and account-generation cases. No provider traffic or live account settings in the reference.
- **Performance/lifecycle:** existing preview supplies injected client context (`src/routes/ui-preview/+page.svelte:27`, `demo/+page.svelte:6`); preserve it. Merely scrolling through all component examples must not keep growing poll/observer owners. Parent should cross-check lazy/unmount preview lifecycle independently.
- **Accessibility / acceptance:** all menu/context/keyboard controls, Schedule and Details dialogs, error focus and return, pending/lost permissions, selected-service empty states. Zero unintended live API calls; a normal specimen does not fall into a default-error branch; explicit failure scenario remains inspectable.

### ADM-06 — Administrator summary/benchmark metrics bypass available metric/card elements and benchmark has no specimen

- **P2 / high confidence for mapping; visual replacement unapproved. Classification:** reuse gap plus composition missing from reference.
- **Evidence:** administration health uses bespoke `.health-grid > .panel` at `src/routes/settings/[[section]]/+page.svelte:570`–`:590` with own metric CSS at `:1191`–`:1210`. Benchmark data uses custom `.result/.metrics/.metric` at `src/lib/benchmarks/BenchmarkSettings.svelte:59`–`:80`, styles `:86`–`:91`. Existing `DetailCard.svelte:18` renders facts/metrics and custom children/footer; `MetricGrid.svelte:3` accepts numeric or text values; `FactList` can retain exact environment/probe names. BenchmarkSettings lives outside the flat component inventory and has no case in `src/routes/ui-preview/Demo.svelte`/`catalog.ts`.
- **Smallest safe route:** first add benchmark/health compositions using current data and current layout, then show a separately **Non-approved** existing-DetailCard/MetricGrid/FactList composition for review if it improves consistency. Do not silently turn the queue or dense benchmark result list into oversized cards; the user previously rejected that direction. Reuse metric typography/tokens without altering probe values, comparison compatibility, missing-data treatment or warning text.
- **Performance/lifecycle:** benchmark already uses createResource, cancellation/generation checks and visibility-aware one-in-flight active polling (`BenchmarkSettings.svelte:13`–`:44`). Preserve those; reference must use injected/static fixture data, never queue a real benchmark. Do not import all chart renderers for these facts.
- **Accessibility / acceptance:** queued/running/completed/failed/cancelled, no matching comparison, partial errors, environment disclosure, pagination and narrow long probe names; missing metrics must not become zeros. Existing results/order and one-run admission unchanged.

### ADM-07 — Native administration tables, disclosure and diagnostics are legitimate specialized patterns but absent from the reference

- **P3 / high confidence. Classification:** intentional specialized composition with reference gap, not evidence that a generic Table/Accordion library is needed.
- **Evidence:** shared `.table/.overflow` CSS at `src/app.css:541`–`:558`; demand/requests/users native tables at `src/routes/settings/[[section]]/+page.svelte:609`, `:618`, `:694`; diagnostics `<details>/<summary>/<pre>` at `:968`–`:998`; benchmark native context disclosure `src/lib/benchmarks/BenchmarkSettings.svelte:72`. The UI inventory enumerates only flat Svelte components (`src/routes/ui-preview/catalog.ts:1`–`:3`), so these shared HTML/CSS compositions are not shown as reusable patterns.
- **Smallest safe route:** add a reference category/recipe for named semantic compositions using actual shared classes: dense responsive table, action cell, read-only diagnostic disclosure, JSON/code details, shared empty/error content. Extract an owning Svelte wrapper only if there is a concrete repeated behavior to centralize; native disclosure and table semantics are already usable elements.
- **Accessibility:** demonstrate caption/accessible label, scoped column headers, keyboard-reachable overflow region when needed, visible focus, long values, empty and fetch failure; retain native summary keyboard behavior. Current tables have headers but no caption/scope attributes; this is a targeted acceptance improvement, not a reason to recode them as ARIA grids.
- **Performance/lifecycle:** retain server bounds and pagination; no whole-history browser data table or virtualization dependency. Diagnostic JSON should stay plain text, no syntax-renderer dependency merely for prettification.
- **Acceptance:** valid semantics and readable horizontal overflow at narrow viewport; no new sorting/filtering behavior introduced by a reference-only pass.

### ADM-08 — One-time token/invite output is repeated and not represented as a safe composition

- **P2 / high confidence. Classification:** composition missing from reference; existing primitives suffice initially.
- **Evidence:** API one-time secret and Hide at `src/routes/settings/[[section]]/+page.svelte:411`; single-use invite code/link at `:757`; revocation lists at `:412` and `:758`. Closest existing pieces: Field, Button, RowFeedback, native readonly input and existing clipboard action pattern. No dedicated secret output component/recipe appears in the manifest or Demo.
- **Smallest safe route:** present exact current show-once/read-only/select/hide/revoke composition using existing elements. Consider a small reusable output composite only if copy/hide/status behavior is explicitly unified; a native readonly field is already valid. No invented auto-copy or secret persistence.
- **Performance/security/accessibility:** never save tokens/codes in preview localStorage, URLs, logs, screenshots or fixture responses outside synthetic constants; selecting/copying is keyboard reachable, status announces copy/hide, navigation clears newly revealed secrets, stale request cannot reveal a previous subject's output.
- **Reference / acceptance:** created once, hidden, clipboard failure/manual selection, expired, revoked, already used, long URL narrow screen. API names/scopes/expiry and invitation provisioning stay separate domain contracts.

### ADM-09 — Webhook management is API-only; the reference should distinguish it from browser token management

- **P3 / high confidence. Classification:** scope/documentation clarification; there is no current webhook UI to remap.
- **Evidence:** `src/lib/settings/sections.ts:33` describes scoped tokens for applications and webhook subscriptions; actual API-access section `src/routes/settings/[[section]]/+page.svelte:400`–`:414` renders token creation/list/revocation and OpenAPI link only; loader `+page.server.ts:46` loads tokens, no subscriptions. `docs/public-api.md:64` documents paginated GET/POST/DELETE webhooks through the machine API; `src/lib/server/public-api/handler.server.ts:35` actually serves that API. A search of settings/UI contains no webhook-management composition.
- **Smallest safe route:** make browser copy/reference explicit that subscriptions are managed through the public API; do not add an unrequested webhook editor just for component completeness. If browser webhook management is later desired, it needs a new domain composite built from Field/Button/Dialog/RowFeedback/Pagination, its own async lifecycle, and an explicitly Non-approved specimen. API support is not broken by absence of browser UI.
- **Acceptance:** reference inventory distinguishes actual visible feature from API-only capability; copy accurately explains where to manage subscriptions; no fictional specimen suggesting a shipped browser feature.

### ADM-10 — Reference/adoption work must not spread legacy unmanaged read lifetimes

- **P2 / high confidence for source lifetime gaps, runtime cost unmeasured. Classification:** existing-feature lifecycle inconsistency / performance acceptance constraint; not a design primitive request.
- **Evidence:** `src/lib/ui/components/ConnectionCard.svelte:63`–`:87` scan polling clears its interval but has no AbortController/current-identity publication check for an in-flight scan. Changing provider identity resets sync prefs (`:105`) but scan remains separate. Onboarding `src/routes/onboarding/+page.svelte:9`–`:14` interval clears but in-flight poll can still publish deviceError/invalidate after leaving, and polling does not check document.hidden. `src/lib/ui/components/AvatarPicker.svelte:69`–`:78` raw provider-avatar fetch lacks abort and its unconditional final reading=false can affect superseding work; prepareAvatar has generation checks (`:19`, `:61`) but its catch publishes error unconditionally (`:62`). By contrast BenchmarkSettings has explicit resource/generation/dispose ownership (`src/lib/benchmarks/BenchmarkSettings.svelte:13`–`:44`), and invitation-library fetch already aborts in settings route (`+page.svelte:37`).
- **Smallest safe route:** reuse current createResource/cancellation and primitive identity conventions for **reads** when these feature components are touched; keep mutations and device authorization action ownership separate (aborting browser delivery does not undo a committed remote authorization). Validate whether hidden-tab authorization should pause before changing that policy; essential ongoing onboarding has a different contract than decorative previews. No new global poll scheduler is justified by this static evidence.
- **Accessibility/performance:** stale account/scan/avatar results should not replace current visible state or announce old errors; no resource left behind when closing/unmounting preview. This audit did not measure memory growth or reproduce a leak, so none is claimed.
- **Acceptance:** open/use/replace/close/reopen with held/failed responses; old connection cannot populate new card, old avatar failure cannot clear newer reading flag, unmount cancels optional read delivery, known empty responses remembered where applicable, one in flight; live jobs/authorization still finish according to their domain contract.

## Deliberately preserved specialized UI / checked nonissues

- Auth pages intentionally use the shared auth shell, native h1 and Brand wordmark rather than a catalogue MediaHero/MediaPage. Replacing them with row or media cards would be wrong.
- Password, API token, invite secret, server URL, numeric policy fields, checkboxes, native selects and file inputs are real semantic controls styled globally. Absence of a separate Input/Select/Checkbox Svelte file does not mean unsupported design.
- Native tables/details are appropriate for dense administrator information and do not need a new dependency. Keep their semantics; add references.
- `ConnectionCard`, `IntegrationSettings`, `ProviderAutomation`, `JobsSettings`, `JobSchedule`, `QueueList`, `ConflictList`, `AvatarPicker` and `CollectionProjectionSettings` already are real components. Do not replace approved task rows with a new dashboard/card system.
- Jobs context menus already use Button menu/item and contextGesture (`JobSchedule.svelte:163`, QueueList.svelte:40); they should be represented/tested, not reinvented. Only meaningful navigable row titles need destinations; settings and task headings should not fabricate self-links.
- Dialogs already own modal/popover/focus return and bounded viewport dimensions (`Dialog.svelte:24`–`:82`); retain that owner rather than bespoke overlays.
- Materials editor (`src/lib/ui/materials/MaterialTweaker.svelte`) is **already explicitly Non-approved**, local-browser-only, in the Materials reference section. It correctly uses Heading/Button/SegmentedControl; native color/range/file controls and swatch/text pairs are legitimate specialized editor compositions. Do not apply its draft effects to production or alter material layers in this pass.
- Root errors already use EmptyState/Button with level1 (`src/routes/+error.svelte:9`); this is mapped, not a missing component.
- Active streams presentation is covered by the social/playback auditor; administrator settings' diagnostics/history are covered here. Cross-reference rather than double-count stream cards.

## Coverage matrix

Every row below was read as source, including imports, visible markup, state branches and local styles; supporting files were inspected for ownership and reference behavior. Not rendered in browser.

| File / section | Existing mapping | States reviewed / result |
| --- | --- | --- |
| `src/routes/login/+page.svelte` | Brand, Field, Button, shared auth CSS | credentials, action failure, busy, registration link; ADM02/04 |
| `src/routes/register/+page.svelte` | Brand, AccountFields, Button, auth CSS | invite/open, invite hash removal, errors, busy; ADM04/08 |
| `src/routes/setup/+page.svelte` | Brand, AccountFields, Button, native email | initial admin create, error, submitting; ADM04 |
| `src/routes/onboarding/+page.svelte` | Brand, Button, AvatarPicker, native forms/progress | connections, provisioning uncertainty, Trakt device, avatar, imports queued/running/wait/retry/error, sign out; ADM02/03/04/10 |
| `src/routes/+error.svelte` | EmptyState level1 + Button | 404 and generic error; mapped |
| `settings/[[section]]/+page.svelte` shell | Heading, settings nav CSS, native links | personal/admin nav, active link, dirty navigation, save/discard; ADM01/07 |
| Settings Features / Feature availability | native described toggles + panel/fieldset | gate reason remembered, admin ceiling, prerequisites, save; ADM01 |
| Settings Collection | native fieldset/check labels | each allowed medium/rule, save; ADM01/04 reference coverage |
| Settings Appearance | described toggle, native region select | glass, width, titles, missing-art, demand and notification opts; ADM01 |
| Settings Playback | described toggle/native fields, Button, share list | subtitle defaults, threshold, invitations state/revoke; ADM01/08 |
| Settings Privacy & social | native Field-like labels/select/checks, Heading | profile/section/category audience, notification flags; ADM01/04 |
| Settings Account | panel, native password form, Dialog/Button | account summary, password change, reset defaults, about; ADM02/04 |
| Settings API access | native Field-like inputs, Button, panel | token grants/expiry, one-time value/hide/revoke, API link; ADM08/09 |
| Settings Connections | ConnectionCard, native conflict preference, EmptyState | enabled list, missing configured service, manual conflict winner; ADM04/05 |
| Settings Sync conflicts | ConflictList | conflicting values, source date/action, accept/ignore, confirmation, empty/error; ADM05/07 |
| Settings Overview | Icon, Heading, QueueList, Button, native tables | DB health, provider status, missing demand lazy/error/empty/pages, pending requests, failed actions, broadcast; ADM02/06/07 |
| Settings Integrations | IntegrationSettings | enabled/disabled, add/edit/delete, source-impact confirmation; ADM05 |
| Settings Jobs & schedules | JobsSettings/JobSchedule, RowFilter, Button menu, Dialog | grouped running/waiting/needs attention/upcoming/manual, local tasks, source filter, empty, schedule/details; ADM05 |
| Settings Benchmarking | BenchmarkSettings, Heading/Button/EmptyState/Pagination | queue, active, bounded history, exact measurements, comparison/context, errors; ADM06 |
| Settings Accounts | native tables, form/panel, Dialog/Button | invite and provisioning libraries, create/edit/delete, sharing budget, disabled/self-role protections; ADM04/07/08 |
| Settings Policies | fieldsets/native controls, Heading/Button | development/access/experiments/sessions/playback/metadata/network/notifications; ADM01/04 |
| Settings Activity & diagnostics | native details/table-like text, EmptyState, Button | logging saved/dirty, audit, diagnostics JSON, empty; ADM02/07 |
| `settings/[[section]]/+page.server.ts` | route data owner | section-specific payloads, bound diagnostics/demand, API tokens versus API-only webhooks; ADM09 |
| `src/lib/settings/sections.ts` | settings catalog | all labels/navigation/field sets and descriptions; ADM09 |
| `ui/components/AccountFields.svelte` | Field | native validation/matching and autocomplete; ADM04 |
| `ui/components/AvatarPicker.svelte` | Avatar/Field/Button/RowFilter | upload/decode/remove/provider choice/errors; ADM04/10 |
| `ui/components/ConnectionCard.svelte` | Button/Icon/Dialog/RowFeedback/CollectionProjectionSettings | Jellyfin/Trakt/Steam/Seerr linking and prefs, scan, disconnect impact; ADM03/05/10 |
| `ui/components/CollectionProjectionSettings.svelte` | Button/Dialog/RowFeedback; native controls | scope/source preview, bounded summaries, uncertain/conflict review, managed/remove-all confirmations; ADM05/07 |
| `ui/components/IntegrationSettings.svelte` | Heading/Button/Dialog/Field/RowFeedback/ProviderAutomation | all provider branches including IGDB/Comic Vine credentials, source disable/delete, add/edit; ADM02/05 |
| `ui/components/ProviderAutomation.svelte` | Heading/RowFeedback; native checks | provider-specific tasks enabled/disabled, busy/error; ADM05 |
| `ui/components/JobsSettings.svelte` | Heading/RowFilter/JobSchedule/EmptyState | grouping/filters, developer status, visibility-aware poll; ADM05 |
| `ui/components/JobSchedule.svelte` | Button menu/RowFilter/Dialog/RowFeedback + shared clock | current/last/next run, retry/promote/cancel, details, source selector/schedule; ADM05 |
| `ui/components/QueueList.svelte` | Button menu/contextGesture/EmptyState/RowFeedback | pending/running/failed, remedies, compact, empty; ADM05 |
| `ui/components/ConflictList.svelte` | Button/Dialog/RowFeedback + native article | values/progress, source winner, destructive confirm, empty; ADM05/07 |
| `src/lib/benchmarks/BenchmarkSettings.svelte` | Heading/Button/EmptyState/Pagination/createResource | lifetime/paging/comparison details; ADM06 |
| `src/lib/ui/materials/MaterialTweaker.svelte` | Heading/Button/SegmentedControl, existing materials, native controls | presets/native/fallback/experimental effects, background modes, sliders/colors, unsupported blend, export, local storage errors; specialized already represented |
| `src/lib/ui/components/{Field,FormActions,DetailCard,MetricGrid,ProgressBar,Dialog,RowFeedback}.svelte` | candidate owners | capabilities versus safe reuse limits; ADM01/02/03/06 |
| `src/app.css` relevant form/auth/settings/table/notice utilities | existing native design system | common inputs/focus/checkbox/fieldset/panel/notice/table/auth shells; legitimate mappings |
| `src/routes/ui-preview/{catalog.ts,Demo.svelte,PreviewSlot.svelte,+page.svelte,demo/+page.svelte,demo/fixtures.ts}` | reference and injected transport | present recipes, missing composition/state coverage, synthetic scan409; ADM04/05/06/07/08 |
| `src/lib/ui/component-manifest.json` | generated flat-component coverage | confirms current reusable components; not a complete page/state inventory |
| `docs/{design,performance,code-organization}.md` | normative design/lifetime/boundary rules | approved UI preservation, no competing renderer/scheduler, fixture isolation, component tree |
| `docs/public-api.md`, public API handler/OpenAPI references | API-only webhook capability | clarifies ADM09, no security/API audit claimed |

## Reference-first route forward

1. Add named **compositions/state recipes** alongside primitive inventory: auth, described settings + dirty actions, operational progress, dense native admin table/disclosure, one-time output, health/benchmark.
2. Expand existing provider/job/conflict fixtures using the current injected transport and explicit finite scenario selectors. Treat loading/error/empty/reconnect/permission/busy as selected states, not accidental default409s.
3. Fill straightforward reuse gaps with Field/RowFeedback/FormActions/Heading and metric tokens **without changing approved visual or interaction contracts**.
4. Present the two genuine missing composites and any visibly different metric layout as **Non-approved** variants for review, then decide whether extraction is worthwhile. Native form controls remain first-class.
5. During implementation apply shared request/lifetime rules to touched reads, verify meaningful failures and supersession, and preserve server/provider/job ownership. Do not turn this design pass into a rewrite of queue behavior or materials.

## Limits

No browser snapshots, keyboard/screen-reader sessions, real provider/device OAuth, clipboard tests, multiple browser engines or measured CPU/memory were run. Source confirms mapping and missing states; visual quality and focus/viewport acceptance remain follow-up work after fixture/reference coverage is added. No route/code/service changes were made. No production dependencies, schema changes or publication are proposed as necessary for this audit.

### ADM-11 — Whole settings/auth/benchmark components are not yet safe to mount as live UI-reference specimens

- **P1 / high confidence for reference isolation. Classification:** missing safe presentation/transport seam, not a request for a new visual element.
- **Evidence:** the preview injects `providePreviewClient(fixtureFetch)` (`src/routes/ui-preview/+page.svelte:27`, `demo/+page.svelte:6`) and `Demo.svelte:205` prevents ordinary anchor/default form navigation. That does not intercept handlers or mount-time work. Settings uses global `api/change` at `src/routes/settings/[[section]]/+page.svelte:28`, dynamic library fetch at `:37`, global `change` through save at `:174` and direct command handlers `:403`, `:412`, `:751`; password success imperatively `goto`s at `:443`. BenchmarkSettings imports global api/goto (`src/lib/benchmarks/BenchmarkSettings.svelte:3`, `:9`), posts a real benchmark at `:30` and polls at `:41`. Onboarding directly fetches a relative SvelteKit action at `src/routes/onboarding/+page.svelte:11` and enhances production forms; login/register/setup similarly bind production actions. AvatarPicker currently imports raw `fetch` at `src/lib/ui/components/AvatarPicker.svelte:73`, so its connected-avatar scenario bypasses injected fixture transport even though it is an inventoried component. `MaterialTweaker` intentionally writes browser-local drafts and clipboard/download only; its preview behavior is documented and should not be confused with safe remote mutations.
- **Smallest safe route:** do not directly import entire operational routes to achieve nominal reference completeness. First render exact presentation-only compositions supplied with fixture data/callbacks, or move the affected existing display component to the approved injected useClient seam, including polling and provider avatar reads. Disable/fixture imperative navigation and server-action effects explicitly rather than relying on capture listeners. Whole-auth specimens need presentation-only fields/submission callbacks or a contained form adapter, not a live `?/connect` route action. Benchmark specimen must never have a path to `POST admin/benchmarks` outside synthetic transport. Preserve production auth/CSRF/redirect behavior unchanged.
- **Performance:** one selected heavy specimen, no live timer fan-out from browsing the catalog; fixture scenario replacement/disposal cancels owned reads. Keep real administrative data and credentials out of examples; use finite local scenarios rather than a second production data layer.
- **Accessibility / acceptance:** current forms, labels and dialogs remain keyboard functional in demo, but all actions return deterministic synthetic states. Network capture asserts **zero** real `/api`, provider, auth-action or benchmark mutations during open/use/close/reopen. Anchor prevention alone is insufficient; test button handlers, mount/poll effects, provider-avatar selection, schedule save, run/retry, password success, invite/token creation, and delayed replies. No route navigation, real job, connected-account change or secret persistence occurs.
