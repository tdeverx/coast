# Music, gaming and shared provider contracts audit

Date: 2026-10-15. Current working tree reviewed; no application files were changed.

## Scope and method

Reviewed music persistence, browsing, queues, manual listen accounting, artist credits and detail routes; game tracking, game identities and variants; Steam account linking, ownership snapshots, achievements and direct live-status callers; IGDB mapping, metadata fetching and refresh; shared provider capabilities, job purposes and task eligibility. Followed direct route/presenter/schema/test callers instead of comparing only committed code.

This was read-only application inspection with injected-transport/pure tests. No database, credentials, live provider, browser or running service was accessed. The JSON companion contains the exact read-versus-scanned file inventory, commands and reproduction details. Database-backed effects below are strong static findings unless explicitly labelled otherwise; no live-provider certification is implied.

## Coverage and healthy patterns

- Substantively read all modules under `src/lib/music`, `src/lib/games`, `src/lib/providers/steam`, `src/lib/providers/igdb`, `src/lib/core/games`; provider contracts/capabilities/tasks/job policy and task timing; Jellyfin music mapping/paging; music and game route loaders/details; shared music page/actions; music/media-row read models; game API handlers; direct provider-live and taste-feature callers.
- Read `docs/code-organization.md`, `docs/architecture.md`, `docs/performance.md`, `docs/music.md`, and relevant experimental-feature behavior. Scanned schema sections, music sync and delivery, global feature/auth dispatch, ConnectionCard controls, Shelf keys and associated DB fixtures. Full paths are enumerated in JSON.
- Steam OpenID pins issuer, callback, identity, signed fields, nonce age and one-use challenge evidence. Keys stay server-side. Account-generation and lease checks fence ownership/achievement publication.
- Complete Steam ownership responses are validated before removals. Large owned-game responses use durable snapshots, bounded committed chunks and cooperative checkpoints. Ownership remains distinct from installation, dated play sessions and game completion.
- Achievement work retains exact selected AppIDs across yields, bounds runs to 20 entries and preserves prior progress on individual privacy failures. The alias-scope problem below is separate from those healthy controls.
- IGDB token acquisition is single-flight, expiry-bounded and retries a rejected token once; normal queries use the common request transport rather than an adapter-private queue.
- Game session retries use caller UUIDs and enforce owner scope, even after later completion. Status and explicit percentage intentionally remain independent (the existing tests assert this); no issue was inferred merely from that choice.
- Music snapshots exclude account state. Personal listen batches lock per user, freeze the logged tracks and deduplicate retries. Queues preserve explicit list repeats. The occurrence problem below concerns canonical album membership before that queue expansion.
- Music/Gaming route gates, provider task gates and category capability distinctions are present. Artwork checks the authenticated source and music item type before relay.
- No duplicated-method finding was retained based solely on file size or parallel provider implementations.

## Verification

```sh
PATH="$PWD/.tools/bun-darwin-aarch64:$PATH" bun test tests/igdb.test.ts tests/steam.test.ts tests/games.test.ts tests/jellyfin-music.test.ts tests/music-presentation.test.ts tests/provider-contracts.test.ts tests/task-timing.test.ts
```

**73 passed, 0 failed, 357 assertions.** These are pure/injected-provider tests; database suites were read but not run.

A harmless `bun -e` injected-transport reproduction confirmed:

1. One compact upstream Jellyfin item looked up through compact and uppercase/hyphenated inputs returns two different raw item IDs.
2. Two source cards sharing a canonical music work produce two cards but only one unique renderer `href` key.
3. One mapped IGDB game accepts both verified Steam AppIDs 10 and 20.

The second observation confirms the key collision itself; actual Svelte browser behavior was not exercised.

## Prioritized findings

### MEDIUM-01 — P2: Album membership loses track occurrences and mixes release editions

Confidence: **strong-static**. Root cause: `album-membership-is-work-pair-instead-of-edition-occurrence`.

Persist two releases with the same release-group ID but different tracklists/order, or one album with the same recording UUID at two positions. Then open, queue or manually log the album.

