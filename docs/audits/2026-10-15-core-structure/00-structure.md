# Repository structure and consistency

Scope: current working tree, including pending/untracked source. No application changes. This is an engineering audit, not a release certification or a formal exhaustive security scan.

## Method and coverage

- Inventoried all 497 TypeScript/Svelte/JavaScript files under `src`, plus scripts, tests, migrations, workflow and current architecture/performance guides. `structure-inventory.json` records resolved imports and runtime dependency groups. The analysis distinguishes explicit type-only imports; Svelte script blocks are parsed as TypeScript. It does not prove arbitrary computed imports or runtime behavior.
- Followed both direct and transitive runtime edges from 114 component/client-route roots. No server-only target was found on those paths. Naming candidates found no non-PascalCase library components or obvious database/provider server modules missing their server protection.
- `code:inventory` reports zero unused modules. `ui:inventory:check` verifies 63 components. These are module/composition checks, not proofs that every function is useful or that every UI state works.
- Substantively inspected the organization/performance guides, inventory implementation, selected API dispatch, auth/reset, sync/export, reader loader and shared policy boundaries. Dedicated reports inspect the feature implementations more deeply.
- Baseline: type check zero errors/warnings; default suite 393 passed, 534 skipped (including environment-gated checks); production build passed. Type checking and build ran sequentially because both regenerate `.svelte-kit`. No database, provider or production service was changed.

## Healthy structure to retain

The feature folders, protected server infrastructure, transactional `core`, metadata `catalogue`, explicit `application` workflows and shared UI shelves are meaningful rather than arbitrary layers. Module names and server suffixes are consistent. Existing client resource, row layout, provider transport and queue mechanisms should be reused; the audit does not justify replacing them with another framework or scheduler.

Three runtime dependency groups exist. Sync changes/values and playback/party/reading coordinate through deferred imports and do not show an eager initialization failure. Their existence alone is not a bug. The smaller reader dispatcher/helper group is avoidable; see STRUCT-02.

## Findings

### STRUCT-01 — P3: Dense compound source has no consistent authoring guard

61 modules have at least five source lines longer than 240 characters. This is not a line-length performance issue. The concern is collapsed control flow and intertwined SQL decisions in code that has important failure/ownership semantics: examples include `src/lib/server/queue/index.ts:48,248,481`, `src/lib/server/auth/onboarding.ts`, and the settings and party implementations. Existing checks cover types/build/import composition but have no formatting or lint command in `package.json` or the workflow.

Impact: review and small edits are harder to reason about, particularly when comparing queue purpose/eligibility, error handling and state transitions. A single typo can be buried in a large expression even when the directory layout is good.

Recommendation: agree one formatting convention, format the actively changing feature files without mixing behavior changes into that commit, and add a check if desired. Extract a named decision only when it has a concrete shared responsibility; do not split files just to meet a size target. No formatter dependency is required by this audit.

Verification: formatting-only diff, ordinary checks, and unchanged feature regression results. Priority is maintenance after behavior defects, not a blocker by itself.

### STRUCT-02 — P3: Reader implementations import their own dispatcher for a shared helper

`src/lib/reading/reader/engine.ts:5-14` contains cancellation helper `readerLoad` and the lazy dispatcher. `pdf.ts:3-4` and `epub.ts:4-5` import that dispatcher at runtime just for the helper; the dispatcher dynamically imports them back. These are real runtime edges, unlike their type-only `ReaderEngine` imports.

Impact: lower-level engines depend on format selection and all engine module edges. This makes focused renderer tooling harder to isolate and unnecessarily expands the dependency group. No eager loading, production failure or unsafe initialization is claimed from the graph alone.

Recommendation: move only the reusable cancellation helper into a small adjacent pure module; keep contracts and the existing lazy selection behavior. Retain type-only imports for engine contracts.

Verification: selected-format lazy chunk checks, close/abort reader tests and no dispatcher runtime import from an engine. Reuse existing reader acceptance fixtures.

## Unverified and handoffs

No live browser, real provider, native player or database execution is part of this structural check. Dedicated reviewers cover feature correctness and verification gaps. Empty untracked directories, generated migration snapshots, historical audit path names and deliberately retained external URLs were not counted as defects solely because their names differ from current source modules. The aggregate audit will prioritize and merge corroborated feature findings.
