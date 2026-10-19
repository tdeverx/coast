# Shared glass admission and diagnostic storage follow-up

The small shared-owner slices of `UIS-06` and `UPP-03` are implemented. Native glass can retain an unchanged SVG definition while applying every surface style. Diagnostic writes avoid repeated directory creation/permission writes when the directory is already valid, and refuse to append when current segment size cannot be established. Both findings retain broader open measurement/options; this does not close their pixel-work or diagnostic-tail-read concerns.

No dependency, schema, visual redesign, normal database mutation or actual diagnostic-store mutation was introduced. Common check/build passed, and root normal rendered acceptance is recorded below. Exact before/current source and test/probe pins are in [the machine-readable report](implementation-material-diagnostics.json).

## UIS-06: unchanged native filter definitions

`src/lib/ui/materials/glass.ts:259–263` now keeps the current SVG definition only when it is still connected and its effective key is unchanged. The key includes the existing displacement-map geometry/depth key plus actual displacement scale, chromatic dispersion and SVG blur. A changed geometry/filter input rebuilds the same original filter; externally detached definitions are rebuilt.

`applyNativeSurface` (`:218–225`) runs on both retained and rebuilt definitions. It still applies literal backdrop filters, saturation/brightness, the complete material/grain/stroke/shadow variables, variant/class and renderer state. Surface-only changes therefore remain live even when no SVG needs reconstruction. No new early return bypasses these updates. Fallback/reset and destroy clear the definition key. The original supported-engine and user/appearance gates, per-node map cache, CSS fallback, positive-size requirement, shared animation-frame scheduling/watchers and deferred teardown workaround remain intact. In particular, zero-size delivery retains the prior behavior; no DPR/resolution policy was added.

Every existing consumer uses this owner: Header, active MediaCard surfaces, Button surfaces and menus, SegmentedControl, PersistentPlayer, Dialog, Shelf empty badges, MaterialTweaker and ChartGallery. Dialog/badges/gallery explicitly choosing CSS retain that path. Supported native enhancement remains conditional on Blink, preference and positive refraction; this change makes no native-rendering claim for an unsupported browser.

Four new action regressions exercise the actual action/map implementation with controlled DOM, canvas and scheduler boundaries. They verify unchanged updates/resize deliveries keep definition identity and the existing map; every SVG input still rebuilds; all non-SVG surface inputs still update styles/grain; disconnected definitions recover; gate/fallback transitions, shared observers and deferred teardown preserve ownership. These are behavioral resource tests, not browser pixel, paint or actual-data performance evidence.

**Actual browser boundary:** the normal5173 trial admits `original-svg-backdrop` on Header and Account menu. If positive native rendering is available, use actual Header/card/menu surfaces to verify same-key identity and visual styling through updates, resize, fallback/re-enable and close. If the in-app browser does not support the native path, record that gate rather than asserting positive acceptance. Read-only markers are `header nav[aria-label="Primary navigation"]`, `[data-coast-glass-renderer="original-svg-backdrop"]` and `svg[aria-hidden="true"] > filter[id^="coast-liquid-glass-"]`; the native node inline filter references its definition. Map `feImage` geometry and href hashes can be inspected without dumping a PNG data URL. The private key is not exposed. Stable IDs, SVG markup or map URLs alone do not prove DOM object identity because the previous implementation reused the same ID; use an existing retained DOM handle if supported or retain identity as controlled-test-only evidence. No injected browser global/counter or state override is required. Redundant-key frequency and CPU/GPU/frame/heap savings were not measured. Main-thread displacement pixels, resolution policy and cross-surface map sharing remain separate open options from the baseline audit.

## UPP-03: directory setup and authoritative accounting

`DiagnosticStore.prepare` (`src/lib/server/diagnostics/index.ts:32–42`) stats the directory, verifies it is a directory, and repairs mode to `0700` only when needed. An absent directory is created recursively with the same private mode and chmod as before. A regular-file replacement or other inaccessible state fails through the existing best-effort failure counter; later writes remain usable after recovery. Each queued operation resolves its directory once, so pruning/rotation/appending cannot split across changing callback results.

The current segment is still statted **on every write** (`:100–106`). Removing that check would weaken immediate observation of external append/truncate/rotation. Only `ENOENT` means zero bytes; other accounting failures stop that append and increment diagnostic failures, instead of assuming an unknown file has size zero. This is a small recovery/correctness improvement, not a new authoritative byte cache. The four one-MiB segments, seven-day retention, 128 pending admission/drop metrics, best-effort behavior, safe fields and separate runtime-history quota remain unchanged. Existing file-creation mode remains `0600`; no new existing-file mode policy was introduced.