The last observed occurrence wins ordering, repeated recording occurrences disappear, and standard/deluxe releases become a union that may match no real album. Logging an ordinary edition also logs bonus tracks learned from another edition/server, changing personal playcounts and downstream history.

Evidence:

- `src/lib/music/persistence.server.ts:27` — Albums merge on MusicBrainz release-group and tracks on recording identity.
- `src/lib/music/persistence.server.ts:41` — Distinct work editions are stored, but their membership is not retained there.
- `src/lib/music/persistence.server.ts:47` — Every provider occurrence upserts one parent/child/kind relationship and overwrites its position.
- `src/lib/server/db/schema.ts:244` — The relationship primary key cannot represent the same recording at multiple album positions.
- `src/lib/music/queue.server.ts:8` — Album playback expands the global work relationship set, without selecting a release edition.
- `src/lib/music/persistence.server.ts:117` — Album logging uses the same global membership set, so edition-only tracks become user listens.

Minimal correction: Retain ordered membership with an edition/occurrence identity beside the existing workEditions boundary; derive canonical browse/queue/logging from one explicit deterministic edition rather than unioning every release. Preserve shared recording activity and batch retry safety.

Verification: Disposable fixture: persist two album provider IDs with one release-group UUID, one track shared at different positions and a deluxe-only recording. Assert a selected standard queue/log excludes the bonus recording and retains its own order. Add a second occurrence of one recording and assert it remains a distinct queue entry without duplicate retry effects.

### MEDIUM-02 — P2: Equivalent Jellyfin GUID spellings become separate music identities

Confidence: **strong-static**. Root cause: `music-persistence-keys-unnormalized-jellyfin-guid`.

Browse a track/album whose Jellyfin ID is compact lowercase, then request the same item through the documented hyphenated or uppercase GUID form. The item lacks a verified MusicBrainz recording/release-group ID.

One provider item acquires two canonical works, separate progress/favourites/listens, duplicate availability and potentially split album membership. With a shared MusicBrainz ID it still creates duplicate provider mappings/editions. The injected adapter reproduction confirms different returned identity strings; DB effects follow statically from raw lookup keys.

Evidence:

- `src/lib/providers/jellyfin/paging.ts:2` — The existing canonical comparison key removes hyphens and lowercases Jellyfin GUIDs.
- `src/lib/providers/jellyfin/music.server.ts:173` — Single lookup accepts an equivalent upstream GUID through normalized validation.
- `src/lib/providers/jellyfin/music.server.ts:174` — It then overwrites the upstream ID with the raw caller-supplied spelling.
- `src/lib/music/persistence.server.ts:26` — Lock and provider mapping lookup use the raw item.id; without a verified MusicBrainz ID a new work UUID is allocated.
- `src/lib/music/persistence.server.ts:40` — Provider items and work editions also retain raw GUID spellings as distinct unique keys.

Minimal correction: Normalize Jellyfin music IDs, parent IDs and artist IDs consistently at the provider/persistence boundary using the existing jellyfinItemKey helper. Resolve any previously stored equivalent spelling before allocation; preserve existing work UUIDs rather than manufacturing a new mapping.

Verification: Pure adapter regression: compact and uppercase/hyphenated lookups for one upstream GUID return the same normalized ID. Disposable DB regression: persist/browse all accepted spellings without MusicBrainz IDs and assert one work, provider item, edition and personal progress identity.

### MEDIUM-03 — P2: Merged music copies collide with keyed card renderers

Confidence: **confirmed**. Root cause: `canonical-music-href-used-as-provider-copy-render-key`.

Two editions/copies on one or several connected Jellyfin libraries resolve to the same verified MusicBrainz work and appear on the same music page/row.

The read model sends duplicate keys to Svelte keyed each blocks; development raises a duplicate-key error and production keyed updates cannot reliably preserve the separate cards. This affects supported canonical merging, not just random identical server IDs.

Evidence:

- `src/lib/music/presentation.ts:31` — Different source items sharing workId get exactly the same canonical href.
- `src/lib/server/queries/music.ts:65` — The browse read model concatenates all provider copies without assigning entry identities or collapsing works.
- `src/lib/server/queries/media-rows.ts:40` — Home/presentation music rows likewise concatenate copies.
- `src/routes/music/+page.svelte:67` — Music grid keys its each block by item.href.
- `src/lib/ui/components/Shelf.svelte:102` — Shared shelves default to item.entryId or href.

