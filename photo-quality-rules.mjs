const failure = (code, message) => ({ ok: false, code, message });

export function checkFaceGeometry(detections, width, height) {
  if (!detections?.length) return failure('no-face', '無法辨識清楚的人臉，請正面拍攝，露出眼睛、鼻子與嘴巴後重試');
  if (detections.length !== 1) return failure('multiple-faces', '照片中有多張人臉，請裁切成只有本人或重新拍照');
  const face = detections[0];
  const box = face.boundingBox;
  const points = face.keypoints?.slice(0, 4);
  if (!box || !points || points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return failure('features', '無法確認臉部位置，請使用五官清楚的正面照片');
  }
  if (box.width / width < 0.3 || box.height / height < 0.3) {
    return failure('small-face', '人臉太小，請放大裁切，讓臉部靠近中央虛線框');
  }
  if (points.some(p => p.x < 0.025 || p.x > 0.975 || p.y < 0.025 || p.y > 0.975)
    || box.originX < -width * 0.05 || box.originX + box.width > width * 1.05
    || box.originY < -height * 0.05 || box.originY + box.height > height * 1.05) {
    return failure('clipped-face', '臉部超出照片範圍，請縮小或移動照片，保留完整五官');
  }
  const [first, second, nose] = points;
  const eyes = [first, second].sort((a, b) => a.x - b.x);
  const eyeWidth = (eyes[1].x - eyes[0].x) * width;
  const eyeRise = Math.abs(eyes[1].y - eyes[0].y) * height;
  if (eyeWidth < box.width * 0.22 || eyeRise > eyeWidth * 0.6
    || nose.x < eyes[0].x || nose.x > eyes[1].x) {
    return failure('face-angle', '臉部角度偏斜，請面向鏡頭並保持頭部端正');
  }
  return { ok: true, box };
}

// Measure only a normalized face patch so background texture cannot hide blur.
export function measureFaceQuality({ data, width, height }) {
  const gray = new Float64Array(width * height);
  let brightness = 0;
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    brightness += gray[i];
  }
  let sum = 0;
  let squared = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const laplacian = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      sum += laplacian;
      squared += laplacian * laplacian;
      count += 1;
    }
  }
  return { brightness: brightness / gray.length, sharpness: squared / count - (sum / count) ** 2 };
}

export function checkFaceQuality(metrics) {
  if (!Number.isFinite(metrics.brightness) || !Number.isFinite(metrics.sharpness)) {
    return failure('unreadable', '無法讀取照片，請重新拍照或選取圖片');
  }
  if (metrics.brightness < 25 || metrics.brightness > 245) {
    return failure('exposure', '臉部太暗或過曝，請換到光線均勻的位置重拍');
  }
  if (metrics.sharpness < 18) return failure('blur', '臉部影像太模糊，請擦拭鏡頭、對焦並保持手機穩定後重拍');
  return { ok: true };
}
