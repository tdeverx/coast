# Actual linked-reading launch failure

17 October 2026; source `eb0673873462b71118d1c11678d128958a05ff07`. This supplement records LIVE-02 from the actual signed-in normal development application on port 5173. It is separate from LIVE-01's section replacement failure and PANEL-01's scroll behavior. No implementation fix, private title, work/source identifier, credential, or file content is included. Browser observations came from root; this subagent independently read the current source and ran focused existing tests. Later console-only lifecycle diagnostics were removed and the application source restored exactly to the baseline.

## LIVE-02 — P1: saved linked editions fail preparation because display metadata becomes command input

**Runtime symptom reproduced; source contract mismatch confirmed.** Root opened Library → View all Read, observed 12 actual title links, and used Read for one actual issue. “Choose a reading edition” opened with a Jellyfin server selected, then immediately showed `Invalid key: Expected never but received "name"`. No edition-choice rows appeared before a manual search. This is a deterministic client/server command-shape defect on the linked-source path, rather than evidence of provider latency, a missing archive decoder, or resource pressure.

The default-title Search remained reachable despite the earlier error and returned one actual CBR result. Selecting that result used a different source path; root observed a brief pending state followed by both source/detail dialogs closing, with no Reader dialog, image or canvas remaining and no new console error. On a direct reading route, root reproduced the linked unknown-key error again; manually searching/selecting the actual CBR briefly opened Reader with Close reader and disabled page controls, then a few seconds later no Reader/dialog/renderer remained. The underlying reading detail remained visible. Those early observations were confounded by development reload activity. A subsequent stable warm run rendered and navigated the actual CBR, minimized/resumed at the saved page, and closed intentionally; see the revised LIVE-03 audit trail below. The initial disappearances are not a confirmed application closure defect. LIVE-02 remains reproducible on the saved linked-copy command and is independent of that later manual-search success.

### Exact source chain

| Step | Current source | Contract |
| --- | --- | --- |
| Read loads available connections and saved candidates | `reading/ReadingLaunch.svelte:26–29` | Independent GETs to `reading/:id/connections` and `reading/:id/linked` |
| Server returns candidate display DTO | `reading/sessions.server.ts:35–44`; route `server/api/reading.server.ts:35` | Each linked candidate includes `connectionId`, `externalId`, **`name`, `format`** |
| Sole candidate auto-opens | `reading/ReadingLaunch.svelte:32` | `choose(result.linked[0])` receives the entire display DTO |
| Explicit saved choice has the same problem | `reading/ReadingLaunch.svelte:51` | When there are multiple saved candidates, `choose(linked)` also forwards the entire DTO |
| Narrow TypeScript parameter does not project runtime fields | `reading/ReadingLaunch.svelte:39–41` | A richer object is structurally assignable to `{connectionId;externalId}`; calling `openReading(id,source,signal)` preserves its extra own properties |
| Shared command serializer copies extras | `reading/client.svelte.ts:28,41–43` | `{source:'jellyfin',...input}` includes display metadata in the session POST; common API JSON-serializes the complete body (`ui/client.ts:46–50`) |
| Authoritative command validation rejects metadata | `reading/sessions.server.ts:19–22,56–58`; route `server/api/reading.server.ts:33` | Strict Jellyfin variant accepts only `source`, `connectionId`, `externalId`. `name` and `format` are not command fields |

The exact visible unknown-key message matches the first extra display field, `name`. Removing only `name` at one caller is insufficient because `format` is also unknown. The actual POST payload/status were not captured in this live browser pass, but the source constructs this mismatch directly and the observed error matches it. Validation occurs before the provider `readingItem` call at `sessions.server.ts:63`, before file observation at `:67` and before session insertion at `:83`. The rejected command therefore does not reach those subsequent steps. The preceding work/feature checks at `:58` still run; this is not a zero-work failure.

