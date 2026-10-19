# Shared avatar pending-decode ownership

`AvatarPicker` now owns its pending decode image and Blob URL before awaiting decode. Cancel, removal, provider-identity replacement and component teardown can immediately detach the source and revoke that URL. Completion/error use the same idempotent release, so late settlement cannot double-release or disturb a newer operation. This is the narrow cleanup slice of `UIS-07`; pixel/frame admission and browser peak decode allocation remain open.

The one production file changed is `src/lib/ui/components/AvatarPicker.svelte`. Its existing ProfileEditor, onboarding, preview Demo and dynamic preview specimen consumers all use the same owner. No dependency, new image framework, schema, visual design, accepted configuration or normal database change was introduced. [Machine-readable report and exact source pins](implementation-avatar-lifetime.json).

## Preserved behavior and healthy related owners

All existing input/output behavior remains: PNG/JPEG/WebP/GIF, the five-MiB compressed admission, centered square256×256 crop, WebP quality0.85, the220,000-character non-GIF output cap, provider transport signals, FileReader cancellation, current-generation loading/error/publication and all markup. The current saved avatar is not replaced by an obsolete read or decode failure.

GIF validation no longer retains its decoded image/URL during FileReader's original-byte read. FileReader still reads the original Blob; the exact returned GIF data URL and animation bytes are unchanged. This does not introduce an animation/frame policy or promise to stop all decoder work immediately.

`src/routes/ui-preview/+page.svelte` already revokes its previous background URL on replacement/clear and teardown. It was left unchanged: adding another predecode image there would add resource demand and alter error/timing behavior without fixing a demonstrated cleanup gap. UPP-02's custom JSON/event-size and image/pixel budgets remain open. The comic reader already owns/releases pending and displayed images/URLs idempotently, and artwork-colour already clears current image handlers/source on replacement/destroy. Those healthy owners were not churned into a new helper.

## Behavioral regression verification

[Focused receipt](evidence/implementation-avatar-lifetime-tests.txt): **six tests, zero failures, 56 assertions**, including complete client and server template compilation. The actual shared component script is compiled with Svelte's rune runtime. Controlled transports/deferred decoders protect the meaningful ownership cases:

- removal detaches/revokes before a held decode settles;
- an old completion/failure/finally cannot clear current loading, errors, image ownership or replacement output;
- provider identity replacement and disposal release pending decoded ownership immediately;
- current decode failures release once and retain error handling;
- GIF validation releases before FileReader and preserves its original-byte completion/abort contract.

Those deferred decoder/URL values are supplementary functional controls, not actual image-performance data. The provider/jobs agent independently reviewed the exact source/test diff and found no material blocker.

## Actual native format/output proof

[Native browser receipt](evidence/implementation-avatar-native.json) passes **41 checks**, comparing complete encoded outputs before/current for four existing assets. There are no generated image or catalogue fixtures in this primary proof.

| Actual source role | Input bytes | Native decoded size | Output |
| --- | ---: | ---: | --- |
| Previously authorized real JPEG artwork |242,684 |780×1169 |256×256; complete encoded output identical |
| Previously authorized real WebP artwork |58,904 |780×1170 |256×256; complete encoded output identical |
| Existing app grain PNG |24,973 |128×128 |256×256; complete encoded output identical |
| Existing retained avatar GIF |325,896 |150×150 |150×150; original bytes/data URL identical |

The PNG is an actual application asset, not a retained user PNG avatar or evidence for representative large user uploads. The actual GIF preserves its entire encoded byte sequence; no frame-count or animation-memory measurement is inferred.

The isolated fixture runs the exact before/current component script with native Chromium Image, Canvas and FileReader, then decodes each result. Every current input source finishes detached, with one allocation/one revocation and zero active input Blob URLs. In the actual GIF case, active validation URLs at FileReader admission fell from one to zero. Complete output equality verifies the original crop/encoder behavior on these finite inputs; it is not a cross-browser visual benchmark.

