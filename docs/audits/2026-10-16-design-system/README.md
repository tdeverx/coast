# Design-system coverage audit

16 October 2026 · Stage 1: ownership, reuse and reference coverage.

**Stage 3 playground:** the reference now uses the approved Focus/Studio combination: a selected canvas, a floating customiser that can pin into a desktop column, a mobile sheet, and one searchable horizontal browser across the reference sections. Only the selected specimen/editor mounts. Material drafts and chart fixtures retain their existing owners and renderers; the new layout does not change production material layers or presets. Eight shared elements expose explicit, genuine prop controls; the remaining examples retain scenario inspection. Typography/colour edits and canvas options are local. The old multi-specimen visibility slot has been removed. Stage 2 evidence below describes the earlier coverage baseline, not this later layout's acceptance.

Stage 3 validation: build and type checks pass with zero errors/warnings; the full unit suite passed 589 tests (665 database skips), and 29 chart/material checks pass after the layout changes. Isolated Chromium checks at 1440×1000, 390×844 and 320px width verify selected-only mounting, draft retention through pin/close/reopen, keyboard dismissal/focus, stable picker position, chart context/dataset retention and mobile canvas bounds. Larger compositions retain native geometry and scroll inside the canvas. Other browser engines and real media decoding were not exercised.

Final audit fixes: same-component scenario navigation now follows the URL, including Back/Forward and standalone examples; explicit bookmarked scenarios take precedence over editable defaults. The bounded canvas is keyboard-scrollable. Colour inputs resolve shorthand and mixed theme colours to the actual sRGB swatch instead of showing an unrelated accent fallback. Drafts remain local and survive customiser pinning, closing and viewport changes. The shared Shelf header's previous/filter/next order and nested type selection were exercised against the real renderer with synthetic data. No production material presets, dependencies or database schemas changed in this pass.

**Stage 2 implementation:** preview isolation and Settings → UI reference expansion are now implemented in the working tree. The historical findings below remain the audit baseline. The reference has 63 shared component entries plus 28 explicit composition recipes, with 132 composition scenarios and 93 named component scenarios (plus defaults for the other components). The build-time inventory verifies every production Svelte owner, actual recipe dispatch, dynamic imports and thin route delegation. Existing designs and domain locations are retained; the later production reuse/consolidation work is still separate.

Each specimen now owns its fixture transport and playback defaults. Party, reader, sharing, avatar, benchmark, jobs, navigation and clipboard paths have explicit preview boundaries. Unknown requests fail closed; supported actions use synthetic data. Offscreen slots unmount their owners and retain geometry. Preview readers/controllers explicitly demonstrate presentation, not real format decoding/playback. Existing settings/native patterns are represented before extracting new primitives.

Validation: production build and type check pass (zero errors/warnings); 586 unit tests pass, with 665 database tests skipped; inventory, source style and diff checks pass. Chromium smoke coverage reached all 91 entries without runtime exceptions. Desktop 1440×1000 and mobile 390×844 checks exercised catalogue filtering, scenario bookmarks, synthetic sharing/copy/revoke, reader page navigation and blocked live party creation. Observed network traffic was limited to legitimate app-shell stream counts, session heartbeat and diagnostics; specimen actions produced no escaped requests. This does not certify every secondary action, every scenario, other browser engines or actual media/reader decoding. No dev/live migrations or publication were performed.

Most of Coast's user interface already composes its existing elements correctly. The main gap is that Settings → UI does not represent the full interface: it inventories one component folder and mostly offers one example per component. Some feature-owned compositions, native styled patterns, media variants and important loading/error/permission states fall outside that view.

This report combines three independent area audits and a foundation/reference audit. It removes duplicate flags and distinguishes existing components that can be reused from capabilities the current system cannot express faithfully. It proposes no redesign. **Application code was not changed during this audit.** Existing uncommitted row-consistency changes are included in the inspected snapshot and remain untouched.

## Evidence and coverage