Search itself uses a GET with connection/query/offset (`ReadingLaunch.svelte:34–37`), and a searched result's Read constructs the exact two identity fields (`:61`). That explains why a result can pass this particular command-shape boundary even when automatic saved-copy selection cannot. It does not prove that downstream session/file/decoder handling succeeds. On opening a new choice, `createOperation.run` clears its prior operation error; merely searching clears the resource error but does not clear the earlier choose error. The stale notice during search is an observed consequence of this failure/recovery path, not an independently measured resource leak.

### One shared fix and all consumers

**Canonical smallest option:** project the exact command at the existing `openReading` serialization boundary: for a Jellyfin source, construct only `source`, `connectionId` and `externalId`. Keep the server's strict allowlist. This protects both saved-candidate paths and any future richer UI DTO passed by another consumer. Retain display names/format in the read model for presentation; do not spread it into a mutation. Adding a narrow shared input type or small command projector in the existing reading model can make this boundary explicit, but an annotation alone cannot remove runtime properties.

The local branch already constructs its own command with `source`, detected `format` and hashed `edition`; preserve it. Do not send the browser's display format as authority for a Jellyfin session: the server deliberately inspects the current provider item, supported format, exact edition identity and current account generation. Do not relax `strictObject`, trust display metadata, or add a compatibility shim to accept accidental fields.

**Alternative:** separate linked-candidate read DTOs and prepare-command types/schema in the existing shared reading model and use one typed projector from both UI and client. A shared contract test can then exercise the real candidate→command→strict-parse boundary without a database/provider. This is a larger organization change than explicit serialization and should remain within the existing reading owner. It does not justify a new service, queue, cache or production dependency. Projecting only inside each button/auto-choice caller is less complete because it leaves the shared serializer able to repeat this mistake.

| Consumer requiring acceptance | Source |
| --- | --- |
| Reading detail hero Read, full route and shared overlay | `reading/Details.svelte:113`, inside `media/DetailPanel.svelte:72` for the overlay |
| Book/comic catalogue and work-menu Read | `ui/work-menu/CatalogueActions.svelte:90,126,190`; used by shared WorkMenu adapters |
| Planning Read and its after-open completion | `routes/planning/+page.svelte:56` |
| Single saved copy auto-choice, multiple saved choices, and no saved choice | `reading/ReadingLaunch.svelte:26–32,51` |
| Search/pagination/server change and manually selected result | `reading/ReadingLaunch.svelte:34–37,55–63` |
| Local file branch and same-work Continue behavior | `reading/ReadingLaunch.svelte:23,53`; `reading/client.svelte.ts:35–40` |
| UI catalogue preview isolation | `routes/ui-preview/CatalogueExamples.svelte:88`; preview branch in `ReadingLaunch.svelte:28,32,41` |

This is shared book/comic source preparation, independent of EPUB/PDF/CBZ/CBR/CB7/CBT decoding. Each format uses the same Jellyfin identity command. Party follow/attach uses separate matching-session preparation; accepting this command must preserve existing personal/party source handover, bookmark acknowledgement and late-session retirement in `reading/client.svelte.ts:44–59`.

### Tests run and why they missed it

```text
.tools/bun-1.4.3/bun-darwin-aarch64/bun test tests/reading-navigation-lifecycle.test.ts tests/media-lifecycle-client.test.ts
Bun 1.4.3: 26 pass, 0 fail, 144 expect() calls
```

These are meaningful existing lifecycle/ownership tests, not actual-data performance measurements. They cover pending preparation cancellation, late-session retirement, handover ordering, bookmark retry and preview isolation. They do not certify the live file journey.

In particular, `tests/reading-navigation-lifecycle.test.ts:101–108` supplies linked objects with `name` and `format` but replaces `openReading` with a spy and explicitly expects the entire candidate to be forwarded. Separately, opener/client lifecycle tests mock the transport rather than run the strict server schema. Thus each side passes in isolation while the integrated command is invalid. Change regression protection at the real command boundary; do not merely adjust a mock to ignore unknown fields or loosen validation to make the test pass.

### Acceptance before closure

