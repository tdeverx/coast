# Playback titles, system controls and viewport resizing

The foreground video owns the tab title until browsing resumes or the player closes. Coast observes the existing title element only during that interval so navigation can still update the title that will be restored. The Media Session API publishes the active episode or track and clears metadata, position state and registered actions when playback ends. Artwork and episode labels reuse the existing playback preparation and access checks. Music album names come from the selected source snapshot.

The feature adds no catalogue query, polling loop or per-frame work. Media-session position updates follow existing playback boundaries and native duration and rate events. System media keys use the existing play, pause, seek, stop and queue controls. Party playback still uses its existing control permissions.

The built app was checked in Chromium on a disposable installation. The episode fixture verified the foreground title, title restoration when browsing and stopping, artwork, play, pause, seek and stop. The music fixture verified track, artist, album and artwork metadata plus next and previous, along with the shared controls. These checks exercised the native browser Media Session registration and invoked its action callbacks. Windows shell rendering and physical media keys were outside that fixture.

## Viewport resize

The player already recalculated fit and fill from its viewport observer. The sizing transition delayed the visible result when the viewport changed shape. In local Chromium, resizing an encoded-bar fixture to 1200×500 produced a correct 675px target height while the element still rendered at about 938px.

The existing observer now applies the new geometry immediately. Animated sizing remains available when the user toggles fit and fill, subject to reduced-motion preferences. Resizing uses the existing frame and companion rectangle and adds no observer, timer, provider request or stream reload.

The fixed production build reached the target video size at 390×780, 1200×500 and 1000×700 in Chromium, both with and without a companion rectangle. The explicit crop toggle still animated. The resize cycles started zero additional stream requests. This check used a disposable local database and controlled playback responses.
