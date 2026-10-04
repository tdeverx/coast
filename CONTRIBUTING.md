# Contributing to Coast

Contributions are licensed under AGPL-3.0-only, the same licence as Coast. No separate CLA or dual-licensing grant is required. Keep changes scoped, preserve approved interface behaviour, and update the source-of-truth documentation when behaviour changes.

Use Bun for installation, tests and builds. Run `bun run check`, `bun test` and `bun run build` before proposing a change. Database integration tests require an isolated PostgreSQL database. Never use a production database for tests.

Use the [performance guide](docs/performance.md) before changing queries, caching, provider scheduling or rendering. Reuse the existing bounded loaders, content revisions and request queue; verify result and privacy equivalence as well as timings. Record workload, environment and raw samples for performance claims. Keep the [UI inventory](docs/verification-platform.md) and code inventory valid with `bun run ui:inventory:check` and `bun run code:inventory`. Run database suites through `bun run test:db` with a create-database-capable `TEST_DATABASE_URL`; the runner creates disposable databases.
