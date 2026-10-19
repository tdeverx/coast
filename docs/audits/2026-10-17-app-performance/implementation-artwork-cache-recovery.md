# ARTWORK-CACHE-OBS-03 — shared rejected-entry recovery

Implemented in the shared image-cache owner and both production consumers. `createImageCache.get(key, validator?)` now runs the existing synchronous format checker after reading bytes. A rejection removes the file and its index entry in the **same serialized operation** before returning a miss. The subsequent valid download can therefore persist its replacement; a queued reader or replacement cannot overtake the removal. Valid immutable `put`/deduplication, pending write/byte admission, storage limits, trimming and temporary-file cleanup retain their existing behavior.

The filesystem ENOENT catch covers only the read. A validator exception propagates without deleting a valid file or clearing its index, even if the exception carries an ENOENT-shaped code. Failed unlink also does not release accounting prematurely. Both production consumers use the canonical owner: private `serverArtwork` passes its existing WebP check; public `streamTmdbArtwork` passes its existing JPEG/PNG/WebP recognition check. The private consumer no longer repeats its cache-hit validation outside the owner. There is no new decoder, dependency, retention policy, visual change, commit or database access.

## Verification

The [focused cache/lifetime suite](evidence/implementation-artwork-cache-recovery-tests.txt) passes **20 tests, 115 assertions** across three files. New generic cache regressions protect invalid-entry eviction and exactly-once accounting, validator exceptions preserving indexed immutable files, and concurrent queued readers/replacement. Existing tests continue to protect LRU/file/byte budgets, temporary cleanup and pending-credit restoration after decline/failure, independent artwork cancellations and abandoned late persistence. Generic arrays and controlled boundaries in those unit tests are functional fixtures, not actual-data performance evidence.

The separate [actual-byte proof](evidence/implementation-artwork-cache-recovery-actual.json) passes **28 checks** using the previously authorized actual public JPEG (242,684 bytes) and browser-captured private WebP (58,904 bytes), verified by their existing hashes. It truncates copies to **two bytes**, seeds newly disposable indexed caches, and executes the captured before/current consumer source with the real corresponding cache owner and filesystem. Configuration/data-directory/upstream boundaries are isolated; upstream responses replay those exact image bytes. No provider request or database access occurs. All disposable directories are removed, and actual installation cache files are untouched.

| Controlled phase | Calls exercised | Result | Retained file |
| --- | --- | --- | --- |
| Previous private consumer | Two sequential reads | Two successful responses, two upstream replays | Invalid two-byte entry remains |
| Current private consumer | Two concurrent recovering readers, then a later read | Three successful exact-image responses, one shared replay | Full original WebP retained |
| Previous TMDB consumer | Two sequential reads | Two 502 responses, no replacement attempt | Invalid two-byte entry remains |
| Current TMDB consumer | Two concurrent recovering readers, then a later read | Three successful exact-image responses, one shared replay | Full original JPEG retained |

The proof also uses copies of those real images for repeated invalid-read budget release, LRU pressure without double/under-accounting, validator failure preserving file/index, valid immutable deduplication, and queued replacement surviving preceding invalid readers. Current and before source hashes are retained. This demonstrates recovery under an injected fault; the differing phase request shapes are not a latency benchmark or an observed production download-rate improvement.

## Limits and maintenance

No naturally malformed cache entry or user incident was found. This change repairs entries rejected by the **existing magic-header checks**: the tested two-byte JPEG is shorter than its three-byte recognition prefix; the tested WebP is shorter than its twelve-byte RIFF/WEBP header. Header-preserving truncation or decode corruption may still pass those checks. No complete image-decoding validation or universal corruption-repair claim is made.

The existing cache contract remains one owning application process per directory; external concurrent writers are not made safe by this change. No CPU, RSS or live provider latency saving is claimed. Root owns the coordinated full check/build/test gates after source freeze.

[Machine receipt](implementation-artwork-cache-recovery.json) lists the three production files, focused test path, exact hashes and acceptance limits. The [replay probe](probes/artwork-cache-recovery.ts) requires the already authorized private sample copies and captured before-source files; if they are unavailable, obtain equivalent authorized real captures rather than substituting fabricated performance data. Its global transport guard rejects unexpected external requests. The original runtime observation remains the historical source-only finding; this supplement records its later implementation and verification.
