# Design/component coverage audit — shared foundations and reference tooling

Date: 16 October 2026. Read-only application audit against the `codex/row-consistency` working tree (HEAD `7c15626`, plus the existing uncommitted row pass). The feature work is merged remotely through PR #33; this audit includes the local row work. No application changes, migrations, servers, dependencies, commits or publication performed.

## Scope and evidence boundary

Reviewed shared element contracts, global semantic CSS, component inventory generation, preview catalogue/recipes/fixtures/host, chart renderers and reference-only material tooling; inspected root/error composition and feature integration boundaries. An independent Svelte AST census covered all **118 `.svelte` files**: **63 flat registered components**, **30 non-preview route files**, **19 other library-owned renderers/compositions**, and **6 UI-preview files**. The 19 include four chart internals and the material editor already represented indirectly in dedicated reference sections. These counts describe source locations, not 49 missing components or proof of complete runtime/state coverage.

The census is a navigation aid, not an automatic finding generator. Native button/input/table/details/SVG/canvas use inside a component can be exactly the right implementation. Domain adapters and format-specific rendering remain separate from reusable visual primitives. Source evidence does not certify mobile, all browser families, keyboard interactions, actual render timing or every permission/provider state. Previous row-pass browser results are not new audit-wide acceptance evidence.

## FND-01 — The inventory's folder/import boundary misses real UI ownership

Priority P2, high confidence; classification: **inventory coverage gap**.

- `scripts/ui-inventory.ts:4–7` registers only direct `.svelte` children of `ui/components`; `:12–17,23–30` associates only static default/namespace imports whose complete component name matches a registered item. A boolean for snippets/dynamic tags (`:24`) does not map their actual feature owners.
- Root late-loaded Reader/MediaModal/panels are rendered at `src/routes/+layout.svelte:129–143`; the imports are dynamic. Feature-owned screen/reading Details, PlanAction, ShareAction, ReadingLaunch, Reader, BenchmarkSettings and work-menu compositions sit outside the registered folder. For You's DynamicFeed is also late-loaded.
- `src/routes/ui-preview/catalog.ts:1–4,24` derives the entire Elements/Components catalogue from this restricted manifest. The check confirms recipes exist for those names (`scripts/ui-inventory.ts:33–45`), not that all user-facing compositions or states are represented.
- Smallest route: extend build-time inventory with explicit feature-composition/reference-pattern entries and declared dynamic ownership; keep production files in their domain. Retain existing registered component identities, namespace new feature IDs where names collide (`media/Details` versus `reading/Details`). Record intentional native/specialized renderer ownership. Do not automatically move every Svelte file into the flat UI directory or create a runtime filesystem walker.
- Reference acceptance: every user-facing route/feature maps to an existing element/composition/pattern recipe or an explicit intentional exception; dynamic edges have declared owners; actual instantiation paths and fixture recipes are checked, not just name presence. Keep discovery/build cost bounded and do not eagerly import all examples.

## FND-02 — One demo per name does not cover the design's usable states

Priority P2, high confidence; classification: **existing variants and compositions not represented**.

- `src/routes/ui-preview/Demo.svelte:211–237` shows one Avatar/Field/FormActions setup and a small Button sample; `:250–285` shows one Dialog, one generic empty state, movie-centric cards, one MediaHero and a few MediaPage variants; `:337–353` includes empty RequestDialog, ordinary filters and a finite Shelf example list.
- This omits caller-important capability/state combinations: ordinary disabled and pressed controls, reasoned unavailable menu items versus ordinary buttons, primary card actions, busy/success/error forms, checkbox/range/select/file fields, long copy/missing images, inactive/cold/refreshing/partial/failure/settled-empty rows, full-page grid state, guest/feature-disabled controls and each media kind. Domain reports enumerate concrete recipes.
- Semantic `.notice`, `.badge`, `.table`, `.check`, `.panel`, `.skeleton` and native disclosure/search patterns already exist in `src/app.css:178–210,454–558,753–755`; omission from Elements is not evidence they need a Svelte wrapper.
- Smallest route: add labelled deterministic scenarios to the existing UI reference, using production renderers and global element styles. Distinguish element, composite, native pattern and internal renderer. Show a practical finite representative matrix with selectable states rather than a Cartesian product mounted at once. A visible scenario must be operable, not an inert no-op that only resembles the component.
- Acceptance: linked examples cover empty/loading/error/disabled/long-content and relevant medium states; no new competing form/card/menu/loading system; data/failure labels stay truthful. Preserve actual feature-specific pagination and input behaviour.

## FND-03 — Approval and feature-experiment status are not a shared catalogue contract

Priority P2, high confidence; classification: **reference/approval metadata gap**.

- Non-approved labels are hard-coded in different places: `ui-preview/+page.svelte:143` names three components; standalone `ui-preview/demo/+page.svelte:10` labels StreamsPanel only; Demo `:234,278,291` labels Button, friend activity and streams independently. Experimental controls elsewhere are another policy dimension.
- Consequence: the same view can have different approval signalling in inline versus standalone inspection; the inventory cannot distinguish a shared approved primitive from an unapproved composition using it.
- Smallest route: a finite recipe metadata field for recorded approval state and its scope, separately from experimental enablement. Reuse the same label in inline and standalone reference views. Unknown status stays explicitly unknown/review-needed; widespread production use does not grant approval. Do not infer new approval from this audit.
- Acceptance: deep links and gallery agree; variants can differ from their base component; no production redesign or automatic promotion; rejected styles are not quietly revived.

## FND-04 — Existing Button cannot be blindly substituted for every native action

Priority P2, high confidence; classification: **extension needed in an existing primitive / intentional specialized implementation**.

