# Physical reader rendering — 21 October 2026

The physical reader now avoids duplicate animation renders, reuses unchanged binding geometry and shadows, merges adjacent groups sharing a material, and bounds optional page-texture residency. Printed faces retain their original resolution and geometry. The approved interface is unchanged.

Reader startup uses the existing indeterminate indicator with a generic “Loading…” label, without byte totals, percentages or page counts. A normal-dev browser check using an actual comic verified 1280×800 and 390×844 layouts, reduced motion, readiness and Escape cancellation, with unchanged saved progress/history. Type checking passed; the only browser console errors were existing remote artwork CORS failures.

## Resource and correctness contracts

- Position and normal buffers use dynamic usage; static UVs and vertex colours remain unchanged between equivalent poses. Indexed normal accumulation preserves Three.js results.
- Hidden binding meshes deform before becoming visible. Material groups retain the printed-face indices used by picking.
- Shadow regeneration follows book, caster, light and light-target transforms, caster visibility and geometry versions. Camera-only changes reuse the shadow map.
- The 192 MiB RGBA8 mip-chain target applies to speculation. Current, loading and turning faces, cascade source/target faces and covers stay pinned even above that target. This is not a hard GPU-memory ceiling.
- Required and speculative callers share decoding. After decoding, optional callers recheck current demand and actual dimensions before creating or uploading a texture. Required callers remain eligible. Failed uploads dispose their texture and permit retry; disposal prevents late uploads.

## Recorded evidence

Baseline: the tree subsequently merged as `4195f06` in #47, Three.js 0.186.1, local Bun 1.4.4 canary `963452075`, macOS ARM64, Chromium with SwiftShader. Actual downloaded CBR files were identified against the development database and their existing corpus hashes verified. Three comics supplied 24, 34 and 24 faces. No source files, database sessions or reading progress were changed by the probes. The database had no natural book/PDF cohort, so hardback coverage used comic pages as diagnostic input.

| Measurement | Before | After |
| --- | --- | --- |
| Changing-cover draw calls | 61 | 33 |
| Unchanged-spread draw calls, comic / hardback | 61 / 61 | 21 / 20 |
| Binding update median, comic opening | 9.2–9.8 ms | 5.0–5.2 ms |
| Binding update median, comic cascade | 7.6–7.9 ms | 3.3–3.4 ms |

Four matched screenshots were pixel-identical at desktop DPR 1/2, narrow DPR 2 and diagnostic hardback settings. All four teardown checks removed their canvas and lost the WebGL context; idle readers drew no frames. A further 141 rendered frames matched synchronous forced shadow regeneration byte-for-byte across animation, navigation, lighting, binding changes and reduced motion. Across 400 model poses, visible position, normal, UV and colour attributes matched the original exactly.

Race probes reproduced obsolete speculative uploads and admission based on a smaller cover before the fixes; both produced zero unwanted uploads afterward. Required takeover used one decode and one upload. Pending disposal produced no late uploads. An injected upload failure disposed the failed texture and allowed retry. Actual-size admission used original interior raster bytes with a deliberately smaller diagnostic cover and controlled accounting pressure.

The final local app suite passed 909 tests, skipped 718 guarded tests and failed none. Type checking reported zero errors or warnings; production build, source style and code/UI inventories passed. Eight focused regression tests protect geometry equivalence, visibility, material grouping, texture budgeting, exact rectangular mip tails and preloader admission.

Raw local receipts are retained under `/tmp/coast-three-audit-20261021`, `/tmp/coast-three-implementation-20261021` and `/tmp/coast-three-review-20261021`. The implementation `results.json` was recovered from retained logged measurements after an accidental overwrite; its summary, screenshots and separate correctness receipts remained intact. Private corpus locators are excluded from the repository.

## Limits and follow-up

These timings isolate binding work and exclude provider latency, transfer and the application shell. They are software-renderer measurements, not hardware GPU FPS or physical mobile acceptance. Active textures exceeded the optional target (about 202–204 MiB settled; about 286–288 MiB observed peaks); neither a hard memory bound nor a heap plateau was established. Hardware/mobile checks and a natural book/PDF cohort remain useful follow-up work before making broader performance claims.
