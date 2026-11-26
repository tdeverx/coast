# Contributing to Coast

Contributions are licensed under AGPL-3.0-only, the same licence as Coast. No separate CLA or dual-licensing grant is required. Keep changes scoped, preserve approved interface behaviour, and update the source-of-truth documentation when behaviour changes.

Use the Bun version pinned in `package.json` and install with `bun install --frozen-lockfile`. Run `bun run code:style`, `bun run check`, `bun run test` and `bun run build` before proposing a change. Run type checking and the build sequentially because both generate SvelteKit files. Use disposable databases for integration tests.

Follow the [source organisation guide](docs/code-organization.md) when placing or moving code. Keep domain services, provider adapters, server infrastructure and browser presentation in their owning folders; preserve API paths and stored identifiers during cleanup.

Use the [performance guide](docs/performance.md) before changing queries, caching, provider scheduling or rendering. Reuse the existing bounded loaders, content revisions and request queue; verify result and privacy equivalence as well as timings. Record workload, environment and raw samples for performance claims. Keep the [UI inventory](docs/verification-platform.md) and code inventory valid with `bun run ui:inventory:check` and `bun run code:inventory`. Run database suites through `bun run test:db` with a create-database-capable `TEST_DATABASE_URL`; the runner creates disposable databases.

For UI changes, check both desktop and compact layouts through the normal entry point. Reuse the shared buttons, fields, switches, headings, shelves and material tokens. Update the preview recipe and regenerate the UI inventory when a component owner or import path changes. Record any browser, account or provider states that still need verification. See the [design inventory](docs/design.md).

For actual-data performance work, use an authorised local restore with its own data directory and copied jobs paused. Keep the dump, user records, provider credentials and raw page output outside the repository. Publish aggregates and the exact conditions required to interpret them. See the [performance methods](docs/performance.md#whole-application-baselines-and-comparison-boundaries).
