# Root regression coverage — 2026-10-15

Added `tests/setup-action.test.ts` and `tests/audit-auth-discovery-db.test.ts`. No production implementation changes in this follow-up.

The pure setup suite passes **3 tests / 19 assertions**: repeated closed-setup requests stop before parsing/hash; open setup applies the existing client quota before parsing/hash; a complete valid registration-shaped fixture reaches the hash boundary.

The dedicated database file contains seven cases for the root disposable DB runner:

- **AUTH-03:** Concurrent real setup actions in a fresh migrated DB require one administrator, one secure session cookie and one 409. The fixture includes displayName and matching passwordConfirmation.
- **AUTH-02:** Real onboarding disconnect/device/poll/import-selection lifecycle, with only Trakt `instanceTransport` mocked. Verifies availability invalidation, old-job cancellation, account-generation change after verified replacement, stale successful job rejection, required replacement import evidence and preservation of another owner's healthy connection.
- **CROSS-01/02:** Comics-only Jellyfin import resolves an OpenLibrary alias to an existing canonical ComicVine work while metadata is unavailable. An actual saved book is skipped, and an unknown same-title identifier requires metadata instead of guessing. The actual OpenLibrary preview loader permits resolved comic metadata and rejects resolved book metadata.
- **DISCOVERY-01:** Two IGDB sources produce one canonical owned game card outside the first 60 local matches, and no duplicate when the canonical result is locally present.
- **DISCOVERY-03:** 2,005 lower-UUID unrelated movie candidates cannot hide a Drama match. Provider-only and fresh-taste-only evidence remain accepted, while stale taste alone is excluded. A separate 2,005-work reading fixture preserves author-only and series-only matches.

Final local import/pure run: **3 pass, 7 DB skips, 0 fail**. Explicit source-style guard passes both files. All three type errors identified in root's final log were corrected (unused import, typed taste breakdown and literal work kind). Root owns final shared type checking and actual DB execution; this subagent did not run DB/global check/build.

Provider behavior is synthetic. Replacement import completion evidence is set directly in fixture outbox rows; these cases verify evidence selection and lifecycle rather than exercising the remote import handlers. No live provider, dependencies, commits or remote writes.
