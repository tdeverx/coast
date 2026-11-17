import type { MediaRowStyle } from './types';

type ProgressCardStyle = Required<Pick<MediaRowStyle, 'shape' | 'artworkStyle' | 'artworkPriority'>>;

const showThumbnail: ProgressCardStyle = { shape: 'fanart', artworkStyle: 'thumb', artworkPriority: 'show-season-episode' };

export function progressCardStyle(view: string): ProgressCardStyle | undefined {
  switch (view) {
    case 'continue':
    case 'watching':
      return { shape: 'fanart', artworkStyle: 'thumb', artworkPriority: 'episode-season-show' };
    case 'next':
    case 'up-next':
      return { shape: 'poster', artworkStyle: 'primary', artworkPriority: 'season-show-episode' };
    case 'paused':
    case 'watchlist':
    case 'favourites':
      return showThumbnail;
    case 'finished':
      return { shape: 'poster', artworkStyle: 'primary', artworkPriority: 'show-season-episode' };
  }
}