- Reproduce the actual single-linked Read journey before/after the change; record sanitized command key names, outcome and request count. The session POST must contain exactly the three permitted fields. The observed error must disappear without changing server validation.
- Exercise zero/one/multiple saved copies, each explicit linked choice, manual search results, pagination and connection changes from every consumer above. Preserve selection, busy/error/retry behavior and cancellation on close/context replacement.
- Add a focused contract regression passing a realistic linked read DTO through the real serializer and actual strict schema. Require unknown fields to remain rejected by the server, while command projection discards display-only metadata. Include an additional display-only field to protect against future DTO growth.
- Preserve local-file commands, file identity/size checks, feature/account/edition verification and exact provider-derived format. No source token, server path or private filename should enter the client command.
- For actual files/formats available, verify visible Reader page/rendering, turn, bookmark, minimize/reopen and close. A picker disappearing, a session POST succeeding or a source result being present is insufficient. One actual CBR passed the warm manual-search lifecycle in LIVE-03; that bypass does not fix or accept the automatic linked path. Record unavailable actual formats and resource measurements as gaps.
- Preserve personal/party handover, pending cancellation, late-session retirement and failed-bookmark recovery. Keep the existing 26 lifecycle tests meaningful, then run proportionate browser/domain checks after a selected fix.

No fix or after-fix acceptance was run. Sanitized live observations and exact source hashes are in [reading-real-launch.json](evidence/reading-real-launch.json); the normalized backlog entries are in [reading-live-findings.json](reading-live-findings.json).

## LIVE-03 — P3: development reload activity confounded the initial Reader lifecycle measurement

**Reclassified after further actual evidence: development measurement concern, not a confirmed production Reader closure defect. Primary owner: W12's stable profiling/development environment.** The initial report recorded a briefly visible Reader followed by no dialogs, rendered image or Resume reading control. That symptom was real, but attributing it to an application close path was not established. The later stable actual-file run succeeds, and the diagnostic failed run reconnects to Vite without calling the canonical reader closer. Do not count LIVE-03 as an independently confirmed application termination defect.

### Preserved audit trail and corrected conclusion

Root temporarily added console-only observations to the existing reading install/close functions, logging booleans, kind/format and call stack rather than private titles, identifiers or file contents. No lifecycle policy changed. The trace run installed a comic/CBR session at console time21:52:00.880; the Reader later disappeared, but there was **no `closeReading` trace**. At21:52:09.804 the console showed Vite connecting/connected. Earlier server output included “optimized dependencies changed” reloads and next-HMR-reload warnings; audit source diagnostics/HMR had also been active. These are development-environment confounds. They do not establish which particular action caused that exact reconnect or prove dependency optimization caused every earlier disappearance.

Root then ran the actual CBR manual-search path with a warm development server and no intervening source/document writes:

| Actual warm-run step | Observed result |
| --- | --- |
| Install at21:53:05.338; inspect after a12-second wait | Decoded comic image1988×3057; page controls enabled |
| Next | Page2 of23 with a decoded image |
| Show UI | No open Reader dialog;0 attached comic images; Resume reading visible |
| Resume reading | Page2 of23 restored with a decoded image |
| Explicit Close at21:54:17.893 | `closeReading` logged `save:true`, `hasSession:true`, `visible:true`, `loading:false`, `rendering:false`, `kind:comic`, `format:cbr`, `unsaved:false`; stack originated in Reader.close/button |
| After intentional close | 0 attached comic images;0 open dialogs |

The12 seconds is an observation wait, **not measured opening latency**. Restored page2 and `unsaved:false` are actual lifecycle observations; raw bookmark API timings/payloads were not captured. Zero attached images does not certify zero Blob URLs, workers, archive buffers or RSS. One actual CBR passed this visible lifecycle after manual search. It is not acceptance of LIVE-02's broken automatic linked-copy preparation, nor evidence for all reading formats.

