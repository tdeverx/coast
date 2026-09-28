/** Conservative black-bar detection on same-origin frames. Dark scenes never establish a crop. */
export interface FrameCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export const noCrop: FrameCrop = { left: 0, top: 0, right: 0, bottom: 0 };
export function measureBlackBars(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): FrameCrop | null {
  const light = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
  };
  let sum = 0,
    count = 0;
  for (let y = Math.floor(height * 0.3); y < height * 0.7; y++)
    for (let x = Math.floor(width * 0.3); x < width * 0.7; x++) {
      sum += light(x, y);
      count++;
    }
  if (sum / Math.max(count, 1) < 35) return null;
  const darkRow = (y: number) => {
    let bright = 0;
    for (let x = 2; x < width - 2; x++) if (light(x, y) > 16) bright++;
    return bright / (width - 4) < 0.015;
  };
  const darkColumn = (x: number) => {
    let bright = 0;
    for (let y = 2; y < height - 2; y++) if (light(x, y) > 16) bright++;
    return bright / (height - 4) < 0.015;
  };
  let top = 0,
    bottom = 0,
    left = 0,
    right = 0;
  while (top < height * 0.22 && darkRow(top)) top++;
  while (bottom < height * 0.22 && darkRow(height - bottom - 1)) bottom++;
  while (left < width * 0.22 && darkColumn(left)) left++;
  while (right < width * 0.22 && darkColumn(width - right - 1)) right++;
  // Require matching bars on opposing edges. Keep a pixel inside the matte to avoid cutting content.
  if (top < 2 || bottom < 2 || Math.abs(top - bottom) > 2) top = bottom = 0;
  if (left < 2 || right < 2 || Math.abs(left - right) > 2) left = right = 0;
  return {
    top: Math.max(0, top - 1) / height,
    bottom: Math.max(0, bottom - 1) / height,
    left: Math.max(0, left - 1) / width,
    right: Math.max(0, right - 1) / width,
  };
}
function sameCrop(a: FrameCrop, b: FrameCrop) {
  return (Object.keys(a) as (keyof FrameCrop)[]).every((key) => Math.abs(a[key] - b[key]) < 0.012);
}
/** Darkness or an uncropped studio intro must not permanently settle the movie's crop. */
export function createCropTracker() {
  let previous: FrameCrop | null = null,
    agreement = 0,
    samples = 0;
  return (measured: FrameCrop | null) => {
    samples++;
    agreement = measured ? (previous && sameCrop(previous, measured) ? agreement + 1 : 1) : 0;
    previous = measured;
    const crop = agreement >= 3 ? measured : null;
    return {
      crop,
      ready: crop !== null || samples >= 8,
      complete: crop !== null && Object.values(crop).some((edge) => edge > 0),
    };
  };
}
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
