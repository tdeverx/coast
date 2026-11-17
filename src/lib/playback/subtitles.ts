import type { MediaStream } from '#lib/providers/contracts.js';

// OpenSubtitles.com language catalogue, including provider-specific regional codes.
// https://github.com/opensubtitles/VLSub-OpenSubtitles-com/blob/main/docs/languages.md
export const subtitleLanguages = [
  { code: 'ab', label: 'Abkhazian' },
  { code: 'af', label: 'Afrikaans' },
  { code: 'sq', label: 'Albanian' },
  { code: 'am', label: 'Amharic' },
  { code: 'ar', label: 'Arabic' },
  { code: 'an', label: 'Aragonese' },
  { code: 'hy', label: 'Armenian' },
  { code: 'as', label: 'Assamese' },
  { code: 'at', label: 'Asturian' },
  { code: 'az-az', label: 'Azerbaijani' },
  { code: 'bn', label: 'Bangla' },
  { code: 'eu', label: 'Basque' },
  { code: 'be', label: 'Belarusian' },
  { code: 'bs', label: 'Bosnian' },
  { code: 'br', label: 'Breton' },
  { code: 'bg', label: 'Bulgarian' },
  { code: 'my', label: 'Burmese' },
  { code: 'ca', label: 'Catalan' },
  { code: 'ze', label: 'Chinese (bilingual)' },
  { code: 'zh-ca', label: 'Chinese (Cantonese)' },
  { code: 'zh-cn', label: 'Chinese (Simplified)' },
  { code: 'zh-tw', label: 'Chinese (Traditional)' },
  { code: 'hr', label: 'Croatian' },
  { code: 'cs', label: 'Czech' },
  { code: 'da', label: 'Danish' },
  { code: 'pr', label: 'Dari' },
  { code: 'nl', label: 'Dutch' },
  { code: 'en', label: 'English' },
  { code: 'eo', label: 'Esperanto' },
  { code: 'et', label: 'Estonian' },
  { code: 'ex', label: 'Extremaduran' },
  { code: 'fi', label: 'Finnish' },
  { code: 'fr', label: 'French' },
  { code: 'gl', label: 'Galician' },
  { code: 'ka', label: 'Georgian' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'is', label: 'Icelandic' },
  { code: 'ig', label: 'Igbo' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ia', label: 'Interlingua' },
  { code: 'ga', label: 'Irish' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'kn', label: 'Kannada' },
  { code: 'kk', label: 'Kazakh' },
  { code: 'km', label: 'Khmer' },
  { code: 'ko', label: 'Korean' },
  { code: 'ku', label: 'Kurdish' },
  { code: 'lv', label: 'Latvian' },
  { code: 'lt', label: 'Lithuanian' },
  { code: 'lb', label: 'Luxembourgish' },
  { code: 'mk', label: 'Macedonian' },
  { code: 'ms', label: 'Malay' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'ma', label: 'Manipuri' },
  { code: 'mr', label: 'Marathi' },
  { code: 'mn', label: 'Mongolian' },
  { code: 'me', label: 'Montenegrin' },
  { code: 'nv', label: 'Navajo' },
  { code: 'ne', label: 'Nepali' },
  { code: 'se', label: 'North Sámi' },
  { code: 'no', label: 'Norwegian' },
  { code: 'oc', label: 'Occitan' },
  { code: 'or', label: 'Odia' },
  { code: 'ps', label: 'Pashto' },
  { code: 'fa', label: 'Persian' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt-br', label: 'Portuguese (Brazil)' },
  { code: 'pm', label: 'Portuguese (Mozambique)' },
  { code: 'pt-pt', label: 'Portuguese (Portugal)' },
  { code: 'ro', label: 'Romanian' },
  { code: 'ru', label: 'Russian' },
  { code: 'sx', label: 'Santali' },
  { code: 'gd', label: 'Scottish Gaelic' },
  { code: 'sr', label: 'Serbian' },
  { code: 'sd', label: 'Sindhi' },
  { code: 'si', label: 'Sinhala' },
  { code: 'sk', label: 'Slovak' },
  { code: 'sl', label: 'Slovenian' },
  { code: 'so', label: 'Somali' },
  { code: 'az-zb', label: 'South Azerbaijani' },
  { code: 'es', label: 'Spanish' },
  { code: 'sp', label: 'Spanish (Europe)' },
  { code: 'ea', label: 'Spanish (Latin America)' },
  { code: 'sw', label: 'Swahili' },
  { code: 'sv', label: 'Swedish' },
  { code: 'sy', label: 'Syriac' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ta', label: 'Tamil' },
  { code: 'tt', label: 'Tatar' },
  { code: 'te', label: 'Telugu' },
  { code: 'tm-td', label: 'Tetum' },
  { code: 'th', label: 'Thai' },
  { code: 'tp', label: 'Toki Pona' },
  { code: 'tr', label: 'Turkish' },
  { code: 'tk', label: 'Turkmen' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'uz', label: 'Uzbek' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'cy', label: 'Welsh' },
];
const codes = new Set(subtitleLanguages.map(({code}) => code));
export function subtitleLanguage(value: string | undefined): string | undefined {
  const code = value?.trim().toLowerCase().replaceAll('_', '-');
  if (!code) return undefined;
  if (codes.has(code)) return code;
  if (code === 'pt') return 'pt-pt';
  if (code === 'zh') return 'zh-cn';
  if (code === 'es-es') return 'sp';
  if (code === 'es-419') return 'ea';
  try {
    const canonical = Intl.getCanonicalLocales(code)[0]?.toLowerCase();
    if (canonical === code) return code.includes('-') ? subtitleLanguage(code.split('-')[0]) : undefined;
    return subtitleLanguage(canonical);
  } catch {
    return undefined;
  }
}

export type SubtitleTrack = { index: number; label: string; language?: string; url?: string };
export type SubtitleSelection = { availabilityId: string; sourceId: string; index: number };
export type SubtitleOptions = {
  tracks: SubtitleTrack[];
  preferred: string;
  version: string;
  scope?: string;
  expiresAt?: number;
  source?: Omit<SubtitleSelection, 'index'>;
  unavailable?: string;
};
export type SubtitleResult = {
  id: string;
  ticket: string;
  name: string;
  format?: string;
  exact: boolean;
  sdh?: boolean;
  forced?: boolean;
  translated?: boolean;
  downloads?: number;
};
export type AddedSubtitle = { tracks: SubtitleTrack[]; index: number; source?: Omit<SubtitleSelection, 'index'> };

export function textSubtitle(stream: MediaStream) {
  return stream.type === 'Subtitle' && ['srt', 'vtt', 'subrip', 'webvtt'].includes(stream.codec?.toLowerCase() ?? '');
}
export type JellyfinSubtitle = MediaStream & { external?: boolean | null; forced?: boolean | null; sdh?: boolean | null; path?: string | null };

export function addedSubtitleTrack(before: JellyfinSubtitle[], after: JellyfinSubtitle[], expected: { language: string; forced?: boolean; sdh?: boolean }) {
  const key = (track: JellyfinSubtitle) => track.path || `${track.index}:${track.title}:${track.language}:${track.external}`;
  const existing = new Set(before.map(key));
  const matches = after.filter(track => {
    if (!track.external || !textSubtitle(track) || existing.has(key(track))) return false;
    // Jellyfin can report a generic ISO language even when the sidecar preserves a region.
    const parts = track.path?.split(/[\\/]/).at(-1)?.split('.').slice(1, -1);
    const tag = parts?.findLast(part => /^(?:[a-z]{2,3}-[a-z0-9]{2,4}|sp|ea|ze)$/i.test(part));
    const language = subtitleLanguage(tag) ?? subtitleLanguage(track.language);
    return language === expected.language && (expected.forced === undefined || !!track.forced === expected.forced) &&
      (expected.sdh === undefined || !!track.sdh === expected.sdh);
  });
  return matches.length === 1 ? matches[0] : undefined;
}
export function subtitleTrack(stream: MediaStream): SubtitleTrack {
  return { index: stream.index, language: stream.language, label: stream.title || stream.language || `Subtitle ${stream.index + 1}` };
}
export function subtitlePath(itemId: string, sourceId: string, index: number) {
  return `/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(sourceId)}/Subtitles/${index}/0/Stream.vtt`;
}