Both store instances use the class: diagnostic events and runtime samples. Hook/API/public errors, provider fetches, jobs/maintenance, Collection, playback/share, reading sync, music queries/imports, configuration and the diagnostic endpoint/viewer all retain the same common owner. The JSON lists every current source reference to these owners. No provider/job-specific logger or UI cache was added.

Four new storage tests use real disposable files for directory/mode removal and replacement, external segment size/truncate/rotation, one-directory operation scope and failure recovery. A source-loaded instance with controlled filesystem boundaries that delegate to real I/O verifies warm call admission and a non-`ENOENT` stat failure: no blind append occurs, and a later write succeeds. Existing redaction, permissions-before-I/O, rotation, retention, overflow/drop and asynchronous-context tests also pass.

## Actual diagnostic-data verification

[Aggregate actual receipt](evidence/implementation-material-diagnostics-actual.json) and [portable guarded probe](probes/material-diagnostics-real.ts) retain **30 checks and ten complete DTO comparisons**. Six actual normal-development segments contained 4,533,132 captured bytes. Their current retained results were **12,640 diagnostic rows and 1,610 runtime rows**. The probe captured fixed segment names read-only, copied bytes into new private disposable directories, and ran exact before/current owners against identical copies. A controlled equal time boundary prevents timestamps/retention cutoffs from creating false output differences. No raw records or correlation IDs were retained in audit output.

For each store, complete current-window output matched, then complete outputs matched after replaying an actual eligible event, replacing the current copy with an actual near-full retained segment, truncating the copy/restoring permissions, and removing/recreating the copy directory. Both near-full actual-byte replacement cases exercised rotation and retained the exact old segment. These external changes were controlled faults on disposable copies, not naturally observed incidents. The original six observed segment byte digests were unchanged at the final check. Temporary copies were removed; database connections, provider calls and writes to actual stores were zero.

Warm actual-row replay counted the owner's filesystem API calls:

| Before | Current |
| --- | --- |
| `mkdir`, `chmod`, segment `stat`, `appendFile` | directory `stat`, segment `stat`, `appendFile` |

That is **four calls to three** in both observed warm-copy cohorts. These wrappers delegated to real filesystem operations; API call counts are not kernel syscall counts or disk-speed measurements. The cold missing-directory path now adds a validation stat, and permission/error/recovery paths differ. No universal latency, CPU, event-rate or disk-throughput gain is claimed. `recent()` still prunes, reads, parses, filters and sorts its bounded tail; viewer refresh cost remains open.

## Verification and remaining acceptance

[Focused tests](evidence/implementation-material-diagnostics-tests.txt): **23 passed / zero failed / 343 assertions** across six files, including eight new behavioral regressions. The data/API and provider/jobs agents independently reviewed the exact two production-source diffs and found no material blocker. This owner did not run a broad build or mutate a database.

Root common gates and native Header/menu functional acceptance passed as recorded below. Pixel equivalence, natural diagnostic failure, sustained event-rate/CPU/GPU/frame/heap improvement and browser diagnostic-viewer cost remain unverified. A stat cannot protect against an external actor changing the segment between that stat and append; this pre-existing concurrent-writer boundary was not replaced with a filesystem locking framework. Any later batching, tail cache or resolution policy needs its own measured demand and meaningful failure/quality tests.

To repeat only the disposable actual diagnostic-copy proof from the repository root:

```sh
COAST_AUDIT_DIAGNOSTIC_COPY=1 .tools/bun-1.4.3/bun-darwin-aarch64/bun docs/audits/2026-10-17-app-performance/probes/material-diagnostics-real.ts "$PWD/docs/audits/2026-10-17-app-performance/evidence/implementation-material-diagnostics-actual.json"
```

The probe pins the baseline source and writes only the aggregate evidence file plus new disposable copies. A repeat captures a new actual byte window and must be retained as a new receipt when provenance matters. Do not silently relabel the original receipt after source/data changes.

## Root current-source normal acceptance

The [normal5173 frozen-source receipt](evidence/implementation-context-material-normal.json) records positive `original-svg-backdrop` rendering on the Header and Account menu, positive geometry and inline SVG filter references. Actual CBR open/page-turn/minimize/resume/close and return to30Tasks rows passed with no new console warning/error or source drift. [Tasks screenshot (private verification image)](publication.md#private-verification-images). Common777tests/0failures plus703guardedskips, check0/0 and production build/inventories passed.

Stable filter IDs or markup do not establish DOM object identity; the browser API provided no retained DOM handle for that proof. Native identity remains controlled-test-only, and no pixels/frame/GPU/heap savings were measured. Final DOM retained four zero-size native action owners and their definitions under the existing retained Dialog/zero-size behavior; this narrow key guard leaves that resource-policy debt unchanged. No sustained growth or leak is inferred from one lifecycle. Appearance/reduced-transparency preferences were not mutated.
