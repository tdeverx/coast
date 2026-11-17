import { describe, expect, test } from 'bun:test';
import { noCrop, videoFitStyle } from '../src/lib/playback/crop';
describe('presentation crop', () => {
  test('fit preserves the full frame and crop fills using the actual content', () => {
    expect(videoFitStyle(1600, 900, 1600, 720, { ...noCrop, top: 0.1, bottom: 0.1 }, true)).toBe(
      'width:1600px;height:900px;left:0px;top:-90px;'
    );
    expect(videoFitStyle(1600, 900, 1600, 720, noCrop, false)).toBe(
      'width:1280px;height:720px;left:160px;top:0px;'
    );
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
