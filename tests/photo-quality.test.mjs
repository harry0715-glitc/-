import assert from 'node:assert/strict';
import test from 'node:test';
import { checkFaceGeometry, checkFaceQuality, measureFaceQuality } from '../photo-quality-rules.mjs';

const face = () => ({
  boundingBox: { originX: 90, originY: 90, width: 240, height: 270 },
  keypoints: [{ x: 0.38, y: 0.32 }, { x: 0.62, y: 0.32 }, { x: 0.5, y: 0.42 }, { x: 0.5, y: 0.52 }],
});

test('portrait geometry rejects missing/multiple faces, undersized and clipped faces', () => {
  assert.equal(checkFaceGeometry([], 420, 540).code, 'no-face');
  assert.equal(checkFaceGeometry([face(), face()], 420, 540).code, 'multiple-faces');
  assert.equal(checkFaceGeometry([face()], 420, 540).ok, true);
  const small = face();
  small.boundingBox.width = 80;
  assert.equal(checkFaceGeometry([small], 420, 540).code, 'small-face');
  const clipped = face();
  clipped.keypoints[0].x = 0;
  assert.equal(checkFaceGeometry([clipped], 420, 540).code, 'clipped-face');
  const profile = face();
  profile.keypoints[2].x = 0.8;
  assert.equal(checkFaceGeometry([profile], 420, 540).code, 'face-angle');
});

test('quality measurement distinguishes flat/blurred patches from detailed patches and extreme exposure', () => {
  const patch = (pixel) => ({ width: 128, height: 128, data: Uint8ClampedArray.from(
    { length: 128 * 128 * 4 }, (_, i) => i % 4 === 3 ? 255 : pixel(Math.floor(i / 4)),
  ) });
  assert.equal(checkFaceQuality(measureFaceQuality(patch(() => 125))).code, 'blur');
  assert.equal(checkFaceQuality(measureFaceQuality(patch(() => 5))).code, 'exposure');
  assert.equal(checkFaceQuality(measureFaceQuality(patch(() => 250))).code, 'exposure');
  assert.equal(checkFaceQuality(measureFaceQuality(patch(i => 100 + (i % 7) * 10))).ok, true);
  assert.equal(checkFaceQuality({ brightness: NaN, sharpness: NaN }).ok, false);
});
