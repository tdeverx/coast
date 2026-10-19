# Unlimited downloads and reading parties

The download cap is removed at the user's request. PR security review identified a P3 resource-exhaustion tradeoff: a joined host can switch to a very large mutually authorized comic, causing each guest's current automatic follow behavior to allocate the whole compressed archive. Access checks and extraction budgets do not bound compressed input.

Proposed minimal mitigation: keep unlimited downloads, but require the guest to choose **Read current item** when a party changes to a different reading edition or when restoring a party after reload. Reuse the existing party retry/join control; do not add a modal, byte threshold, storage or dependency. Explicit initial Join remains a download action; page turns within the accepted edition stay automatic. A pending edition must not run matching/preparation/attach/download until the click. A newer room/edition supersedes the pending choice. Existing per-account matching, revision, follower and source-withdrawal gates remain.

Acceptance after approval: verify pending room state on actual host/guest/source data, zero preparation/download before acceptance, normal explicit attach after acceptance, repeated heartbeat behavior, changed edition supersession, restore, close/leave and existing party revision/follower tests. Keep pure client orchestration controls separate from genuine native provider access.

Alternative: retain automatic following with unlimited transfers, explicitly accepting the resource-exhaustion tradeoff between trusted party members. That requires documenting/dismissing this finding as accepted risk rather than claiming it is fixed.

This note is a decision proposal; the mitigation has not been adopted.
