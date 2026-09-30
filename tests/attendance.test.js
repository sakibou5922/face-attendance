// 日付境界のテストを日本時間で行う（attendance.js は import 時に日付計算をしないので、ここで設定すれば効く）
process.env.TZ = 'Asia/Tokyo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRejectPunch, summarizeDaily, formatDuration, localDateKey,
  toCsv, monthRange, currentMonth, parseMonth,
} from '../js/attendance.js';

// 2026年9月の日本時間を ISO 文字列にする
const at = (day, h, m, s = 0) => new Date(2026, 8, day, h, m, s).toISOString();
const punch = (employeeId, type, timestamp) => ({ employeeId, type, timestamp });
const employees = [
  { id: 1, name: '山田', descriptors: [], createdAt: at(1, 8, 0) },
  { id: 2, name: '伊藤', descriptors: [], createdAt: at(1, 8, 0) },
];

test('shouldRejectPunch: 同じ人・同じ種別が59秒後なら拒否', () => {
  assert.equal(shouldRejectPunch([punch(1, 'in', at(1, 9, 0, 0))], punch(1, 'in', at(1, 9, 0, 59))), true);
});

test('shouldRejectPunch: 61秒後なら許可', () => {
  assert.equal(shouldRejectPunch([punch(1, 'in', at(1, 9, 0, 0))], punch(1, 'in', at(1, 9, 1, 1))), false);
});

test('shouldRejectPunch: 種別が違えば許可', () => {
  assert.equal(shouldRejectPunch([punch(1, 'in', at(1, 9, 0, 0))], punch(1, 'out', at(1, 9, 0, 10))), false);
});

test('shouldRejectPunch: 別の人なら許可', () => {
  assert.equal(shouldRejectPunch([punch(2, 'in', at(1, 9, 0, 0))], punch(1, 'in', at(1, 9, 0, 10))), false);
});

test('shouldRejectPunch: 既存の打刻がなければ許可', () => {
  assert.equal(shouldRejectPunch([], punch(1, 'in', at(1, 9, 0))), false);
});

test('formatDuration: 分単位で切り捨てて H:MM', () => {
  assert.equal(formatDuration((8 * 60 + 58) * 60000 + 59000), '8:58');
  assert.equal(formatDuration(5 * 60000), '0:05');
});

test('summarizeDaily: 通常の出勤・退勤', () => {
  const rows = summarizeDaily([punch(1, 'in', at(1, 9, 2)), punch(1, 'out', at(1, 18, 0))], employees);
  assert.deepEqual(rows, [
    { date: '2026-09-01', employeeId: 1, name: '山田', clockIn: '09:02', clockOut: '18:00', worked: '8:58' },
  ]);
});

test('summarizeDaily: 退勤なしなら退勤・勤務時間は null', () => {
  const [row] = summarizeDaily([punch(1, 'in', at(1, 9, 0))], employees);
  assert.equal(row.clockIn, '09:00');
  assert.equal(row.clockOut, null);
  assert.equal(row.worked, null);
});

test('summarizeDaily: 出勤なしなら出勤・勤務時間は null', () => {
  const [row] = summarizeDaily([punch(1, 'out', at(1, 18, 0))], employees);
  assert.equal(row.clockIn, null);
  assert.equal(row.clockOut, '18:00');
  assert.equal(row.worked, null);
});

test('summarizeDaily: 1日に複数回なら最初の出勤と最後の退勤', () => {
  const [row] = summarizeDaily([
    punch(1, 'out', at(1, 12, 0)),
    punch(1, 'in', at(1, 13, 0)),
    punch(1, 'in', at(1, 9, 0)),
    punch(1, 'out', at(1, 18, 30)),
  ], employees);
  assert.equal(row.clockIn, '09:00');
  assert.equal(row.clockOut, '18:30');
  assert.equal(row.worked, '9:30');
});