Minimal correction: Preserve current source-copy presentation by giving each result an existing-style entryId scoped to connection and provider item, and use that entryId on the standalone grid as Shelf already supports. If the product instead wants one work card, collapse it in the bounded read model and keep count/pagination semantics explicit.

Verification: Pure reproduction already yields 2 cards and only 1 href key. Add a presenter/read-model case with two sources and one workId, then render both the Music grid and a Shelf in a disposable UI fixture; assert unique keys and correct source actions after reorder/refresh.

### MEDIUM-04 — P2: Steam AppID aliases overwrite account playtime and achievement state

Confidence: **strong-static**. Root cause: `steam-observations-keyed-by-canonical-game-instead-of-appid`.

An IGDB mapping with two Steam aliases is imported before ownership, then an account owns both AppIDs. Return different playtime/stat availability or same-named achievement API keys for those two apps.

The final owned-game response order determines displayed totals and hasStats. Reordering an otherwise identical complete response can change minutes or suppress achievement polling. Achievement schemas/progress from separate apps are also combined or overwritten instead of retained as exact provider observations.

Evidence:

- `src/lib/providers/igdb/adapter.server.ts:46` — One IGDB work can carry multiple verified Steam store AppIDs; pure mapping reproduction accepts both 10 and 20.
- `src/lib/providers/steam/sync.server.ts:63` — Each owned AppID resolves to its canonical game and overwrites account/game minutes, hasStats and recent playtime.
- `src/lib/server/db/schema.ts:1282` — game_account_state has only an account/game key, omitting the exact Steam AppID.
- `src/lib/providers/steam/sync.server.ts:140` — Achievement traversal selects exact owned AppIDs but may select several for the same game state.
- `src/lib/providers/steam/sync.server.ts:156` — Schema cache lookup uses gameId/provider, so one AppID can reuse another AppID's achievement definitions.
- `src/lib/providers/steam/sync.server.ts:162` — Definition identity omits AppID; progress upserts then overwrite a shared definition's account state.

Minimal correction: Retain exact AppID on Steam account observations and achievement identities, then deliberately project those observations to the canonical game display. Do not infer which AppID's totals or schema are authoritative from provider response order; keep existing no-fabricated-session behavior.

Verification: Disposable fixture: import one IGDB game with Steam IDs 10/20, return owned totals 100/30 with different hasStats values in both orders, and assert equal deliberate aggregate/projected results plus exact observation preservation. Give both apps an achievement named FIRST with different state/schema and assert independent account progress.

### MEDIUM-05 — P3: Normal canonical music links discard stored artist navigation

Confidence: **strong-static**. Root cause: `canonical-music-detail-does-not-hydrate-credit-roles`.

Browse an album/track with valid artist credits and follow its ordinary musicCard link after musicLibrary persists it.

Provider detail routes preserve album-artist versus performer navigation, but the default canonical detail path always drops it. An album with only album-artist credits may also lose its visible subtitle because persistence falls back to performing artists, not album artists.

Evidence:

- `src/lib/music/persistence.server.ts:42` — Artist and album-artist credits are persisted with separate roles and instance-scoped artist identities.
- `src/lib/music/presentation.ts:31` — Persisted album/track cards route users to the canonical music page.
- `src/routes/music/work/[id]/+page.server.ts:15` — Canonical toItem explicitly returns artists:[] and albumArtists:[] without reading persisted credits.
- `src/routes/music/work/[id]/+page.server.ts:24` — The route supplies connectionId:'' to the shared presenter.
- `src/lib/ui/pages/music.svelte.ts:20` — Artist links are built only from those role-specific artist arrays, so canonical pages lose all artist destinations.

Minimal correction: Hydrate persisted role-specific music credits in the canonical read model and map navigable artist links through the viewer's enabled owned connection for that artist instance. Preserve plain credit text when no permitted source exists, using the established shared presenter and interface.