- Snapshot: `codex/row-consistency`, HEAD `7c15626`, plus the existing uncommitted row pass. Source references describe this working tree; line numbers may move after implementation.
- The Svelte source census covers **118 files**: 63 registered shared components, 30 non-preview route files, 19 other library-owned compositions/renderers, and 6 UI-preview files. Four of those 19 are chart internals and one is the reference-only material editor. These counts are locations, **not a count of missing components**.
- Area auditors read actual templates, state branches, component contracts and local styles; the census records static instantiation edges and declared native/dynamic rendering. Route/server/provider logic was checked only where needed to understand presentation ownership.
- `bun run ui:inventory:check` passed for the existing 63-entry inventory. Its limited scope is itself a finding; passing does not establish complete design coverage.
- No new browser acceptance, provider calls, live commands, database changes or runtime performance measurements were performed. This is a source-backed coverage audit. Earlier row-pass tests do not certify these audit-wide findings or future fixes.

The [coverage ledger](coverage.md) lists every Svelte file and its review owner. Independent evidence is retained in [foundations](01-foundations.md), [catalogue/media](02-catalogue.md), [social/playback](03-social-playback.md) and [account/admin](04-account-admin.md). Their local finding numbers are evidence references; the DS numbers below are the canonical, deduplicated work list. Independent priorities reflect each area's assessment; this combined list controls implementation sequencing.

## What genuinely lacks a usable shared capability

| Current need | Why the closest existing element is insufficient | Smallest proposed treatment |
| --- | --- | --- |
| Described settings row | `Field` and `FormActions` cannot retain the current title, description, unavailable/prerequisite reason and trailing control as one reusable row. | Represent today's exact row first; extract that presentation if approved. Keep draft/save ownership in settings. **DS-11** |
| Operational progress with an unknown total | `ProgressBar` always emits a numeric current value and maps nonfinite input to zero. Unknown import progress must not become 0%. | Native progress-based composition or narrow determinate/indeterminate extension; no new polling owner. **DS-12** |
| Stable caller ID on an ordinary shared Button | Header panel anchors require known IDs; `Button` currently only generates IDs for its own menus. | Extend the existing Button contract, preserving menu ARIA identity, then migrate eligible triggers. **DS-05** |

These additional cases need reference recipes first; they do **not** establish that another shared component is necessary:

| Current composition | Limitation of the nearest shared composite | Smallest proposed treatment |
| --- | --- | --- |
| Shared navigation for an unknown final page | `Pagination` requires a total and prints “Page x of y”; friend/edition lookahead cannot supply a truthful y. Existing Buttons already express their current behavior. | Document the current composition; extend Pagination only if consolidating it is useful. Never invent a total. **DS-10** |
| Profile identity header as a drop-in composite | `MediaHero`, `ActivityHeader` and `IdentityCard` have different roles and geometry. | Add a recipe of the current route composition. A ProfileHeader extraction is conditional, not required to close reference coverage. Person biographies follow the same recipe-first principle. **DS-14** |

No new generic card, menu, table library, search engine, reader engine, global skeleton system or production dependency is established as necessary. Native inputs, tables, disclosure elements, canvas/video/image targets and SVG chart marks remain legitimate parts of the element system.

## Consolidated findings

P1: address before expanding interactive reference coverage. P2: concrete reuse, state or capability gap. P3: reference/documentation completeness or optional consolidation. Source confidence is high unless explicitly marked for rendered confirmation; priority is not a claim of measured visual severity.

### DS-01 · P1 · Some previews can escape into live commands

**Classification:** preview containment, not a new visual component.

The existing FriendsPanel example imports live `startSynced`/`joinSynced` and singleton state. Its preview flag stops polling but does not guard Create party, Join or Invite. Those commands use the global API and player rather than the injected preview transport. Preventing ordinary anchor/form defaults in Demo does not intercept imperative commands. This path was traced, not executed. ShareAction, PlanAction, Reader, provider-avatar selection, settings/auth and benchmarking have similar boundaries that must be addressed before richer specimens are mounted; some are prospective examples rather than current gallery entries.

**Route:** supply fixture data and local commands through existing client/playback owners or presentation-only callbacks. Temporarily disable unsafe actions explicitly until their safe seam exists. Do not seed the real singleton, mount live operational routes under fake data, monkeypatch global fetch or introduce a second party engine.

**Acceptance:** specimen-owned open/use/switch/close/reopen work cannot change real room/player/account/job state, navigate routes or issue real API/provider/auth-action requests. Attribute requests to their owner: legitimate authenticated app-shell polling outside the preview context is separate. Synthetic successes, busy states and failures remain inspectable. Test mount-time reads, polling, provider-avatar selection and imperative button handlers as well as ordinary forms.