test('summarizeDaily: 退勤が出勤より前なら勤務時間は null（マイナスにしない）', () => {
  const [row] = summarizeDaily([punch(1, 'out', at(1, 8, 0)), punch(1, 'in', at(1, 9, 0))], employees);
  assert.equal(row.clockIn, '09:00');
  assert.equal(row.clockOut, '08:00');
  assert.equal(row.worked, null);
});

test('summarizeDaily: 日本時間0:30の打刻はその日の日付に入る（UTCの前日にならない）', () => {
  const ts = at(2, 0, 30);
  assert.equal(ts, '2026-09-01T15:30:00.000Z');
  const [row] = summarizeDaily([punch(1, 'in', ts)], employees);
  assert.equal(row.date, '2026-09-02');
  assert.equal(localDateKey(ts), '2026-09-02');
});

test('summarizeDaily: 登録されていない従業員の打刻は無視', () => {
  assert.deepEqual(summarizeDaily([punch(99, 'in', at(1, 9, 0))], employees), []);
});

test('summarizeDaily: 日付の昇順、同じ日は名前順', () => {
  const rows = summarizeDaily([
    punch(1, 'in', at(2, 9, 0)),
    punch(1, 'in', at(1, 9, 0)),
    punch(2, 'in', at(1, 9, 0)),
  ], employees);
  assert.deepEqual(rows.map((r) => `${r.date} ${r.name}`), ['2026-09-01 伊藤', '2026-09-01 山田', '2026-09-02 山田']);
});

const row = (overrides = {}) => ({
  date: '2026-09-01', employeeId: 1, name: '山田', clockIn: '09:02', clockOut: '18:00', worked: '8:58', ...overrides,
});

test('toCsv: BOM・ヘッダー・CRLF', () => {
  assert.equal(toCsv([row()]), '\uFEFF日付,名前,出勤,退勤,勤務時間\r\n2026-09-01,山田,09:02,18:00,8:58\r\n');
});

test('toCsv: 欠けている値は空欄', () => {
  assert.equal(toCsv([row({ clockOut: null, worked: null })]).split('\r\n')[1], '2026-09-01,山田,09:02,,');
});

test('toCsv: カンマ・ダブルクオート・改行を含む名前はクオートしてエスケープ', () => {
  const lines = toCsv([row({ name: '山田, "太郎"\n2号' })]);
  assert.ok(lines.includes('2026-09-01,"山田, ""太郎""\n2号",09:02'));
});

test('toCsv: = + - @ で始まる名前は先頭に \' を付けて数式にしない', () => {
  for (const name of ['=1+1', '+1', '-1', '@SUM(A1)']) {
    assert.equal(toCsv([row({ name })]).split('\r\n')[1].split(',')[1], `'${name}`);
  }
});

test('toCsv: 行がなければヘッダーのみ', () => {
  assert.equal(toCsv([]), '\uFEFF日付,名前,出勤,退勤,勤務時間\r\n');
});

test('monthRange: 日本時間の月初〜翌月初（翌月初は含まない）', () => {
  assert.deepEqual(monthRange('2026-09'), {
    from: '2026-08-31T15:00:00.000Z',
    to: '2026-09-30T15:00:00.000Z',
  });
});

test('monthRange: 12月は翌年1月1日まで', () => {
  assert.equal(monthRange('2026-12').to, '2026-12-31T15:00:00.000Z');
});

test('currentMonth: YYYY-MM', () => {
  assert.equal(currentMonth(new Date(2026, 0, 5)), '2026-01');
});

test('parseMonth: YYYY-MM と、よくある入力ゆれを YYYY-MM にそろえる', () => {
  assert.equal(parseMonth('2026-09'), '2026-09');
  assert.equal(parseMonth('2026-9'), '2026-09');
  assert.equal(parseMonth('2026/9'), '2026-09');
  assert.equal(parseMonth(' 2026年9月 '), '2026-09');
});

test('parseMonth: 解釈できない値は null', () => {
  for (const v of ['', '2026', '2026-13', '2026-00', 'abc', '26-09']) {
    assert.equal(parseMonth(v), null, v);
  }
});
