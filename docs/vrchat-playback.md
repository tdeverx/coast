# VRChat playback compatibility

28 October 2026. This distinguishes documented engine/platform capabilities, community-reported combinations and Coast's finite local checks. It is not a promise that every world or headset supports every format.

## Engines and world players

VRChat has two underlying engines: Unity and AVPro. Unity is the conservative direct-video-file path; AVPro is the streaming/HLS path. World prefabs add UI, synchronization and engine selection rather than independent codecs. [VRChat's player documentation](https://creators.vrchat.com/worlds/udon/video-players/)

| World player | Relevant distinction |
|---|---|
| ProTV | Unity/AVPro selection and configured speakers determine delivery and audio behavior. [Audio/engine guide](https://protv.dev/guides/audio) |
| VideoTXL | Configurable Unity and AVPro sources. [Video manager](https://github.com/vrctxl/VideoTXL/wiki/Configuration:-Video-Manager) |
| USharpVideo | Separate Unity and AVPro backends. [Maintainer releases](https://github.com/MerlinVR/USharpVideo/releases) |
| iwaSync3 | Video/Live modes select underlying engines; the available public source is an older version. [Maintainer source](https://raw.githubusercontent.com/hoshinolabs-vrchat/iwaSync3/master/Assets/HoshinoLabs/iwaSync3/Udon/IwaSync3.cs) |
| VizVid | Builtin/AVPro modules, fallbacks and mobile URLs depend on world configuration. [Maintainer documentation](https://code.moka-rin.moe/VVMW/docs/index.html) |

Coast's **Share to VRChat** is an AVPro/HLS option. A future Unity-only option needs actual progressive MP4 delivery, not an HLS URL relabelled as MP4. Fast-start MP4 is the broad direct-file candidate. Android VRChat requires HTTPS; untrusted URL and public-world domain restrictions also apply. [VRChat URL restrictions](https://creators.vrchat.com/worlds/udon/video-players/www-whitelist/)

## Video and audio

VRChat's official wiki calls its compatibility matrix a work in progress. Reported MP4 H.264/AAC combinations work across Windows 11 and Quest 2/3 engines; HEVC has positive reported combinations but Windows HEVC installation matters. AV1 has positive Quest 3 combinations and negative Quest 2 combinations. VP8/Vorbis WebM is reported broadly; VP9 and AV1 vary with container and backend. These observations do not establish equivalent HLS support. [Reported combinations](https://wiki.vrchat.com/wiki/Video_players), [Unity platform requirements](https://docs.unity3d.com/2022.3/Documentation/Manual/VideoSources-FileCompatibility.html)

| Codec family | Coast disposition |
|---|---|
| H.264, 8-bit 4:2:0 | Default VRChat video candidate. |
| H.265/HEVC | Admin-enabled experimental alternative; OS, encoder, device and world backend matter. |
| AV1 | Device-specific; never infer Quest 2 VRChat support from Quest 3 or browser software decoding. |
| VP8 / VP9 | Useful in specific WebM combinations; not the shared HLS default. |
| AAC-LC | Portable baseline: stereo, 48 kHz, 192 kbps requested. |
| HE-AAC v1/v2 | Platform support exists, but profile/container signaling needs validation; not preferred here. |
| MP3 / Opus / Vorbis | Audio-only or particular container combinations can work; no universal muxed-video claim. |
| AC-3 / E-AC-3 | Do not assume Quest or speaker-routing parity; normalize to stereo AAC. |
| FLAC | Reported AVPro audio-only support does not prove Unity or FLAC-in-video support. |

See [AVPro's supported-media documentation](https://www.renderheads.com/content/docs/AVProVideo-v3/articles/supportedmedia.html), [Android's media table](https://developer.android.com/media/platform/supported-formats), and [Meta's native streaming guidance](https://developers.meta.com/vr/documentation/android-apps/media-requirements/). Browser capability is separate from VRChat's embedded player. ProTV also documents surround/center-speaker routing hazards; those do not establish the cause of Coast's already-stereo attempt. [ProTV audio configuration](https://protv.dev/guides/audio)

## HLS and cadence

H.264/AAC MPEG-TS HLS is the baseline candidate. H.265/AAC uses fMP4 HLS for standards-oriented interoperability. Apple's HEVC/fMP4 requirement is Apple interoperability guidance, not proof that Quest cannot parse HEVC TS. The exact ExoPlayer 1.8.0 used by the retained Quest user agent implements fMP4 and HEVC TS extraction. [Apple HLS authoring](https://developer.apple.com/streaming/hls-authoring-specification-for-apple-devices.html), [ExoPlayer HLS extraction](https://raw.githubusercontent.com/androidx/media/1.8.0/libraries/exoplayer_hls/src/main/java/androidx/media3/exoplayer/hls/DefaultHlsExtractorFactory.java), [TS reader](https://raw.githubusercontent.com/androidx/media/1.8.0/libraries/extractor/src/main/java/androidx/media3/extractor/ts/DefaultTsPayloadReaderFactory.java)

Use direct `.m3u8` entry paths for external players. ExoPlayer chooses HLS from the URL or an application-supplied MIME hint; Coast cannot set the latter inside a world player. [ExoPlayer HLS guidance](https://developer.android.com/media/media3/exoplayer/hls)

Do not force 30 fps. Preserve the source cadence, including fractional rates, and let Jellyfin retain its native timestamps. No universal VRChat FPS ceiling or blanket VFR acceptance was established. Source rate and headset display refresh are different concerns. [Android frame-rate guidance](https://developer.android.com/media/optimize/performance/frame-rate), [Unity metadata caveat](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/Video.VideoPlayer-frameRate.html)

Codec levels must accommodate output dimensions and cadence. For example, 1080p60 needs at least H.264 Level 4.2 throughput; 1080p120 needs about Level 5.1. HEVC uses different budgets: 1080p60 needs at least Level 4.1 throughput. These lower bounds exclude other limits and are not hardware certification. [H.264 level implementation](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavcodec/h264_levels.c), [HEVC level implementation](https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavcodec/h265_profile_level.c)

## Validate the produced bytes

Check the actual elementary streams, packet timestamps, audio packets and master-playlist `CODECS`. ExoPlayer 1.8.0 can disable AAC extraction when a nonempty `CODECS` declaration omits AAC; an FFmpeg output banner alone is insufficient. [Exact extractor behavior](https://raw.githubusercontent.com/androidx/media/1.8.0/libraries/exoplayer_hls/src/main/java/androidx/media3/exoplayer/hls/DefaultHlsExtractorFactory.java)

The [implementation audit](audits/2026-10-28-share-destinations.md) records successful genuine 25 fps H.264/HEVC samples and native 60 fps H.264 output. It also retains a HEVC/VideoToolbox level-conformance failure at 1080p60: that encoder uses Apple's HEVC AutoLevel and ignores the numeric request. H.265 remains off by default and experimental; do not claim that its 60 fps device behavior is accepted. [Exact FFmpeg 8.1.3 source](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.1.3/libavcodec/videotoolboxenc.c), [Apple profile-level interface](https://developer.apple.com/documentation/videotoolbox/kvtcompressionpropertykey_profilelevel)