Evidence: [SOC-11 isolation matrix](03-social-playback.md#soc-11--existing-party-previews-do-not-isolate-all-commands-from-live-application-state), ADM-11, FND-06; `FriendsPanel.svelte:20,32,35,41,67`, `playback/synced/client.svelte.ts:35–67`, `Demo.svelte:205,293`.

### DS-02 · P2 · Inventory covers a folder rather than the whole interface

**Classification:** ownership/inventory gap.

The generator registers direct `ui/components/*.svelte` files and static imports; feature-owned Details, Reader/ReadingLaunch, sharing/planning, benchmarking and dynamically imported root/dynamic-feed UI are not fully represented as reference owners. Their locations are appropriate; moving all files into the shared folder would obscure domain ownership.

**Route:** add explicit feature-composition and native-pattern metadata with declared dynamic edges, stable namespaced IDs and reference recipes. Keep the existing flat component registrations. Validate actual recipe coverage rather than only a matching name; build-time discovery must not cause eager runtime imports.

**Acceptance:** every visible route/feature maps to a component, composition, styled native pattern or documented internal renderer. Colliding `media/Details` and `reading/Details` remain distinct owners.

Evidence: FND-01, CAT-05, SOC-01, ADM-06/07; `scripts/ui-inventory.ts:4–45`, `ui-preview/catalog.ts:1–24`, `routes/+layout.svelte:129–143`.

### DS-03 · P2 · Reference states and fixtures do not match production coverage

**Classification:** existing components and variants missing from reference.

Movie-centric card/hero/detail examples do not cover real music/game/book/comic, remote/imported, guest/disabled, long-copy, missing-art or partial-failure states. Party invite/rejoin/sticky-footer/follower states, stream issues/shared viewers, notification attachments/actions, reader/share flows, auth, settings save states and job/connection transitions are incomplete. Missing fixture routes can make the default connected-account example show an unintended scan error. Old friend-request notifications and incomplete DTOs also drift from current behavior.

**Route:** use finite selectable scenarios with contract-correct local data, the actual production renderer and safe synthetic operations. Register feature-owned recipes explicitly. A refused operation is a useful failure example, but not a substitute for a usable success example. Show one selected heavy state at a time rather than mounting a Cartesian product. Family-specific skeleton geometry is a reference state first, not automatic justification for a new primitive.

**Acceptance:** the [required reference families](#required-reference-families-for-stage-2) below are discoverable, deterministic and operable without live services; failures retain unrelated settled content. Unvisited reader/player examples import no engines merely to display launch controls.

Evidence: FND-02/06, CAT-05/06/09, SOC-01/08/09/10, ADM-04/05/08; detailed state lists in each independent report.

### DS-04 · P2 · Approval status differs between reference hosts

**Classification:** reference metadata gap.

Non-approved labels are hard-coded separately in inline recipes, gallery cards and standalone demos. Feature experiment enablement is a separate concern and cannot imply visual approval.

**Route:** store recorded approval state and its scope alongside recipe metadata; both hosts render the same status. Unknown status remains review-needed. Existing Non-approved Button/social/notification/stream/planning treatments are not silently promoted.

**Acceptance:** direct links and inline examples agree; a variant can have a different status from its base; no rejected treatment is revived.

Evidence: FND-03, CAT approval distinctions, SOC-08; `ui-preview/+page.svelte:143`, `demo/+page.svelte:10`, `Demo.svelte:234,278,291`.

### DS-05 · P2 · Shared Button needs stable-ID support before header reuse

**Classification:** narrow existing-component capability gap.

Header stream/friend/notification triggers need stable anchor IDs that Button cannot currently receive. Badge children are already expressible. Blind replacement would break panel positioning or focus return.

**Route:** support the demonstrated ID requirement in Button, reconcile generated menu IDs/ARIA, then reuse ordinary icon Button for eligible triggers. Other missing native attributes are not a reason to add unused props. MediaCard's primary control, Rating stars, segments and SVG marks retain their specialized geometry and behavior.

**Acceptance:** same anchor/focus targets, no duplicate IDs, same badges and coarse-pointer sizing, no new count reads or eagerly activated materials.

Evidence: FND-04, SOC-07; `Header.svelte:75–82`, `Button.svelte:10–25,81–94` and literal panel anchors.

### DS-06 · P2 · Music/Games browse still duplicate Shelf rendering

**Classification:** existing renderer reuse gap.

Their top-level browse pages repeat grid/card loops, counts, pagination, error/empty branches and header controls while other browse experiences use Shelf. Cards themselves correctly reuse MediaCard.

**Route:** feed current SSR results and domain URLs into Shelf's grid contract. Retain source permission policy, server filtering/pagination and native links. Shared rendering must not add a new route GET or unnecessary optional social enrichment.

**Acceptance:** identical results/order/URLs, one common header/grid renderer, filter opening performs no request, preserved image admission and bounded page size.

Evidence: CAT-01; `music/+page.svelte:26–85`, `games/+page.svelte:27–94`, `Shelf.svelte` grid and controlled-data contracts.

### DS-07 · P2 · Reading history can show empty while initially loading

**Classification:** concrete state-contract misuse of an existing Shelf.

Reading Details supplies custom children and busy state but no itemCount. Shelf consequently derives a null count and cannot activate its zero-item loading branch. The custom children render “No reading history yet” whenever the initial array is empty, including pending work; navigation is separately hand-rendered.

**Route:** supply actual count/readiness, error/retry and paging through the existing contract; render empty only after confirmed settlement. Include inactive-before-viewport as well as pending states. Keep the existing resource and lazy activation owner.

**Acceptance:** no false empty during cold/pending history, no new eager GET/observer, correct event/page identity, cancellation prevents stale delivery and refresh preserves settled content.

Evidence: CAT-04; `reading/Details.svelte:101–106`, `Shelf.svelte:101–103`.

### DS-08 · P2 · A few ordinary actions bypass the shared control

**Classification:** reuse gap, with geometry review required.

The episode watched toggle duplicates pressed/disabled/icon semantics available in Button. Toast dismiss controls use native 28px controls while the shared icon control has established sizing. The whole-toast hit target and MediaCard overlay action remain intentional specialized controls.

**Route:** use Button where its contract fits; compare selected styling, position and hit geometry before replacing local classes. Do not change materials or turn all native buttons into ordinary buttons.

**Acceptance:** watched confirmation/target identity remains correct; toast dismissal/undo/error rollback works once, without activating the whole notice; labels, focus and touch targets are preserved.

Evidence: CAT-02, SOC-06; `media/Details.svelte:114–120`, `NotificationToasts.svelte:64–84,122–125`.

### DS-09 · P2 · Forms and plain feedback have straightforward reuse gaps

**Classification:** existing Field/FormActions/RowFeedback reuse.

Lists, manual seasons, tracking dialogs, reading launch, planning/sharing, friend requests, some profile/player controls and account/admin paths repeat equivalent field labels, footer spacing or dynamic error/status markup. Some onboarding errors omit the live-region semantics used by adjacent forms.

**Route:** adopt existing wrappers only where semantics and approved geometry match. Preserve native validation, fieldset groups, file/range/select controls, one-action footers, submit order and domain retry ownership. RowFeedback's tag-only mode does not supply retry controls; never drop them during substitution. Static policy warnings need not become runtime alerts.

**Acceptance:** native attributes/labels and validation survive; errors announce once next to the affected control; no duplicated submit, premature option read, stale error or lost retry; secondary command state outlives the transient menu.

Evidence: CAT-03/09, SOC-03/05, ADM-02/04/08; exact callers are listed in those reports.

### DS-10 · P2 · Known-total and cursor navigation need distinct shared treatment

**Classification:** known-total reuse; unknown-total composition/capability gap.

Music history has a true page count but duplicates Previous/Next. Friends and reading source choices only have lookahead/offset information, which the current “Page x of y” Pagination cannot express. Profile favourites appear to receive Shelf page controls plus a footer Pagination; whether both are intended needs rendered confirmation.

**Route:** reuse Pagination for true totals; document or narrowly extend a next/previous-only composition for unknown totals. Inspect profile controls before removing anything. Preserve domain cursors, result reachability and request admission.

**Acceptance:** truthful counts, disabled ends, stable focus, one request per choice, no guessed last page or silently truncated options.

Evidence: SOC-04, CAT-04; `MusicCommands.svelte:16,48`, `FriendsPanel.svelte:73–75`, `ReadingLaunch.svelte:10,29`, `Pagination.svelte:20–34`, profile `:284–286,532–537`.

### DS-11 · P2 · Described settings rows lack a reusable presenter

**Classification:** genuine missing reusable composite; dirty-save state is a related recipe.

Settings repeats title/description/trailing checkbox and remembered/unavailable/prerequisite explanation. Field alone is insufficient. Save/discard/busy/error/saved behavior belongs to the section draft owner, not the new display row.

**Route:** represent today's exact row and save treatment, then extract only that repeated presentation. Preserve native checkbox, fieldsets, explanations and unsaved edits through refresh. No settings framework or invented switch is needed.

**Acceptance:** label/help association, disabled reason, narrow layout and equal existing spacing; no new resource/cache; section saves only its intended fields.

Evidence: ADM-01; settings `:183,227,275,818–833,1166`, `Field.svelte`, `FormActions.svelte`.

### DS-12 · P2 · Operational progress needs truthful unknown-total semantics

**Classification:** genuine missing usable progress variant/composite.

Connection/onboarding progress uses native progress and local styling. Shared playback ProgressBar always exposes aria-valuenow and cannot represent an indeterminate import without falsely implying zero completion.

**Route:** use native progress semantics with known/unknown totals and supplied stage/count text. Extend the closest owner or introduce only the small operational composition demonstrated by the reference. It displays values; it never polls or schedules jobs.

**Acceptance:** queued/unknown/running/waiting/completed/failed/zero-total, reduced motion and long labels; no fabricated percent; browser-specific native styling checked before replacement.

Evidence: ADM-03; `ProgressBar.svelte:2–6`, `ConnectionCard.svelte:265–295,375–421`, onboarding `:43`.

### DS-13 · P2 · Administrative metric presentation bypasses existing metric elements

**Classification:** reuse opportunity requiring visual review.

Health and benchmark summaries repeat metric/panel typography while DetailCard, MetricGrid and FactList already express their information. That does not authorize replacing dense operational lists with large cards; the user has rejected that direction before.

**Route:** first expose current dense layouts as specimens. Reuse matching typography/tokens; any visibly different metric composition is a separate Non-approved example before adoption.

**Acceptance:** exact values, units, missing-data distinctions, warning/context details and comparison compatibility retained; no real benchmark queued by a demo, no chart bundle imported to display simple facts.

Evidence: ADM-06; settings `:570–590,1191–1210`, `BenchmarkSettings.svelte:59–91`.

### DS-14 · P3 · Native patterns and page compositions need recipes, not forced wrappers

**Classification:** missing composition reference; conditional extraction only.

Profile identity/favourites/insights, person portrait/biography, authentication shell, search variants, selected editions, request status, missing-demand list, history selection, dense tables/disclosures and one-time token/invite output use valid existing elements but lack complete reference recipes. Profile identity has no usable drop-in hero; composing current markup remains valid. Chart internals are already represented through the Charts section and are not four missing production widgets.

**Route:** catalogue these exact patterns with native semantic HTML and current shared classes/components. Use presentation-only data/actions for route specimens. Extract a presenter only when repeated semantics or a clear ownership responsibility justify it. Never force missing-demand rows without full MediaView data into media cards.

**Acceptance:** preserve h1, labels, table relationships, native disclosure keyboard operation, privacy, source links, secret lifetime and bounded data. Use synthetic one-time outputs; no real secrets in URLs, fixtures or screenshots.

Evidence: CAT-06/07/08/09, SOC-02/10, ADM-04/07/08, FND-02/05.

### DS-15 · P2 · Some optional reads lack current lifetime guards

**Classification:** touched-feature lifecycle consistency, not a new design element or proven leak.

Connection scan reads clear their polling interval but lack abort/current-identity publication guards. Onboarding polls can publish after leaving; avatar reads/errors have supersession gaps. In contrast newer resource owners already provide cancellation and generation checks. Reference slots currently mount once and retain finite examples; enlarging the catalog must not multiply active heavy resources.

**Route:** use existing request/resource ownership for touched reads, cancel obsolete delivery and dispose owned work. Give heavy recipes an explicit selected lifetime using current mechanisms. Preserve mutation semantics: aborting delivery cannot undo an authorization. Assess essential onboarding hidden-tab policy separately from decorative preview suspension; no new global poll scheduler is justified.

**Acceptance:** held/failed responses across identity replacement/unmount/reopen cannot overwrite current state; optional reads are bounded/one in flight; workers, URLs, media, observers and timers are released where owned. Record runtime budgets for changed examples rather than claiming a source audit measured a leak.

Evidence: ADM-10, FND-06, SOC-01/08; `ConnectionCard.svelte:63–105`, onboarding `:9–14`, `AvatarPicker.svelte:19–78`, `PreviewSlot.svelte:5–14`.

### DS-16 · P3 · Foundation roles are only partly represented

**Classification:** existing token/pattern reference gap.

Typography/colors/materials/charts exist in reference, but control and icon sizes, coarse-pointer sizing, spacing/gutters, focus, motion/reduced motion, corner and elevation roles are not all demonstrated. Intentional numeric geometry is not automatically drift; there is no evidence authorizing a global radius or material rewrite.

**Route:** document/display actual existing roles and owners first. Any future token alias proposal must preserve approved shapes. MaterialTweaker remains an isolated Non-approved experiment, not an instruction to change production layers.

**Acceptance:** compact/ordinary/hero/coarse-pointer controls, solid/glass/fallback, focus and reduced motion inspectable without applying experimental styles globally.

Evidence: FND-05; `app.css:14–20,55–66`, `ui/charts/chart.css:18–25`, existing reference sections.

### DS-17 · P3 · Guidance and some feature copy lag actual behavior

**Classification:** documentation/copy drift.

Design guidance still describes pausing as the browsing-UI trigger despite the current Show UI control. Party landing copy assumes Jellyfin/playback although reading is supported. Separately, webhook subscriptions are currently API-managed; reference metadata should distinguish that capability from the browser token UI. The token settings description is not evidence that a browser webhook editor was promised.

**Route:** align docs and copy with inspected supported behavior; keep existing UI/playback behavior. Represent shipped browser features separately from machine API capabilities. Verify any retained sharing branch's actual reachability before writing a specimen implying it ships.

**Acceptance:** documentation does not instruct restoration of superseded UX; no fictional webhook editor or cross-platform sharing behavior is implied.

Evidence: SOC-10, ADM-09; `docs/design.md:64,86`, `PersistentPlayer.svelte:631`, `synced/[id]/+page.svelte:9–12`, settings API access and `docs/public-api.md`.

## Required reference families for stage 2

These are coverage groups, not a mandate to add new components or mount all cases together. Independent reports supply precise states and source locations.

| Family | Required representative cases | Existing owner / missing seam |
| --- | --- | --- |
| Foundations and native elements | Current sizes, typography, focus, motion, corners, surfaces; input/select/file/range/checkbox, notice/badge, table/disclosure | Existing tokens/classes and primitives; recipes missing |
| Controls and menus | Action/icon/pressed/disabled/busy/danger, disabled reason, nested/filter menu, keyboard/mobile drilldown and focus return | Button/RowFilter/ChoiceGroup; stable caller ID gap |
| Forms and confirmation | Validation, submit failure, busy/success, one/two-action footer, destructive confirmation | Field/FormActions/Dialog/RowFeedback; retain form ownership |
| Cards and rows | Every real medium and shape, missing/broken art, unavailable preference/guest, primary overlay, progress/social, cold/loading/refresh/empty/error | MediaCard/Shelf; same artwork admission and source bounds |
| Browsing and details | For You/dynamic, Discover, Search available/unavailable, Library, lists, progress, upcoming, source-specific games/music, remote/imported screen/reading details | Existing Shelf/MediaPage and domain adapters; explicit feature recipes |
| Small detail patterns | Edition selection, request status, history selection, missing demand, game table, biography | Existing native/component compositions |
| Profiles and taste | Self/other/private, no/long artwork/bio, favourites/insights, null scores, each medium | Existing route composition; safe presentation recipe |
| Social and parties | Friends/pending/paged, invite/rejoin/joined idle/playing, host/member, embedded footer, pending/many people, queue error, reading/music/video | FriendRoster/PartyCard/PartyMenu; isolate live commands first |
| Notifications and streams | Read/unread/locked/actions/attachments, pending/error/partial/empty/history/shared viewers, toast undo/failure | Existing inbox/stream/toast components; contract-correct fixtures |
| Playback and reading | Inactive/audio/video/browsing/paused/error/postplay/follower, seek/passive timeline, reader opening/page/save-failure/minimized, launch unsupported/paged | Existing player/hero/reader; isolated engines and commands on demand |
| Sharing and planning | Sources/expiry, preparing/created/copy fallback/revoke/error, plan party/friend selection | Existing feature-owned Dialog compositions; injected transport/commands |
| Account and onboarding | Login/register/setup/password, invite/open, service errors, unknown imports/retry, avatar upload/provider/failure | AccountFields/AvatarPicker/auth shell; no live form actions |
| Settings and administration | Described/disabled rows, dirty/save/discard, health, dense tables, diagnostics, secret output | Existing native/shared composition; two narrow presenter gaps |
| Integrations and tasks | Missing/connected/reconnect, scan unknown/known/error, schedule/manual/queued/running/waiting/failure/empty | ConnectionCard/IntegrationSettings/JobsSettings; finite safe fixture scenarios |
| Benchmarks | Queued/running/complete/failed/cancelled, partial metrics, comparison/context, paged/narrow | BenchmarkSettings current layout; safe transport seam |
| Charts and materials tools | Current renderer variants, exact values/units, unavailable values, focus, long labels; isolated material experiment/fallback | Existing dedicated sections; do not duplicate renderer families or apply draft effects |

## Implementation order and completion gates

1. **Contain the current preview escapes (DS-01), then broaden ownership metadata (DS-02/04).** Reuse current contexts and explicit finite registration. No new reference page design is required.
2. **Represent existing UI in Settings → UI (DS-03/14/16).** Add safe scenario recipes and native patterns, keeping domain files in their existing locations. Use production presentation; preserve geometry. Record any intentional limitation instead of silently disabling a specimen.
3. **Show missing-capability candidates explicitly.** Exact existing settings/progress compositions first; stable-ID and optional unknown-page extensions only where required. New or visually changed variants stay Non-approved pending review.
4. **Clean up confirmed drift (DS-05–13/15/17).** Adopt existing owners, fix false loading/empty states and touched lifetime gaps. Dense metrics and apparent duplicate controls need rendered comparison before changing layout.
5. **Validate the changed contracts.** Desktop/narrow/coarse pointer, keyboard/focus, reduced motion, missing art, guest/gates and cold/refresh/empty/error states. Use held/late replies to prove cancellation. Count requests/owners and verify disposal. No provider traffic or real mutation may escape a demo. Cross-browser checks apply to changed native progress/control styling; source inspection alone is not visual acceptance.

Existing performance rules remain authoritative: one Shelf/card/menu renderer; no second loader/scheduler/cache; no new eager GET for SSR-ready data; no reader/chart/format bundle until demanded; source filtering/counting before bounded pagination; stable occurrence identity; one request owner; cancellation and retained settled data. No new dependencies or schema changes are needed to undertake this plan.

## Traceability

| Independent finding(s) | Canonical finding(s) |
| --- | --- |
| FND-01 | DS-02 |
| FND-02 | DS-03, DS-14 |
| FND-03 | DS-04 |
| FND-04 | DS-05, DS-08 |
| FND-05 | DS-16 |
| FND-06 | DS-01, DS-03, DS-15 |
| CAT-01 | DS-06 |
| CAT-02 | DS-08 |
| CAT-03, CAT-09 | DS-09, DS-14 |
| CAT-04 | DS-07, DS-10 |
| CAT-05 | DS-02, DS-03 |
| CAT-06–08 | DS-14 |
| SOC-01 | DS-01–03 |
| SOC-02 | DS-14 |
| SOC-03, SOC-05 | DS-09 |
| SOC-04 | DS-10 |
| SOC-06 | DS-08 |
| SOC-07 | DS-05 |
| SOC-08, SOC-09 | DS-03 |
| SOC-10 | DS-03, DS-14, DS-17 |
| SOC-11 | DS-01 |
| ADM-01 | DS-11 |
| ADM-02 | DS-09 |
| ADM-03 | DS-12 |
| ADM-04, ADM-07, ADM-08 | DS-03, DS-09, DS-14 |
| ADM-05 | DS-03 |
| ADM-06 | DS-02, DS-13 |
| ADM-09 | DS-17 |
| ADM-10 | DS-15 |
| ADM-11 | DS-01 |

The audit and reference-expansion stages are complete; the implementation note above records their acceptance boundary. Production reuse/consolidation changes remain the next stage. Source-backed independent reports are historical evidence, not claims that those later changes or exhaustive browser acceptance are complete.