Four additional controlled schedules hold delivery **after actual native decode**: remove, supersede, dispose and a late obsolete error. Each immediately observes detached source/zero active URL, suppresses stale publication/error, and ends with exactly one revoke per allocation. These controlled waits do not establish a naturally hung decoder or guarantee universal CPU cancellation. The focused unit test separately holds a decoder promise before settlement.

The probe used a fresh private browser context, no normal cookies, no provider transport and no database connection/write. All four original assets remained byte-identical. Temporary compiled bundles and the browser were closed/removed. Only aggregate dimensions/counts/digests and a status-only screenshot were retained; no raw images, encoded outputs, private filenames or user IDs were saved in the audit.

## Browser and acceptance boundary

The Browser plugin/skill was absent in this session. The existing installed Playwright1.63.0 and Chromium153.0.8010.12 ran the isolated fixture at `about:blank`,900×650. No dependency/browser install or shared CUA tab was used. A CLI lookup did not complete and was interrupted; the existing project API ran the required native image proof. An initial test-bundle runtime file-URL resolution error and the sandbox's Chromium macOS IPC denial were setup failures, retained in [preflight](evidence/implementation-avatar-native-preflight.log) and [sandbox](evidence/implementation-avatar-native-sandbox.log) logs. The same guarded probe passed after the test seam correction and approved sandbox escalation; production source was unchanged.

| Check | Result and scope |
| --- | --- |
| Page identity/content |Private fixture title and visible status; not the normal app |
| Framework overlay |No framework overlay is loaded in this isolated script-only fixture |
| Console / page errors |Zero warnings/errors and zero page errors |
| Native interaction |Actual select-file handler, four format outputs and four late-delivery schedules passed |
| Screenshot |Status-only proof, no private image pixels; not visual app/style acceptance |
| Normal rendered chooser |Root owns current normal profile chooser open/cancel without saving; pending |
| Common check/build |Root-owned current-source gates; pending |

Root normal chooser acceptance must preserve the saved image, loading/disabled state and close/reopen behavior without saving preferences. Live provider-icon transport, natural slow decoder behavior, responsive rendering, oversized/animated allocation, peak heap/RSS and pixel/frame policy remain unverified. Detaching a source and revoking a URL does not establish immediate decoder/heap reclamation in every browser. No such gain is claimed.

The portable [actual-byte probe](probes/avatar-native.ts) pins both owners, reads only the known authorized artwork copies, app PNG and a retained GIF avatar, and uses no provider/database transport. Replays capture a new browser/runtime window and should be saved as new receipts rather than silently repointing the original proof. The [saved before component](candidates/avatar-picker/AvatarPicker.before.svelte.txt) is code only, not image data.

[Status-only native ownership proof (private verification image)](publication.md#private-verification-images)

## Root combined gates and normal acceptance

The [source-frozen normal dev (localhost:5173) trial](evidence/implementation-summary-avatar-normal.json) passed the existing signed-in chooser flow: open Profile editor, select the connected avatar source, cancel, reopen with the same saved preview, then cancel again. No profile Save was submitted. The actual profile genre heading rendered, settled Library showed 120 media links / 29 completed private-or-inline images, and Tasks ended with 30 rows, no open dialog and no new warning/error. The first Library sample still showed the outgoing profile and is explicitly retained as an invalid sample; acceptance waits for the Library heading and actual cards. No provider/decode/cancellation timing or bearer-token HTTP acceptance is inferred from these UI steps. Source hashes remained unchanged.

Common gates: **784 passed, 704 guarded skips, 0 failures, 33,604 assertions across 1,488 tests / 269 files**; Svelte check 0 errors / 0 warnings, production build, source/UI inventories and style checks passed. Guarded skips are not acceptance; the new genre override fixture was not run on the actual clone. [Library screenshot (private verification image)](publication.md#private-verification-images).
