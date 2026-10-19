# Lazy import ownership and explicit document reload recovery

FRT-04's six component imports now retain shared resource ownership and report module failures with an explicit **Reload page** action. HLS module rejection uses that same action; a later setup/attach failure retains its existing same-session Retry and immediate cleanup. The actual built-app correction passed in the native in-app browser: the button restored three actual friend rows, and a separate fresh-origin trial suppressed a held failure after demand closed. Normal signed-in development acceptance and real HLS remain pending. No automatic reload, module URL rewriting, dependency, schema or design change was introduced.

## What the actual trial changed

Root ran the built app against a fresh isolated copy of actual catalogue/accounts. A scoped test server returned one intentional 503 for the cold FriendsPanel JavaScript request, then served the unchanged real built asset. The original scoped failure appeared, but the old Retry action did **not** render the panel after restoration. A manual document reload rendered the actual Friends panel with **3 friend actions**; closing/reopening retained success. There were no recorded console warnings/errors. This is an induced network fault on a real built app/data corpus, not a natural incident or fabricated provider response.

The [before UI receipt](evidence/implementation-lazy-browser-before-ui.json), [server receipt](evidence/implementation-lazy-browser-before-server.json) and [cleanup receipt](evidence/implementation-lazy-browser-before-runner.json) remain unchanged. The cold module request, restored JavaScript response and copied-data boundary are recorded there. The stylesheet `sheet` property returned false through the read-only browser adapter; that probe is explicitly inconclusive, not evidence of missing CSS. Screenshots showed the styled result; the fresh-origin trial below separately verifies actual CSS response bytes/hash. Normal database, cookies and source clone were left unchanged, the new session was removed, and the fresh target was dropped.

The earlier **22 tests / 127 assertions** used replaceable transport/module mocks and appeared to recover when a new import call resolved. Preserve that result as [before-import-reload-tests.txt](evidence/before-import-reload-tests.txt), not native browser retry acceptance. The [earlier implementation record](evidence/implementation-lazy-recovery-before-import-reload.json) is historical. The actual failed recovery explains why those mocks were insufficient to approve the original action.

## Shared contract and all changed consumers

`ui/action-feedback.svelte.ts` adds optional `actionLabel` to the existing failure source and notice. The existing `watch` owner delivers and updates that label alongside its current retry callback. A missing label still displays Retry; Undo still takes precedence. Both real presenters—`NotificationToasts.svelte` and `Dialog.svelte`—use the same label fallback, so a modal cannot mislabel document reload as Retry.

`ui/client-context.ts:reportImportFailure` is a narrow wrapper around the existing feedback watcher. It offers Reload page, rechecks the current failure read when the user clicks, and reloads only when that error remains and the client is not a preview. It starts no reload while publishing a failure, no failed-module polling loop and no alternate loader/cache. Closing, changing viewer/capability or destroying the existing watched owner removes its visible action through the existing lifecycle.

| Consumer | Failure and recovery owner | Preserved behavior |
| --- | --- | --- |
| Root Reader, StreamsPanel, MediaDetailPanel, NotificationInbox and FriendsPanel (`src/routes/+layout.svelte`) | Five independent `createResource` instances and `reportImportFailure` reads gated by their current demand/viewer. All use “Reload the page to try again.” | Resolved components remain cached for reopen. Viewer/close ends publication; destroy disposes the five resources. Existing reader, panel/navigation and capability behavior stays in the domain component. |
| DynamicFeed (`src/routes/for-you/+page.svelte`) | Same resource/reload contract for the signed-in capable viewer's visible overview. | Section grids continue through Shelf; hidden overview demand does not start a module import. Successful component reuse remains intact. |
| HLS startup (`src/lib/ui/components/PersistentPlayer.svelte`) | Only the rejection of the actual `import('hls.js')` Promise marks a module failure and offers Reload page. | Attempt/session/source/element fencing and immediate idempotent engine/media release remain. A setup/attach exception after successful import keeps same-session Retry; it does not replace the session, edition or party. Other playback errors retain `switchEdition`. |
| Global and modal feedback presenters | Optional shared action label with Undo/Retry defaults. | Existing presentation, busy state, dismissal and scoped delivery remain. |

Root/For You admission remains inside `untrack`, avoiding an effect subscription to its own busy/error state. Resource cancellation is a **publication fence**, not physical cancellation of ES module fetching. A successful late download may remain in the browser module map while its closed consumer rejects publication. Reload performs ordinary document navigation; it does not promise uninterrupted active playback or restoration of unsaved transient UI.

The HLS owner keeps `released` separate from `cancelled`. Failure immediately releases any partial engine, failure timer and media source; later cleanup does not repeat destruction/pause/source removal/load for that attempt. Import rejection is classified at the import Promise itself, not inferred from arbitrary setup error text. On source replacement/close, the import-specific error is cleared and its old reload action cannot affect a new source. Native codec/media event and shared/party acceptance remains distinct from the controlled element fixture.

## Current verification and remaining acceptance

