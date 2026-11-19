# Progress segments and position review

Progress uses its existing availability summary to disable empty segments in the rail and expanded view. The server still selects the first populated segment when it needs a fallback. Filter-only reads reuse the summary until the next tracking or social revision. The total, privacy checks and 20-card previews and 60-card pages retain their existing boundaries.

Reading uses the positive page or an owner bookmark from the current cycle for Continue membership. The bookmark lookup uses the existing user, work and cycle index prefix. Ordering uses native position and current-playthrough records ahead of pagination. An edition with an EPUB bookmark remains resumable at zero percent. The existing reset transaction fences the old cycle and preserves history. No provider calls, polling, or schema changes are needed.

The source and query tests cover disabled selection, reuse of the availability summary, cancellation and bounded hydration. The PostgreSQL fixture covers first-page and EPUB bookmarks, the effects of clearing either position, and stable ordering when an old playthrough or an unrelated saved-title record is newer than current progress.

Continue and Next resolve the episode date before counts and hydration. An episode timestamp takes priority over provider dates, followed by a series airtime with a matching weekday and known time zone. A manual date override retains its priority. Episodes with only a date become eligible after that UTC date. Detail-page episode lists and the Available filter keep their existing meanings. The PostgreSQL fixture covers the timestamp priority and the zoned fallback with no playback source.

The shared Trakt metadata task uses the existing maintenance scheduler, outbox and catalogue cadence. It reads one bounded calendar window per run with app credentials, and writes only unambiguous local matches under the provider and job fences. Progress reads the date and episode timestamp in one indexed lookup, and only checks series schedules near the air date. No new dependency, migration or worker process is required.
