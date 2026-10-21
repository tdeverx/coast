# Stable dependency updates — 21 October 2026

Scope: update existing packages to stable release lines, preserve the selected Bun canary, retain application behavior, and verify before adoption. The user subsequently authorized pushing and merging this verified group first, then continuing the full framework migration. Running-installation deployment remains separate.

## Independent stable updates

The first group updates zip.js 2.24.0, Drizzle ORM 0.45.4, Playwright 1.64.1, Bun types 1.4.3, Svelte 5.57.2, the existing Bun adapter 1.0.2, svelte-check 4.7.7 and Vite 8.3.5. Manifest minimums also align with already installed stable packages. Other direct packages already match their latest stable release. The new old-adapter release is deprecated in favor of the official adapter; do not mistake that patch for SvelteKit 3 support. Verification passes as recorded below.

## Concrete framework migration option

The official `sv@1.1.1 migrate sveltekit-3 --tasks all --no-install` was run against a temporary source-only copy, not the normal checkout. It changes 444 actual source/config files, mainly the required `$lib` → `#lib` imports. It also moves Svelte configuration to Vite, changes tsconfig ownership, adjusts shallow routing, and produces a manual review checklist. The automatic output is not an adopted or verified implementation.

To adopt **SvelteKit 3.1.0**:

1. Replace the deprecated `svelte-adapter-bun` with the stable official `@sveltejs/adapter-bun@1.0.0`. Review generated startup/shutdown, streaming/body limits, proxy/host trust and runtime diagnostic compatibility; preserve the existing container supervisor contract.
2. Use **TypeScript 6.0.3**, the newest stable compiler API compatible with Kit and svelte-check. TypeScript 7.0.2 is stable but does not expose the compiler API required by our inventory/style scripts and Svelte checker. Do not introduce parallel compiler aliases just to claim a version bump.
3. Review the generated configuration/import/routing migration and manual tasks. Preserve error/status handling, external auth redirects, stateful media panels, scroll/focus behavior, authenticated routes and API response contracts.
4. Rework the existing reviewed navigation patch and its build drift check for the changed Kit 3 owners. The installed-source 21-schedule harness depends on Kit 2 function boundaries; neither unmodified tests nor an unreviewed patch can certify Kit 3. Keep animation behavior unchanged and verify new shallow navigation/refresh semantics.
5. Run type, inventory, meaningful regression/native-reader and actual-data database checks, final container lifecycle acceptance and authenticated browser route/detail/Back/refresh checks. Apply the candidate only after these pass.

This introduces significant migration/maintenance work beyond the independent stable updates. The user's supplied AGENTS.md says “Ask before introducing unavoidable complexity”; the user approved this larger option on 21 October, with the verified independent group to be pushed and merged first. Kit 2.70.3/TypeScript 5.9.3 remain in this first pull request; the full migration follows separately.

Sources: [SvelteKit migration guide](https://svelte.dev/docs/kit/migrating-to-sveltekit-3), [official stable Bun adapter](https://svelte.dev/docs/kit/adapter-bun), [TypeScript 7 compiler API limitations](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0). Registry peer contracts were checked for every direct dependency.

## Independent stable-group verification

- Maintained installed-source navigation repair: all **21 schedules pass**, with the original version/source/patch drift guard intact.
- Source/UI inventories and style pass. Svelte checks: **zero errors and warnings**. Unit/native-reader tests: **895 pass, 718 guarded skips, zero failures**. Production build passes, including the native extractor.
- Selected Bun image (`6bb5dc195`), current Drizzle **0.45.4**, PostgreSQL **17.11**, disposable approved real catalogue: native JSON, typed arrays, full row equality, rollback, advisory reservations, cache cap/type reuse, 80 concurrent projections and cancelled queries pass. All five complete media/metadata hash results match the **0.45.3** receipt from the preceding runtime acceptance. Eight real batch cycles remain bounded. This is correctness/regression acceptance, not a claim of a newly measured speed gain.
- Actual reading acceptance: **39 checks**, six original archives (five CBR, one CBZ), **400 pages / 713,291,482 archive bytes**. Every naturally ordered page matches its original bytes. Concurrent readers share acquisition, independent closing preserves another reader, and warm reopening reuses the cache. The 401,719,147-byte CBZ exercises the upgraded zip.js path. CB7/CBT and PDF/EPUB are not added to this actual-file corpus.
- Final Linux ARM64 production image builds with frozen dependencies, starts with a fresh bundled database and returns health **200** using the unchanged pinned Bun canary. No image is published or deployed.
- Signed-in normal dev, **http://localhost:5173**, desktop **1280×720**: For You → Library → existing title detail panel → browser Back. Populated routes and panel render, Back closes the panel/restores Library, and captured console error/warning lists are empty. No framework overlay/blank-page result is observed. The initial cover interaction reached playback; the subsequent title-text link was used for the detail/Back assertion, and that initial heading wait is not counted as a passing assertion. No library/history cleanup is attempted. Wider browsers/mobile and a fresh production-install authenticated journey remain unchecked.
- Browser tooling: Browser plugin/skill absent. Playwright CLI's default Chrome launch failed because Chrome is not installed; the existing in-app browser's supported Playwright surface was then used, preserving the already signed-in session. No new browser/account was installed or created. Screenshot: `/tmp/coast-stable-detail-20261021.png` (temporary local evidence).
- The actual-data disposable database, checkpoint copy and isolated SQL process were deleted. The original private checkpoint remains intact. The value-free SQL and archive verification receipts are retained in [stable-dependencies-verification.json](2026-10-21-live-freeze/stable-dependencies-verification.json); the private source checkpoint and documents are excluded. Maintained harnesses remain in the original audit/scripts.

The lockfile still contains upstream transitive **`@polka/url@1.0.0-next.29`**, required by stable `sirv@3.0.2` (`^1.0.0-next.24`). Its stable tag is **0.5.0**, outside that required range. No forced incompatible override is introduced to disguise this upstream exception. Every direct dependency is on a stable release except the explicitly retained Bun canary; Kit and TypeScript remain on their current compatible stable lines in this first group.

## Approved sequence

The user explicitly approved the full SvelteKit 3 migration and requested pushing/merging the verified current work first. The framework migration remains a temporary candidate in this first group and has not changed application source, the navigation patch, configuration or adapter ownership. Continue it after this group merges; no further scope approval is required for the documented migration.
