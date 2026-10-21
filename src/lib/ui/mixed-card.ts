import type {MediaCardShape, MediaRowStyle} from './types';

/** Shape defaults for the dev Progress experiment; identity and actions stay with the card. */
export function mixedCardStyle(kind:string, style:MediaRowStyle, overrides:{shape:MediaCardShape|null;artworkStyle:MediaRowStyle['artworkStyle']|null}):MediaRowStyle {
  return {...style,
    shape:overrides.shape ?? (kind==='episode'?'fanart':['album','track','artist'].includes(kind)?'square':'poster'),
    artworkStyle:overrides.artworkStyle ?? (kind==='episode'?'thumb':'auto'),
  };
}
export function cardAspectRatio(shape:MediaCardShape) {
  return shape==='fanart'?16/9:shape==='banner'?5.4:shape==='poster'?2/3:1;
}
