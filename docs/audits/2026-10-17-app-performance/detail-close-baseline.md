# Shared detail close — supplementary native integration baseline

Seven explicitly authored browser controls connect the current DetailPanel, DetailOverlay, Dialog, Button and media-navigation owners. They confirm a source-reachable duplicate close request and two stale-callback ownership opportunities, alongside four healthy lifecycle controls. **This is supplementary controlled evidence, using authored API outcomes and identity labels. It is not actual-media performance/equivalence evidence, a reproduction of the signed-in filtered Back failure, or remediation acceptance.** The actual mixed normal outcomes remain unchanged and unresolved.

| Control | Observed baseline |
| --- | --- |
| Visible terminal 403 | Native modal closes once; manual terminal handling and queued native callback each request the same −1 history close before any arrival. Two requests are captured, neither issued. |
| Failure before any native presentation | One manual close request, zero native close events; actual browser history arrival clears the trail. |
| Old close after history arrival | Replayed held close finds no current trail and adds no request. |
| Same-href pending reopen | Old held close callback requests closure of the new pending trail before its native dialog opens. |
| New-viewer pending reopen | Same stale request opportunity after authored viewer replacement. No actual account/settings change. |
| Forward/reopened guard | Actual Forward restores and opens the modal; its existing native-open guard ignores the old held callback; a fresh Close is still admitted once. |
| Successful held nested Back | One Back request and actual arrival to depth 1; old Activity stays inert with no Back while overview is held; fresh overview publishes and dialog remains open with no extra close. |

“Passed” in the [seven-result receipt](evidence/detail-close-baseline-cua.json) means the declared baseline characterization was observed, including the known undesirable outcomes. It does not mean these defects were fixed. The first case establishes two history **requests at the controlled I/O seam**, not two measured browser traversals or the normal app's final state. Held close delivery is replayed with an explicitly synthetic event after a genuine native close; it is not a captured natural race.

## Source and environment

The exact [fixture entry](candidates/detail-close-baseline/serve.ts), [plan](candidates/detail-close-baseline/verification-plan.json), 22 source/runtime/test pins and preparation receipt are retained. The production component and navigation function sources are compiled from their exact current bytes. API/error promises and child presenters use authored labels; materials/icons/menu/feedback side effects are inert. A lexical binding replaces only the navigation owner's named global history I/O boundary; requests are held and separately released through actual browser history/popstate using public fixture-owned state. This does not run the installed SvelteKit router and uses no private Kit keys.

The standalone static GET-only server rejects any DATABASE_URL environment, binds loopback and provides no database, command, provider or normal-app API. CUA operated visible controls, with read-only DOM result inspection. No Playwright orchestration, about:blank injection, browser state mutation through evaluation or normal-app network interception was used. Test-only CSS keeps controls visible; no visual-design, animation, geometry, device, CPU, timing, heap or GPU acceptance is claimed.

The initial bundle/source preflight reached listener startup but failed with EADDRINUSE on port 0 under the default sandbox. The [first failure receipt](candidates/detail-close-baseline/startup-first-failure.json) and original log remain immutable. This error alone does not prove a sandbox cause. Root verified port 5188 had no listener, then reran the same exact source with network permission and the explicit fixed port. That separate attempt started successfully and all seven baseline controls completed, with zero captured warning/error messages. It changed both permission context and port, so it is not an isolated causal test of the first failure.

The [duplicate-request screenshot (private verification image)](publication.md#private-verification-images) and [successful native Back screenshot (private verification image)](publication.md#private-verification-images) were visually inspected. The bare fixture styling is deliberate and independent of Coast's approved UI. The final successful Back result was captured before ordinary Close; then the fixture was reset idle with no open dialogs and its tab closed. The exact owned listener was terminated, its process exited from SIGTERM and port release was checked. All 22 pinned sources remained unchanged. The normal dev tab/server was retained and not targeted.

## Repair review

The [private source options](candidates/detail-close-baseline/repair-options.md) favor removing a duplicate initiator before introducing captured close-attempt state. An initial failure that never presented still needs history cleanup, while an actually presented failure should have one initiator. Stale native events additionally need ownership or disposal fencing, particularly when an old event arrives while a newer target is still loading. The existing guard protects an already reopened native modal but does not cover a not-yet-presented replacement.

A lifecycle condition/key alone cannot assume a detached DOM node's nondelegated listener was physically removed. The installed Svelte event lifetime must be checked; the Dialog already owns a destroyed flag that may provide a smaller fence. No candidate is adopted here. Meaningful next controls must preserve never-presented behavior, pending reopen/viewer ownership, Forward/new legitimate Close, hidden player/reader cases, focus and ordinary nested Back. Current normal filtered/unfiltered journeys and other actual detail families still require acceptance after any repair. The separate refresh-snapshot race remains open.

## Later observation-protocol review

The [candidate protocol review](detail-close-candidate.md) found that capture plus tick alone is not target completion. The baseline duplicate and both stale-reopen findings still wait for positive extra history requests and remain observed. Its late/Forward negatives follow synchronous synthetic dispatch return; they are replay controls. Never-presented has no native modal, and successful Back observes real popstate/presenter. None establishes ordinary unheld Close delivery or general absence of later requests. The new protocol supplies separately identified target/task evidence without rewriting this baseline receipt.
