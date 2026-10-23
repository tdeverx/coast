# PR-02: Stop responsiveness and final-save ownership

**Historical review, superseded by the [approved implementation](stop-save/README.md).** The user selected waiting for the previous save before starting the next item; the implementation and its new evidence epoch are linked there. The source findings below describe the earlier code, not the current close handler.

Follow-up source review on 22 October. No playback behavior or server contract was changed. The user will provide device access; a fresh unrestricted device query succeeded with zero connected devices. That check is in [device-access](receipts/device-access.json), and does not establish hardware acceptance.

## What the current code guarantees

The [player close handler](../../../../src/lib/ui/components/PersistentPlayer.svelte) sets its reentrancy guard, completes party operations, pauses, then awaits its Stop report before clearing the player. The [report queue](../../../../src/lib/playback/reports.ts) preserves lifecycle order and coalesces only consecutive unsent progress reports for the same session. A pending acknowledgement can stall the queue. The [captured API](../../../../src/lib/ui/client.ts) preserves personal/share API authority; it does not install a report deadline.

The [playback preparation client](../../../../src/lib/playback/client.svelte.ts) currently waits for the controller's Stop while a session is attached. The [server preparation transaction](../../../../src/lib/playback/service.server.ts) marks the user's previous personal sessions stopped before inserting a successor. `progressPlayback` then treats reports for stopped sessions as no-ops and returns current tracking state.

Consequently, clearing `player.session` and removing only `await report('stop')` would expose this schedule:

1. The viewer stops A at the final position. Its acknowledgement is delayed.
2. The UI closes and preparation starts B because no session remains attached.
3. B's transaction retires A.
4. A's late Stop arrives, observes a stopped session and does not save its final position.

This is **source-derived evidence**, not a newly executed real-media failure. No live progress or provider notification was submitted to manufacture it. A successful response at step 4 would not establish that the final position was saved. Retry UI alone cannot repair this server contract.

## Recommended staged contract

Close the visible player immediately and keep the captured final report owned independently until its acknowledgement. Preserve the existing barrier before preparing another item. The barrier must remain discoverable after `player.session` is cleared; repeated Stop calls must not submit duplicate terminal reports. Show pending save through the existing feedback surface and expose failure/retry without claiming success. A failed or absent acknowledgement must not silently allow successor preparation to invalidate the pending report.

This is the smaller change and keeps existing server mutation ordering. Its explicit tradeoff is that the next item's preparation waits for the prior save. It requires a decision about retry or an explicit discard when saving fails; no timeout or automatic discard should choose for the viewer.

If the next item must start immediately, retain final-save ownership across server session retirement instead. That requires a wider reporting design: terminal delivery identity/idempotency, predecessor/successor ordering (including the same work), accepted payload/played-time accounting, policy/account-generation fences and late-response ownership. No new database table, receipt service, local persistence queue or arbitrary deadline has been adopted in this review.

The choice between these two contracts is pending in the chat. The earlier recommendation to release playback is not treated as permission to silently change successor tracking semantics.

## Additional boundaries that the implementation must preserve

- **Party reentrancy:** `close` can await `leaveSynced`, which can call `stopPlayback` again. Reusing the outer close promise for every reentrant call would create a self-wait cycle. Distinguish command reentrancy from the barrier used by successor preparation.
- **Snapshot before teardown:** capture position, duration, listening time, API authority and session identity while the media element remains available. Preserve original start-acknowledgement ordering and final listening accounting.
- **Successor ownership:** old acknowledgements, failures, refreshes, ended/postplay continuations and retry controls must not clear or pause a new session or publish old-session UI state.
- **Personal/share/account boundaries:** a captured share API must not become a personal report after route teardown. Account changes and permission/generation withdrawal are terminal boundaries, not retryable connectivity failures. Do not expose one account's pending state in another account.
- **Acknowledgement meaning:** distinguish saved, pending, failed and policy-disabled. Do not refresh as though tracking committed when the final report failed or became a stopped-session no-op.
- **Retry uncertainty:** a lost acknowledgement may follow a committed write. Retry must preserve idempotent watches/listens and exact final position; never replay a whole listening duration as newly played time.
- **Scope:** no reader, hero, trailer, visual design, provider pacing or general request-timeout change is implied by this item.

## Acceptance before closing PR-02

Use the existing player/reports owner tests for controlled ordering, plus actual accessible audio/video on a marked disposable copy. Keep those evidence classes separate.

| Schedule | Required result |
|---|---|
| Delayed earlier progress, then Stop | Visible playback closes immediately; final snapshot stays owned and drains in lifecycle order. |
| Stop followed by next item | Selected contract holds: preparation waits, or the final predecessor save survives successor preparation. |
| Lost acknowledgement after commit | Retry is safe; no duplicate watch/listen and no regressed successor state. |
| Failed save and repeated Stop/Retry | Honest failure state; one owned retry; no silent discard or duplicate terminal submission. |
| Stop during media/source preparation | Existing preparation cancellation and stale-session cleanup remain valid. |
| Party host/follower leave and Stop | No reentrant promise cycle; room authority and independent access preserved. |
| Shared playback and route teardown | Reports retain the captured API authority and do not mutate personal tracking. |
| Account switch/feature withdrawal | No cross-account publication or retries; disabled policy remains terminal. |
| Actual browser/device teardown | Media/decoder resources release, pending feedback remains usable, and failures are recoverable without claiming persistence across page destruction unless explicitly implemented. |

Do not mark these accepted from source review or an empty device list. Preserve the current full-suite/build results as the previous product-source epoch; after implementation, repeat affected real-data and browser checks and refresh its registered owner hashes with the new evidence.
