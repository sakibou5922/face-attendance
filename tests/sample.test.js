process.env.TZ = 'Asia/Tokyo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSamplePunches, SAMPLE_NAMES, SAMPLE_DESCRIPTOR } from '../js/sample.js';
import { localDateKey } from '../js/attendance.js';

const now = new Date(2026, 8, 30, 12, 0); // 2026-09-30(水) 12:00

test('SAMPLE_NAMES は3名、SAMPLE_DESCRIPTOR は128次元', () => {
  assert.equal(SAMPLE_NAMES.length, 3);
  assert.equal(SAMPLE_DESCRIPTOR.length, 128);
});

test('buildSamplePunches: 9月の平日22日分（過去21日×出退勤×3名 + 今日の出勤3件）', () => {
  assert.equal(buildSamplePunches([1, 2, 3], now).length, 21 * 2 * 3 + 3);
});

test('buildSamplePunches: 土日を含まず、すべて今月・今以前', () => {
  for (const p of buildSamplePunches([1, 2, 3], now)) {
    const d = new Date(p.timestamp);
    assert.notEqual(d.getDay(), 0);
    assert.notEqual(d.getDay(), 6);
    assert.equal(d.getMonth(), 8);
    assert.ok(d <= now);
  }
});

test('buildSamplePunches: 過去日は出勤が退勤より前、今日は出勤のみ', () => {
  const punches = buildSamplePunches([1], now);
  const byDay = Object.groupBy(punches, (p) => localDateKey(p.timestamp));
  for (const [day, list] of Object.entries(byDay)) {
    if (day === '2026-09-30') {
      assert.deepEqual(list.map((p) => p.type), ['in']);
    } else {
      const inP = list.find((p) => p.type === 'in');
      const outP = list.find((p) => p.type === 'out');
      assert.ok(new Date(inP.timestamp) < new Date(outP.timestamp));
    }
  }
});

test('buildSamplePunches: 今日の出勤時刻より前なら今日の分はなし', () => {
  const early = new Date(2026, 8, 30, 8, 0);
  const punches = buildSamplePunches([1], early);
  assert.equal(punches.some((p) => localDateKey(p.timestamp) === '2026-09-30'), false);
});

test('buildSamplePunches: 同じ入力なら同じ結果', () => {
  assert.deepEqual(buildSamplePunches([1, 2], now), buildSamplePunches([1, 2], now));
});

test('buildSamplePunches: 出勤時刻が日ごと・人ごとにばらつく（デモで不自然にならない）', () => {
  const punches = buildSamplePunches([1, 2, 3], now).filter((p) => p.type === 'in');
  const minutes = (p) => new Date(p.timestamp).getHours() * 60 + new Date(p.timestamp).getMinutes();
  const month = punches.filter((p) => p.employeeId === 1).map(minutes);
  assert.ok(new Set(month).size >= 10, `1人の出勤時刻が月内で10通り以上ある（実際 ${new Set(month).size}）`);
  const firstWeek = punches.filter((p) => p.employeeId === 1).slice(0, 5).map(minutes);
  const sorted = [...firstWeek].sort((a, b) => a - b);
  assert.notDeepEqual(firstWeek, sorted, '日を追って単調に増えない');
});
