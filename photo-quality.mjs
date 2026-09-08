import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import { checkFaceGeometry, checkFaceQuality, measureFaceQuality } from './photo-quality-rules.mjs';

const simdLoader = new URL('./node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', import.meta.url).href;
const simdBinary = new URL('./node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', import.meta.url).href;
const basicLoader = new URL('./node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js', import.meta.url).href;
const basicBinary = new URL('./node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm', import.meta.url).href;
const modelUrl = new URL('./assets/blaze_face_short_range.tflite', import.meta.url).href;
let detectorPromise;

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const simd = await FilesetResolver.isSimdSupported();
      return FaceDetector.createFromOptions({
        wasmLoaderPath: simd ? simdLoader : basicLoader,
        wasmBinaryPath: simd ? simdBinary : basicBinary,
      }, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.65,
      });
    })().catch(error => { detectorPromise = undefined; throw error; });
  }
  return detectorPromise;
}

export async function inspectPhoto(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const detector = await getDetector();
  const { detections } = detector.detect(image);
  const geometry = checkFaceGeometry(detections, image.naturalWidth, image.naturalHeight);
  if (!geometry.ok) return geometry;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const box = geometry.box;
  // Exclude face-box edges (hair/background) from the clarity measurement.
  context.drawImage(image, box.originX + box.width * 0.12, box.originY + box.height * 0.12,
    box.width * 0.76, box.height * 0.76, 0, 0, 128, 128);
  const metrics = measureFaceQuality(context.getImageData(0, 0, 128, 128));
  return { ...checkFaceQuality(metrics), metrics };
}
