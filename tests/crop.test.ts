import { describe, expect, test } from 'bun:test';
import { createCropTracker, measureBlackBars, noCrop, videoFitStyle } from '../src/lib/playback/crop';
const frame = (bar: number, brightness: number) => {
  const data = new Uint8ClampedArray(160 * 90 * 4);
  for (let y = 0; y < 90; y++)
    for (let x = 0; x < 160; x++) {
      const i = (y * 160 + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = y < bar || y >= 90 - bar ? 0 : brightness;
      data[i + 3] = 255;
    }
  return data;
};
describe('presentation crop', () => {
  test('only symmetric matte bars from bright frames establish a crop', () => {
    const measured = measureBlackBars(frame(10, 150), 160, 90);
    expect(measured?.top).toBe(10 / 90);
    expect(measured?.bottom).toBe(10 / 90);
    expect(measured?.left).toBe(0);
  });
  test('a dark scene leaves crop unresolved instead of cutting the image', () => {
    expect(measureBlackBars(frame(10, 15), 160, 90)).toBeNull();
    expect(measureBlackBars(frame(0, 150), 160, 90)).toEqual(noCrop);
  });
  test('fit preserves the full frame and crop fills using the actual content', () => {
    expect(videoFitStyle(1600, 900, 1600, 720, { ...noCrop, top: 0.1, bottom: 0.1 }, true)).toBe(
      'width:1600px;height:900px;left:0px;top:-90px;'
    );
    expect(videoFitStyle(1600, 900, 1600, 720, noCrop, false)).toBe(
      'width:1280px;height:720px;left:160px;top:0px;'
    );
  });
  test('dark openings and uncropped intro frames do not permanently prevent later bar detection', () => {
    const observe = createCropTracker();
    for (let i = 0; i < 20; i++) expect(observe(null).complete).toBe(false);
    expect(observe(null).ready).toBe(true);
    for (let i = 0; i < 4; i++) expect(observe(noCrop).complete).toBe(false);
    const bars = { ...noCrop, top: 0.1, bottom: 0.1 };
    expect(observe(bars).complete).toBe(false);
    expect(observe(bars).complete).toBe(false);
    expect(observe(bars)).toEqual({ crop: bars, ready: true, complete: true });
  });
  test('unreliable frames break agreement before a crop is applied', () => {
    const observe = createCropTracker();
    const bars = { ...noCrop, top: 0.1, bottom: 0.1 };
    observe(bars);
    observe(bars);
    observe(null);
    expect(observe(bars).crop).toBeNull();
    expect(observe(bars).crop).toBeNull();
    expect(observe(bars).crop).toEqual(bars);
  });
  test('encoded letterboxing covers the viewport with the reference oversized placement', () => {
    const values = Object.fromEntries(videoFitStyle(1920, 1080, 1600, 900,
      { ...noCrop, top: 0.125, bottom: 0.125 }, true)
      .split(';').filter(Boolean).map((entry) => {
        const [key, value] = entry.split(':');
        return [key, Number.parseFloat(value)];
      }));
    expect(values.width).toBeCloseTo(2133.333333);
    expect(values.height).toBe(1200);
    expect(values.left).toBeCloseTo(-266.666667);
    expect(values.top).toBe(-150);
  });
  test('invalid content bounds fall back to full-frame cover and invalid dimensions are deferred', () => {
    expect(videoFitStyle(1600, 900, 1600, 720, { ...noCrop, left: 1 }, true)).toBe(
      'width:1600px;height:900px;left:0px;top:-90px;');
    expect(videoFitStyle(1600, 900, 1600, 720, { ...noCrop, top: Number.NaN }, true)).toBe(
      'width:1600px;height:900px;left:0px;top:-90px;');
    expect(videoFitStyle(Infinity, 900, 1600, 720, noCrop, true)).toBe('');
    expect(videoFitStyle(1600, 900, 0, 720, noCrop, true)).toBe('');
  });
});
