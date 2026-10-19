# Physical reader integration — 19 October 2026

The physical binding and gestures are now owned by Coast's reading feature. The lab remains an independent local-only host using that shared presentation. Its server/authentication, shelf, local resume and tuning controls are absent from Coast's reader path. The lab and source checkpoints under `experiments/comic-lab-checkpoints/` are ignored by Git and excluded from container builds.

## Automated checks

- `bun run check`: zero errors and warnings.
- `bun test ./tests`: 853 passed, 716 guarded skips, zero failures. The skipped database suites were not run against the live database.
- All 123 lab regressions pass, including its isolated localhost Jellyfin proxy test and background-prefetch admission.
- Production build, source style, code inventory, UI inventory and whitespace checks pass.
- The production manifest keeps the physical renderer outside static route entry imports. Reader loads the format engine dynamically; EPUB and the physical reader are separate branches, and PDF.js/native archive workers load for their formats.

The adapter tests cover original archive page identities after splitting, saved entry, stable publication, controller/follower restrictions, serial/superseded party navigation, cascade admission/settlement, cancellation, late GPU setup disposal and dismissal ownership. Reader tests cover replacement/minimization races, preview isolation and locations arriving during initial load. Source tests exercise real ZIP extraction with controlled image decoding, native archive worker termination/retry, odd PDF padding without lost pages, failed raster retry and decoder cancellation. Existing real RAR/7z/TAR decoder regressions remain active.

## Rendered observations

Browser plugin not available; UI checks used the desktop computer-use browser controls in the existing in-app browser. The flow was Coast Library → Read Journey To Love → closed focused entrance → open saved spread → three rapid right-arrow turns → single-page focus and drag between sides → Show app → Resume reading → close. The starting page 8 bookmark was restored after checking page 14/15. No console warnings/errors appeared in the checked tab. Canvas count returned to zero on minimize and close, and navigation remained accessible above the model.

The final live pass verified the dimmed app backdrop and outside-click dismissal while preserving outside-drag rotation. After the save/close completed, the reader host and canvas count were both zero. The scrim and surface remain below navigation/media layers. The lab was rebuilt after moving its shared imports and applying the 10° open tilt.

## Limits of this evidence

The initial integration pass verifies presentation and structural lifetime/budgets, without a measured browser heap plateau or device frame-rate benchmark. Its live browser journey used an actual linked server CBZ; PDF and the other archive formats have source/decoder tests, rather than a new actual-file browser journey for each format. EPUB retains its existing text/CFI presentation. Party contracts and navigation races are covered by tests; a new simultaneous two-account live party was not created during this pass. No API, session, bookmark schema or server-party protocol was changed. The later loading comparison below records its separate measurement boundary.

## Comic loading follow-up

The reported delay was primarily opening and turning pages. In the signed-in development app at `http://192.168.0.18:5173`, the same linked CBZ had 23 scans, 24 normalized faces and 28,511,070 compressed bytes. Temporary probes measured archive open through completed scan inspection; session preparation, model setup and entrance animation were outside that timer. They recorded request count/body bytes separately. The baseline used remote ZIP ranges; the replacement uses one bounded blob download. No GPU quality, animation timing, geometry, permissions or party contracts changed.

| Observation | Remote ranges | Local blob |
| --- | --- | --- |
| Download + scan inspection | 12,325 ms (one observation) | 3,457 / 3,073 ms (two subsequent opens) |
| File requests through initial inspection | 49 | 1 |
| File requests through settled entry/preload | 85 | 1 |
| Response-body bytes through settled entry/preload | 52,358,852 | 28,511,070 |
| Additional file requests opening saved spread 14 then turning to 16 | 4 | 0 |

The local blob downloads took 2,940 / 2,528 ms, included in their inspection totals. Scan identities, face count and original page numbering matched; the live turn reached page 16 and returned to page 14. There were no console warnings/errors in the checked tab. Raw numerical observations were saved outside the repository in `/tmp/coast-comic-range-baseline.json`, `/tmp/coast-comic-range-baseline-with-turn.json`, `/tmp/coast-comic-local-after.json` and `/tmp/coast-comic-local-after-with-turn.json`; these contain no session URLs or credentials. Temporary probes were removed after measurement.

These are sequential development-browser observations on one actual file and one provider connection, without alternating trials or controlled cold caches. They establish avoided request work and the observed wait, not production p95, frame-rate improvements or a heap plateau. The cost is retaining one compressed archive up to the shared 128 MiB input cap; all comic formats now enforce that cap, including remote CBZ. Slow links and near-limit archives remain unmeasured. PDF and EPUB loading are unchanged. Meaningful regressions cover one fetch across repeated forward/backward ZIP reads, declared/actual input bounds, aborted streams and original local bytes, alongside the existing native decoder, reader lifetime and party-navigation tests.

Follow-up gates: 857 app tests passed, 716 guarded skips, zero failures; type checking had zero errors/warnings; production build, 33-module source style, code inventory, UI inventory and whitespace checks passed. The final clean-source browser flow used the in-app browser at 1280×720: Library → Read → saved page 14 → page 16 → page 14 → close. The Browser plugin was unavailable; desktop computer-use controls provided the browser interaction and screenshot evidence. No framework error overlay or console warnings/errors appeared. Mobile, near-limit files and simultaneous live party clients were not newly exercised by this loading change.
