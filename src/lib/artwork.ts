/** Artwork kinds shared by imports, the private image proxy and card previews. */
export const artworkTypes = {
  primary: { label: 'Poster / primary', jellyfin: 'Primary', contain: false },
  backdrop: { label: 'Backdrop', jellyfin: 'Backdrop', contain: false },
  thumb: { label: 'Thumbnail', jellyfin: 'Thumb', contain: false },
  banner: { label: 'Banner', jellyfin: 'Banner', contain: false },
  logo: { label: 'Logo', jellyfin: 'Logo', contain: true },
  art: { label: 'Clear art', jellyfin: 'Art', contain: true },
  disc: { label: 'Disc', jellyfin: 'Disc', contain: true },
  box: { label: 'Box', jellyfin: 'Box', contain: true },
  boxRear: { label: 'Box rear', jellyfin: 'BoxRear', contain: true },
  screenshot: { label: 'Screenshot', jellyfin: 'Screenshot', contain: false },
  chapter: { label: 'Chapter', jellyfin: 'Chapter', contain: false },
  menu: { label: 'Menu', jellyfin: 'Menu', contain: false },
  profile: { label: 'Profile', jellyfin: 'Profile', contain: true },
} as const;
export type ArtworkType = keyof typeof artworkTypes;
export type ArtworkImages = Partial<Record<ArtworkType, string>>;
export const artworkKeys = Object.keys(artworkTypes) as ArtworkType[];
export function isArtworkType(value: string): value is ArtworkType {
  return Object.hasOwn(artworkTypes, value);
}
