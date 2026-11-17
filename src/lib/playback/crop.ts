/** A crop comes from the companion plugin, normalized when source dimensions are known. */
export interface FrameCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export const noCrop: FrameCrop = { left: 0, top: 0, right: 0, bottom: 0 };
export type CropRectangle = { Width: number; Height: number; X: number; Y: number };
export type VideoCrop = FrameCrop | CropRectangle;
export function videoFitStyle(
  videoWidth: number,
  videoHeight: number,
  width: number,
  height: number,
  crop: FrameCrop,
  cover: boolean
) {
  if (![videoWidth, videoHeight, width, height].every((value) => Number.isFinite(value) && value > 0))
    return '';
  // Match the reference's full-frame cover fallback for stale or invalid content bounds.
  const validCrop = Object.values(crop).every((edge) => Number.isFinite(edge) && edge >= 0)
    && crop.left + crop.right < 1 && crop.top + crop.bottom < 1;
  const active = cover && validCrop ? crop : noCrop,
    contentWidth = videoWidth * (1 - active.left - active.right),
    contentHeight = videoHeight * (1 - active.top - active.bottom);
  const scale = cover
    ? Math.max(width / contentWidth, height / contentHeight)
    : Math.min(width / videoWidth, height / videoHeight);
  const centerX = videoWidth * (active.left + (1 - active.left - active.right) / 2),
    centerY = videoHeight * (active.top + (1 - active.top - active.bottom) / 2);
  return `width:${videoWidth * scale}px;height:${videoHeight * scale}px;left:${width / 2 - centerX * scale}px;top:${height / 2 - centerY * scale}px;`;
}

/** Normalize the companion's pixel rectangle against the selected source's frame. */
export function companionFrameCrop(crop:CropRectangle|null,width?:number,height?:number):FrameCrop|null{
  if(!crop||!width||!height||![width,height,crop.Width,crop.Height,crop.X,crop.Y].every(Number.isFinite)
    ||crop.Width<=0||crop.Height<=0||crop.X<0||crop.Y<0||crop.X+crop.Width>width||crop.Y+crop.Height>height)return null;
  return {left:crop.X/width,top:crop.Y/height,right:(width-crop.X-crop.Width)/width,bottom:(height-crop.Y-crop.Height)/height};
}
export function resolveFrameCrop(crop: VideoCrop | null | undefined, width: number, height: number): FrameCrop | null {
  return crop && 'Width' in crop ? companionFrameCrop(crop, width, height) : crop ?? null;
}