The [current focused receipt](evidence/implementation-lazy-recovery-tests.txt) passes **26 tests / 177 assertions** across `lazy-import-lifetimes`, `ui-resource`, `ui-feedback` and `player-recovery`. It compiles the complete client and server templates of the three module owners and both feedback hosts: **10 full template compilations**. Component-script fixtures use the actual source, real client-runtime `untrack`, real resource owner and actual `reportImportFailure` wrapper with a controlled reload spy.

These regressions cover the six failed-import feedback paths, no automatic reload/retry, exact Reload label, success-cache reuse, current-error recheck before the next render, preview suppression, watch destruction, overlapping/updated action labels, Undo/Retry defaults, close/viewer/logout/disposal fences, HLS module/setup classification, same-session setup retry, immediate partial-engine release and no stale HLS attachment. Mocked module delivery and the reload spy remain supplementary source-contract evidence; they do not claim that native module imports retry successfully.

Independent read-only source review by `playback_readers_audit` and root found no material blocker in this narrow correction. Their [source-pinned review receipt](evidence/implementation-lazy-reload-source-review.json) covers the current diff. The original failed full-check preflight (`tests/work-menu-scope.test.ts:46`) remains [historical evidence](evidence/implementation-lazy-recovery-check-preflight.txt). Root reported current common gates at **757 passed / 703 guarded skips / 0 failed**, check **0 errors / 0 warnings**, and a successful production build. Skips are not passes; no build was started by this correction owner.

## Completed built-app trials and their limits

The corrected [UI trial](evidence/implementation-lazy-browser-final-ui.json) showed one **Reload page** button and zero Retry buttons after the intentional cold FriendsPanel JavaScript 503. Clicking it restored three actual friend actions, no error, computed header-action `display:flex`, and successful close/reopen. There were zero recorded warnings/errors. The [server receipt](evidence/implementation-lazy-browser-final-server.json) and [cleanup receipt](evidence/implementation-lazy-browser-final-runner.json) bind that result to the real built handler and copied data.

That trial's attempted close-before-release probe was invalid: Header Friends opens the panel rather than toggling it, so a repeated click left the friends query/demand true. Its calibration remains in the receipt and is not counted as late-publication acceptance. It was a probe error, not an application defect.

The stronger [separate fresh-origin trial](evidence/implementation-lazy-browser-late-ui.json) held the first cold JavaScript request, used browser Back, and verified the friends query was **false before releasing the 503**. The late failure produced no feedback or Reload button while closed. Reopening offered Reload page; clicking it restored three actual friend rows with computed flex styling. There were zero recorded warnings/errors. Its [server receipt](evidence/implementation-lazy-browser-late-server.json) independently records the exact restored assets:

| Actual response | Content encoding / coded bytes | Decoded build-file bytes | Identity |
| --- | --- | --- | --- |
| FriendsPanel JavaScript | Brotli (`br`), 3,100 bytes | 9,155 bytes | Decoded SHA-256 equals the actual built JavaScript file |
| FriendsPanel stylesheet | Brotli (`br`), 225 bytes | 606 bytes | Decoded SHA-256 equals the actual built CSS file |

The coded response hashes differ from their decoded file hashes because of compression; the receipt retains both. These counts establish response/file identity, not a performance improvement. No CSS failure was induced, so successful CSS delivery is not claimed as CSS failure-recovery acceptance.

All three trials—before, corrected action and fresh-origin late close—removed their created session, stopped their server, dropped their generated clone and removed private runtime data. The [late cleanup receipt](evidence/implementation-lazy-browser-late-runner.json) completes that chain; normal database and source clone were not mutated. Only the native in-app browser was exercised, with an intentionally failed **same-hash** asset and selected JavaScript `Cache-Control:no-store` at the isolated test-server boundary. This is not a version-skew deployment, every-browser or natural incident proof. Source/test pins are unchanged.

Normal signed-in development (`localhost:5173`) acceptance remains pending root. Actual HLS import/reload, codec/native pause/load/shared/party behavior remains an additional media gap. No speed, heap or native network-cancellation claim follows from these tests.

## Other imports and maintenance

The domain-owned imports in `DetailPanel.svelte` and `Reader.svelte` retain their existing payload/navigation and engine/file/bookmark lifetimes. They were not replaced with a generic component loader. PreviewExample, ComponentSpecimen, Demo, FeatureExamples and SocialExamples already catch/fence import publication, with isolated preview feedback. ChartView and UI-reference editor rejected-Promise/cache/SSR behavior remains separate scope. This change does not claim universal module or stylesheet failure recovery.

Keep optional action labels in both feedback hosts, with Undo precedence and Retry default. New module consumers should preserve the owning resource/demand lifecycle and use the shared explicit action rather than adding automatic document reload, cache-busting module URLs or per-medium recovery shims. Actual browser asset behavior must accompany module-recovery claims; transport mocks alone are insufficient.

Run `.tools/bun-1.4.3/bun-darwin-aarch64/bun test tests/lazy-import-lifetimes.test.ts tests/ui-resource.test.ts tests/ui-feedback.test.ts tests/player-recovery.test.ts`. Current source pins and open acceptance are in [implementation-lazy-recovery.json](implementation-lazy-recovery.json). No commit, push, normal migration or deployment was performed.