After tracing, root restored `reading/client.svelte.ts` byte-for-byte to SHA-256 `f53bd5fc0cb2861426a1d1067251fc4beae2d8945ddcca1409feda9f275386ef`; source inventory matched the baseline. Browser timestamps above are preserved console values, with no timezone assertion. Evidence: [reading-real-termination.json](evidence/reading-real-termination.json).

### Development mechanism and shared measurement owner

The installed Vite is8.3.1. `vite.config.ts` configures plugins and strict filesystem access, with no explicit `optimizeDeps` policy. Reading is loaded dynamically from `routes/+layout.svelte:5–7`; `reading/reader/engine.ts:6–8` chooses format modules. Non-CBZ comics dynamically load the archive path (`comic-archive.ts:13`), whose decoder imports `libarchive-wasm` and whose worker imports its WASM URL. These are relevant late-loading paths to inspect; their presence does not prove which import triggered the observed reload.

Vite documents that dependency prebundling is development-only, and newly encountered dependencies can rerun prebundling and reload the page if needed. It also documents explicit optimizer configuration for imports not discovered initially. These are available development options, not a reason to eagerly ship every reader dependency in the production entry bundle. [Vite dependency prebundling documentation](https://vite.dev/guide/dep-pre-bundling.html).

**Smallest option:** make actual-file profiling reproducible: finish necessary edits before a run, warm the feature/dependency paths, then record document identity/navigation/reload signals alongside lifecycle/request evidence. Invalidate a trial when Vite reconnect/reload/HMR or a full navigation resets the in-memory application. Compare separately labeled cold and warm runs; use the production build for production performance conclusions. Keep normal-development UX results labeled as such. This belongs in the shared audit/benchmark harness and runbook, covering dynamically loaded readers, players, charts and other optional features.

**Optional development improvement:** if a controlled cold run identifies recurring late dependency discovery, add only the verified optimizer entries to the existing Vite configuration and confirm first-use behavior after a clean dependency cache. Do not blanket-include large dependencies, disable required HMR blindly, or change production dependency loading based on this confounded run. No application lifecycle/state-machine refactor is justified by LIVE-03's current evidence.

### Closure inventory retained as diagnostic context

The earlier source inventory remains useful if a future stable run exhibits unexplained termination: feature withdrawal at `routes/+layout.svelte:91`; explicit/native Dialog closure at `Reader.svelte:25,72` and `Dialog.svelte:97–102`; terminal feature/410 bookmark handling at `reading/client.svelte.ts:99`; party/source transitions at `playback/synced/client.svelte.ts:60,99,115,122`; another playback start at `playback/client.svelte.ts:118`; preparation replacement/retirement at `reading/client.svelte.ts:28–82`. The engine catch at `Reader.svelte:58` alone records an error rather than closing, and a freshly scheduled60000ms heartbeat at `:29` alone cannot explain a few-second event. These are possible diagnostic paths, not findings that any of them fired in the failed trials.

The absence of Resume reading in an earlier observation was consistent with lost in-memory state, but did not distinguish an application close from a document reload. This is exactly why a UI-only disappearance must not be promoted to a generic reader closure bug without document/lifecycle correlation.

### Remaining acceptance and limits

- Preserve the successful actual CBR lifecycle evidence and keep the saved linked-copy command failure open as LIVE-02.
- Make cold/warm trials stable and explicitly detect reloads; establish the exact cold development reload trigger before selecting an optimizer change.
- Repeat actual available PDF/EPUB/comic formats, connection variants and personal/party consumers under stable conditions. One23-page CBR is not all-format or large-archive certification.
- Measure load/navigation time, transfer, URL/worker/buffer ownership, bookmark API outcomes and post-close resource plateaus separately. Current image dimensions and attachment counts do not replace those measurements.
- If a future stable trial reproduces unintended termination, use sanitized install/close reason and API correlation at canonical owners before choosing a narrow repair. Do not restore the old confirmed-closure classification solely from the original confounded observations.

No production closure defect or fix is established by LIVE-03. The investigation did establish an actual successful CBR visible lifecycle on a warm normal-development retry and a concrete need to separate development reload behavior from application resource/lifecycle measurements.
