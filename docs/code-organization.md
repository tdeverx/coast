# Source organisation

Keep code beside the feature that owns it. Share a helper when it has a concrete shared purpose; avoid a general `helpers` folder or a service that owns every domain.

## Finding your way around

| Location | Responsibility |
| --- | --- |
| `src/routes` | Pages, loaders and HTTP entry points. Route-specific UI and fixtures can stay beside their route. |
| `src/lib/application` | Focused workflows spanning domains, such as disconnecting a source with Collection cleanup. |
| `src/lib/core` | Canonical transactional tracking, ratings, lists, profile and title writes. |
| `src/lib/catalogue` | Canonical metadata ingestion, resolution, overrides and provider-backed details/credits. |
| `src/lib/collection` | Personal membership, access, missing demand and managed Collection projection. |
| `src/lib/providers` | Adapter contracts, service instances, linked accounts, provider-specific storage and queue handlers. |
| `src/lib/sync` | Import/export reconciliation, conflicts, removal evidence and transactional outbound intent. |
| `src/lib/playback` | Playback planning, browser controller, authorised server sessions and party synchronisation. |
| `src/lib/media`, `games`, `music`, `reading`, `profile`, `social` | The named feature's contracts, rules, presentation and services. Shared media artwork selection lives in `media/artwork.ts`. |
| `src/lib/recommendations` | Interest evidence, provider suggestion caches, candidate queries and dynamic feed composition. |
| `src/lib/experiments` | Gated planning and media-detail modal exploration. Move graduated features to their owning domain. |
| `src/lib/server` | Database, authentication, security, diagnostics, storage and queue infrastructure; API dispatch and read models have dedicated subfolders. |
| `src/lib/ui/components` | Shared rendered components. Keep this flat for the component viewer and its generated inventory. |
| `src/lib/ui/shelves` | Cancellable client data sources for the shared Shelf renderer. |
| `src/lib/ui/panels` | Browser navigation and URL state for Friends, Notifications and Streams. |
| `src/routes/ui-preview`, `src/lib/ui/charts` | Preview recipes, fictional chart data and unused chart explorations. |
| `tests`, `scripts`, `migrations`, `docs` | Verification, operational tooling, immutable schema history and source-of-truth guidance. |

Small root modules such as `artwork.ts`, `library.ts` and `progress.ts` are shared pure contracts or mappings. A single-file helper does not need its own directory. Give a feature a folder when it has several related responsibilities.

## Naming and boundaries

- Use kebab-case for modules and folders, PascalCase for rendered `.svelte` components, `.svelte.ts` for reactive modules and `.server.ts` for server-only modules outside `src/lib/server`. SvelteKit protects the entire `server` directory.
- Put pure shared contracts in `model.ts` or a specifically named `.ts` module. Browser code must not import server services at runtime. Use `import type` for genuinely type-only dependencies.
- Provider adapters translate remote data and make requests. They do not own canonical writes or cross-domain cleanup. Synchronisation owns reconciliation; `application` owns multi-domain workflows.
- Routes handle routing and compose existing services. Keep provider requests, database writes and reconciliation out of components. UI data sources own cancellation, pagination and content revisions; renderers own presentation.
- Keep preview fixtures separate from production data. Use the injected API/playback contexts rather than replacing global fetch or the real controller.
- Reuse the established UUIDs, account generations, API paths, queue keys and database names. Folder cleanup must not silently change a stored or external contract.

The recommendation endpoints retain their existing `/api/v1/experiments/*` paths. Their implementation is now in `recommendations`; an organisational pass does not rename HTTP contracts.

## Checks when moving code

Update imports, including dynamic imports and tooling/test consumers. Regenerate the UI inventory with `bun run ui:inventory` when component consumers move, then run `bun run ui:inventory:check` and `bun run code:inventory`. Run `bun run check`, relevant existing tests and `bun run build` to catch server/client boundary mistakes. Database tests use disposable databases through `bun run test:db`.

Run SvelteKit type checking and production builds sequentially in the same checkout: both regenerate `.svelte-kit` files, so running them together can corrupt a generated module mid-read. Pure unit tests and isolated database suites can run independently.

Current guides should name the current tree. Dated audits retain their original paths and evidence. Follow the [performance guide](performance.md) when a reorganisation also changes data loading, caching or rendering.

## Boundaries to handle in separate passes

The Settings page, MediaActions, persistent player, Jellyfin synchronisation and database schema remain large. Split them around a concrete responsibility when working on that feature, preserving the approved UI and transactional boundaries; line count alone is not a reason to extract code.

Two runtime dependency loops use deferred imports: sync changes reads the current sync value while reconciliation enqueues changes; the playback controller loads party commands while party playback calls the controller. They are not eager initialisation loops. Breaking them would require changing those coordination boundaries, so this organisational pass leaves their behaviour intact.
