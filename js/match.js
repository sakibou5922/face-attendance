// 顔の特徴量の照合（face-api に依存しない純粋関数）

export const MATCH_THRESHOLD = 0.5;

export function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** 登録者の中で最も近い人。距離がしきい値以上なら null */
export function findBestMatch(descriptor, employees, threshold = MATCH_THRESHOLD) {
  let best = null;
  for (const employee of employees) {
    for (const saved of employee.descriptors) {
      const distance = euclideanDistance(descriptor, saved);
      if (!best || distance < best.distance) best = { employee, distance };
    }
  }
  return best && best.distance < threshold ? best : null;
}

const area = (d) => d.detection.box.width * d.detection.box.height;

/** 複数写っていたら一番大きい（手前の）顔 */
export function pickLargestFace(detections) {
  return detections.reduce((largest, d) => (area(d) > area(largest) ? d : largest), detections[0]) ?? null;
}
