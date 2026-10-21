# Dependency update inventory — 21 October 2026

**Subsequent work:** the user requested stable updates. See [adoption, compatibility boundaries and verification](../2026-10-21-stable-dependencies.md); this table preserves the pre-upgrade inventory.

Checked every direct production/development dependency against its **resolved lockfile version** and the official npm registry. This is an availability inventory, not an adoption or compatibility result. Bun is the only runtime selected for an upgrade in this pass. Transitive advisories and operating-system packages are outside this inventory.

## Stable and preview options

| Dependency | Locked | Latest stable | Newer preview |
| --- | --- | --- | --- |
| [@hugeicons/core-free-icons](https://www.npmjs.com/package/@hugeicons/core-free-icons) | 4.3.5 | 4.3.5 | — |
| [@hugeicons/svelte](https://www.npmjs.com/package/@hugeicons/svelte) | 1.1.5 | 1.1.5 | — |
| [@zip.js/zip.js](https://www.npmjs.com/package/@zip.js/zip.js) | 2.23.0 | 2.24.0 | — |
| [drizzle-orm](https://www.npmjs.com/package/drizzle-orm) | 0.45.3 | 0.45.4 | 1.0.0-rc.4 |
| [epubjs](https://www.npmjs.com/package/epubjs) | 0.3.93 | 0.3.93 | 0.5.0-alpha.3 |
| [hls.js](https://www.npmjs.com/package/hls.js) | 1.7.3 | 1.7.3 | 1.7.4-0.canary.12067 |
| [libarchive-wasm](https://www.npmjs.com/package/libarchive-wasm) | 1.2.0 | 1.2.0 | — |
| [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist) | 6.4.299 | 6.4.299 | — |
| [sharp](https://www.npmjs.com/package/sharp) | 0.35.5 | 0.35.5 | — |
| [three](https://www.npmjs.com/package/three) | 0.186.1 | 0.186.1 | — |
| [valibot](https://www.npmjs.com/package/valibot) | 1.5.0 | 1.5.0 | — |
| [@playwright/test](https://www.npmjs.com/package/@playwright/test) | 1.63.0 | 1.64.1 | 1.65.0-alpha-2026-10-21 |
| [@sveltejs/kit](https://www.npmjs.com/package/@sveltejs/kit) | 2.70.3 | 3.1.0 | — |
| [@sveltejs/vite-plugin-svelte](https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte) | 7.3.1 | 7.3.1 | — |
| [@tailwindcss/vite](https://www.npmjs.com/package/@tailwindcss/vite) | 4.3.3 | 4.3.3 | — |
| [@types/bun](https://www.npmjs.com/package/@types/bun) | 1.4.2 | 1.4.3 | — |
| [@types/three](https://www.npmjs.com/package/@types/three) | 0.186.0 | 0.186.0 | — |
| [drizzle-kit](https://www.npmjs.com/package/drizzle-kit) | 0.31.11 | 0.31.11 | 1.0.0-rc.4 |
| [svelte](https://www.npmjs.com/package/svelte) | 5.57.1 | 5.57.2 | — |
| [svelte-adapter-bun](https://www.npmjs.com/package/svelte-adapter-bun) | 1.0.1 | 1.0.2 | — |
| [svelte-check](https://www.npmjs.com/package/svelte-check) | 4.7.6 | 4.7.7 | — |
| [tailwindcss](https://www.npmjs.com/package/tailwindcss) | 4.3.3 | 4.3.3 | — |
| [typescript](https://www.npmjs.com/package/typescript) | 5.9.3 | 7.0.2 | 7.1.0-beta; 7.1.0-dev.20261021.1 |
| [vite](https://www.npmjs.com/package/vite) | 8.3.1 | 8.3.5 | — |

Ten direct dependencies have newer stable releases; fourteen are already current. Previews are listed only when newer than the installed stable version. Old `next`, `beta` and `rc` tags are retained in the [registry receipt](dependency-updates.json), but are not recommendations.

## Upgrade boundaries

- **SvelteKit 3.1.0** is a major migration. The current 2.x latest remains **2.70.3**, which Coast intentionally pins with its maintained navigation patch and drift check. Upgrading requires reviewing/removing or reworking that patch and repeating navigation acceptance; do not run an indiscriminate update.
- **TypeScript 7.0.2** is a major jump from 5.9.3. The latest 5.x remains 5.9.3; 6.0.3 is an intermediate stable option. Compiler and Svelte tooling compatibility need validation together.
- **Drizzle ORM 0.45.4** is a stable patch option; **ORM/Kit 1.0.0-rc.4** is a coordinated prerelease migration, not a drop-in production recommendation. Preserve native Bun SQL binding, migrations, transaction and advisory-lock acceptance.
- **zip.js 2.24.0**, **adapter 1.0.2**, **Svelte 5.57.2**, **Vite 8.3.5**, **svelte-check 4.7.7**, **Bun types 1.4.3** and **Playwright 1.64.1** are the smaller stable candidates. Test archive/reader behavior, production startup/build, navigation and tooling as applicable before adopting.
- **epubjs 0.5 alpha**, **HLS canary**, **Playwright alpha** and **TypeScript beta/nightly** are optional experiments. No verified performance gain or required bug fix is claimed from their version numbers.

## Bun selection

Latest stable is **1.4.3**. The official multi-platform Debian image selected for the requested bump is **1.4.4-canary.1+6bb5dc195**, pinned by digest in Dockerfile and CI. A newer GitHub artifact, **1.4.4-canary.1+963452075**, is also available and was the earlier actual-data research target. Both contain the 17 October upstream SQL repair; do not conflate their acceptance receipts. npm’s canary tag lags at **1.4.3-canary.20261019.1**. No stable 1.4.4 or later stable release was available when checked.

[Official stable release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3), [official canary channel](https://github.com/oven-sh/bun/releases/tag/canary), [selected source revision](https://github.com/oven-sh/bun/commit/6bb5dc1956505dd1113455f58d4757c924f3ad54), [newer artifact source](https://github.com/oven-sh/bun/commit/963452075e9d7e2a47a482f297143af5ed4f76c0). See [runtime adoption](runtime-adoption.md) for the immutable image, checks and remaining limits.

Registry timestamp, all original tags, latest engines/peer constraints and deprecation fields are retained in [dependency-updates.json](dependency-updates.json).