- `Button.svelte:10–25,81–94` exposes controlled action/menu props but no caller ID, arbitrary native target/download attributes, caller node binding or key handler. IDs are generated for menu triggers only (`:35,88`). Header panel anchors need stable external IDs; the social report gives the direct callers. This is a genuine capability gap in the intended action renderer, not justification for another Button family.
- Card primary actions (`MediaCard.svelte:233–246`) own 28px art-overlay geometry and demand-gated `liquidGlass({enabled:active})`. Button's material attachment is selected structurally (`Button.svelte:45–60`), and ordinary icon mode has no material. Direct substitution would change appearance or activate effects early. Rating's native star controls (`Rating.svelte:59–105`), segment buttons and SVG ChartMark own legitimate specialized semantics and keyboard behaviour.
- Smallest route: extend Button narrowly for demonstrated stable-ID/native action needs before migrating those consumers. Represent card primary/utility controls as MediaCard variants and preserve demand/material/keyboard ownership; decide on a reusable action extension only after inspecting those variants. Do not apply a blanket raw-button rewrite or change materials in this audit.
- Acceptance: native IDs/focus anchors work, menu ARIA identity remains internally consistent, disabled links do not navigate, held material/observer resources retain current lazy lifetime. Native slider/half-star/SVG semantics remain with their owning components.

## FND-05 — Foundations do not yet show all existing design roles

Priority P3, high confidence; classification: **existing foundation/pattern reference gap**, not an approved token redesign.

- UI reference foundation controls are limited to typography, colours, material experiments and charts (`ui-preview/+page.svelte:30–36,57–133`). App tokens also define control/icon sizes, motion/curve, gutters and elevation (`src/app.css:14–20,55–66`). Radius/spacing roles are expressed in component-specific geometry and chart tokens (`src/lib/ui/charts/chart.css:18–25`), not a universal shared radius scale.
- Smallest route: show existing size/density, motion/reduced-motion, spacing, corner and surface roles as references with their actual owning source. Inventory repeated intentional values before proposing global aliases; do not claim every numeric value is drift or normalize approved shapes to one radius. Material preview is a prototype tool, not proof that every current production material/fallback use is faithfully represented.
- Acceptance: control/compact/coarse-pointer, icon, focus, long-label, reduced-motion, solid/glass/fallback roles can be inspected without modifying global styles. Any future token consolidation needs before/after visual approval and lifecycle evidence.

## FND-06 — New reference coverage needs explicit fixture and lifetime boundaries

Priority P2 for next-stage acceptance; high confidence in the source boundaries, **not a proven current production leak**. Classification: **reference capability/validation gap**.

- `ui-preview/Demo.svelte:205` prevents form default submission and ordinary anchor defaults; it cannot contain direct global API calls, imperative navigation or singleton session mutation. `ui/client-context.ts` and `playback/context.svelte.ts` are the existing safe injected-client/playback mechanisms. A feature must actually use them to be safe in a demo; direct-reader/party/admin cases need the owner seam identified by the domain reports.
- `ui-preview/demo/fixtures.ts:33–38` rejects most writes and one explicit fake scan returns a synthetic queued count. Unsupported GETs return a visible 409; this is safe refusal, not a usable complete demo state. Current fixtures contain obsolete or incomplete data shapes, e.g. friend-request notifications (`:27`) and a `progress` response without its required category (`:62`).
- `PreviewSlot.svelte:5–14` mounts on first intersection and retains that demo after leaving; it is finite today. The shared host's `.preview` scrolling containment and Demo's `contain:layout paint`/hero/content overrides (`Demo.svelte:359–365`) intentionally alter context. They are not full-page visual proof. Expansion must not multiply active heavy renderers/timers/jobs merely to display every scenario.
- Smallest route: inject finite fixtures and local mutation state through existing feature/client owners; keep refused effects explicit and do not replace global fetch. Add a declared host mode for page/persistent/overlay compositions using production geometry. Retain one active heavy state per example/selected scenario; disposal on switch must cancel requests/release workers, URLs, media and timers. Reuse existing PreviewSlot/menu/resource lifecycles rather than a second scheduler.
- Acceptance: supported examples resolve with contract-correct data; unsupported effects are visibly disabled; no real account/provider/job/session changes; no external media imports merely to show launch controls. Cold/open/use/switch/close/reopen is tested with finite request, observer, worker and retained-memory budgets. Source inspection alone is not that runtime proof.

## Intentional implementations to preserve

- BarChart/BreakdownChart/ProgressChart components already map to the flat registry; ChartView/StandardChart/ExtendedChart/ChartMark are preview-only explorations covered through the dedicated Charts section, not unregistered replacement production widgets. SVG mark geometry, roving keyboard focus, exact-data tables, scale units, unknown values and finite mark limits must remain with chart models/renderers.
- MaterialTweaker is reference-only; its layer/background controls do not constitute a second production form system. No material changes are authorized by this audit.
- Native semantic tables, disclosure summaries, file inputs, labelled fields, canvas/video/img render targets and source-specific commands are valid children/implementations of shared composites.
- Root layout is a persistent application composition, not a reusable page card. Its rendering/visibility/gates need a safe fixture scenario, not relocation into ui/components. Global error page correctly maps to EmptyState + Button (`src/routes/+error.svelte:2–17`).

## Suggested order

1. Establish full ownership/coverage metadata and reconcile declared approval status.
2. Add safe deterministic scenarios for existing UI, including native styled patterns and feature-owned compositions; preserve lazy loading and design.
3. Represent missing-capability candidates as explicitly Non-approved scenarios only after selecting the smallest extension/composite.
4. Apply confirmed reuse/state fixes, compare production geometry and run appropriate focused UI/performance acceptance.

Do not turn this staged audit into an unsolicited design overhaul or component-per-tag exercise.