Verification: Disposable loader fixture: persist an album with only albumArtists and a track with distinct performers, follow musicCard.href, and assert expected subtitle/credit roles and authorised artist links. Disconnect the source and assert credit text remains without generating /music/work/{providerArtistId} links.

### MEDIUM-06 — P3: Removing an IGDB parent does not remove the old verified variant link

Confidence: **strong-static**. Root cause: `game-variant-refresh-only-upserts-positive-parent`.

Use the game's explicit Refresh metadata action (games/import -> igdbDetails) after importing a verified parent, and return a successful full expanded IGDB response for that identity with the parent relation removed.

The local game indefinitely borrows artwork/overview and taste features from a parent that the current provider response no longer verifies. A successful refresh cannot return the game to independent presentation.

Evidence:

- `src/lib/providers/igdb/adapter.server.ts:153` — Explicit details refresh requests the expanded fields including parent_game/version_parent; this finding concerns a successful full response, not an incremental observation.
- `src/lib/providers/igdb/adapter.server.ts:70` — A current parsed response without parent_game/version_parent maps parent to undefined.
- `src/lib/core/games/service.server.ts:194` — Import upserts a variant only when a parent exists; no corresponding deletion handles an authoritative parent removal.
- `src/lib/core/games/service.server.ts:204` — Presentation continues borrowing the old parent's fields from the surviving row.
- `src/lib/social/work-features.server.ts:10` — Taste metadata also keeps selecting features from that surviving parent row.

Minimal correction: Within the same metadata import transaction, remove the existing variant relation owned by this provider when the authoritative full response has no distinct parent. Keep the game UUID, Steam ownership and private tracking intact.

Verification: Extend the existing verified variant DB fixture: import child+parent, reimport the same child with no parent, assert the variant row disappears and gameDetails/workTasteFeatures use the child's own metadata; also test changing to a different verified parent.

## Uncertainties and boundaries

- The first four findings survive the existing pure tests because their compound cases are absent: multiple album editions/occurrences, equivalent music GUID spellings, multiple source cards with one work identity, and multiple *owned* Steam aliases. Existing tests do cover an unowned Steam alias and ordinary playlist repeats.
- MEDIUM-06 concerns an explicit successful full IGDB details refresh with expanded parent fields. Incremental/failed provider reads must retain old evidence. If the intended contract deliberately treats even a successful full parent omission as unknown, document that retention policy instead of applying the deletion recommendation.
- DB fixtures are required to verify the exact collision, transaction and ordering effects; production data was not inspected to estimate prevalence. Browser checks are needed for the actual duplicate-key presentation failure.
- Live OpenID/provider compatibility, all queue infrastructure, playback traversal accounting, public API grants and complete social/privacy paths were outside runtime validation here. Direct boundaries were inspected; owning audit sections cover their internals.
- Previously reported DISCOVERY-01, JELLYFIN-02, SOCIAL-04 and PLAYBACK-03 are excluded. JELLYFIN-02 concerns multiple remote copies overwriting one canonical personal value during reconciliation. MEDIUM-01 concerns the structural edition/occurrence membership set; MEDIUM-02 identity allocation; MEDIUM-03 renderer entry keys. These remain distinct roots.
- Canonical music route data loading is embedded in a route despite documentation preferring read-model modules. That placement is not a separate finding: concrete credit hydration drift is captured in MEDIUM-05.

## Minimal ordered recommendations

1. Normalize provider GUID identity and preserve unique card entry keys using existing helpers/contracts. These are narrow fixes with small regression fixtures.
2. Define the existing canonical-work versus edition/occurrence projection precisely, then preserve the exact album traversal used by queues/logging. Keep recording-level activity and retry identities; do not redesign the approved interface.
3. Preserve exact Steam AppID observations before deriving canonical game totals/achievements. Add reversed-response-order and dual-owned-alias DB cases.
4. Hydrate canonical music credits through the established presenter; reconcile a removed verified game parent only on authoritative full metadata refresh.
5. Run the proposed disposable DB and targeted browser cases; retain current account fencing, bounded provider transport and complete-scan removal rules.
