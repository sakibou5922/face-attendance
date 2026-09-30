// デモ用のサンプル打刻データ（純粋関数）

export const SAMPLE_NAMES = ['佐藤 花子', '鈴木 一郎', '高橋 美咲'];

/** 実在の顔の特徴量（おおむね ±0.3 の範囲）から遠く、決して一致しない値 */
export const SAMPLE_DESCRIPTOR = new Array(128).fill(10);

// 再現性のある簡易乱数（mulberry32。近い seed でも結果がよくばらつく）
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** 今月1日〜今日の平日の打刻。過去日は出勤+退勤、今日は出勤のみ */
export function buildSamplePunches(employeeIds, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const punches = [];
  for (let day = 1; day <= now.getDate(); day++) {
    const dow = new Date(y, m, day).getDay();
    if (dow === 0 || dow === 6) continue;
    const isToday = day === now.getDate();
    employeeIds.forEach((employeeId, i) => {
      const rand = seeded(day * 31 + i * 7 + 1);
      const inAt = new Date(y, m, day, 8, 45 + Math.floor(rand() * 25)); // 8:45〜9:09
      const outAt = new Date(y, m, day, 17, 50 + Math.floor(rand() * 50)); // 17:50〜18:39
      if (isToday) {
        if (inAt <= now) punches.push({ employeeId, type: 'in', timestamp: inAt.toISOString() });
        return;
      }
      punches.push({ employeeId, type: 'in', timestamp: inAt.toISOString() });
      punches.push({ employeeId, type: 'out', timestamp: outAt.toISOString() });
    });
  }
  return punches;
}
