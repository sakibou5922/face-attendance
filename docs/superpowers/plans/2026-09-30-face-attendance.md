# 顔認証 出退勤デモ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブラウザだけで動く、顔認証で出勤/退勤を打刻できるデモWebアプリ（打刻・従業員登録・勤怠一覧/CSV）を作る。

**Architecture:** ビルド不要の静的サイト（ES Modules）。顔認識は @vladmandic/face-api を CDN から動的 import してブラウザ内で実行し、データは IndexedDB に保存する。業務ロジック（打刻ルール・集計・CSV・照合）は DOM/DB 非依存の純粋関数に分離し、Node 標準の `node:test` でテストする。

**Tech Stack:** HTML / CSS / JavaScript (ES2022, ES Modules), @vladmandic/face-api 1.7.15 (jsDelivr CDN), IndexedDB, Node.js 24（テストとローカル配信のみ。外部npm依存なし）

**Spec:** `docs/superpowers/specs/2026-09-30-face-attendance-design.md`

## Global Constraints

- コスト0円: 有料API・サーバー・npm依存パッケージを使わない（ローカル配信も自作の `tools/serve.mjs`）。
- 顔認識ライブラリ: `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js`、モデル: `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/`
- 照合しきい値: ユークリッド距離 **0.5 未満** で本人。
- 二重打刻: 同じ人・同じ種別が **1分以内** なら記録しない。
- スキャン: 最大 **10秒**、**0.3秒** 間隔。成功表示は **3秒** で初期画面へ。
- 登録時の撮影は **3回**（正面／少し右／少し左）。
- 顔画像は保存しない。保存するのは特徴量（128次元の数値配列）のみ。
- CSV: UTF-8 **BOM付き**、列は「日付,名前,出勤,退勤,勤務時間」、改行 CRLF。
- 勤務時間は `H:MM`、休憩控除なし。欠けている値は画面では「—」、CSVでは空欄。
- ユーザー入力（名前）は必ず `textContent` で表示する（`innerHTML` に入れない）。
- 画面文言は日本語。
- このフォルダは Git 管理されていないため、各タスクにコミット手順はない（ユーザーの指示があれば追加する）。

## Review Focus

1. **退勤だけ／退勤が出勤より前の日** — 勤務時間はマイナスにならず「—」。→ Task 1 のテスト
2. **深夜0時台の打刻（JST）** — 保存は UTC の ISO 文字列だが、日付は日本時間の日付に入る（前日に入らない）。→ Task 1 のテスト（`TZ=Asia/Tokyo`）
3. **名前にカンマ・ダブルクオート・改行・先頭が `=` `+` `-` `@`** — CSV の列が崩れず、Excel で数式として実行されない。→ Task 2 のテスト
4. **名前に `<b>` や `<script>` を含む** — HTML として解釈されず文字として表示される。→ Task 7 の手動確認
5. **スキャン中にタブ切替／キャンセル／ボタン連打** — カメラが確実に止まり、二重に打刻処理が走らない。→ Task 8 の手動確認

---

## File Structure

```
face-attendance/
  package.json              テスト・起動スクリプト（依存なし）
  tools/serve.mjs           依存なしの静的ファイルサーバー（127.0.0.1:5181）
  index.html                骨組み（タブ + 3画面の枠）
  css/style.css
  js/
    app.js                  タブ切替・モデル事前読込・状態表示
    dom.js                  el() / sleep()
    attendance.js           打刻ルール・日別集計・CSV・月範囲（純粋関数）
    match.js                特徴量の照合・最大顔の選択（純粋関数）
    errors.js               エラー → 日本語メッセージ（純粋関数）
    sample.js               サンプル打刻データ生成（純粋関数）
    face.js                 face-api 読込・カメラ・特徴量抽出（ブラウザ専用）
    store.js                IndexedDB（ブラウザ専用）
    views/punch.js          打刻画面
    views/register.js       従業員登録画面
    views/records.js        勤怠一覧画面
  tests/
    attendance.test.js
    match.test.js
    errors.test.js
    sample.test.js
```

設計書からの差分: 照合処理・エラーメッセージを `face.js` から `match.js` / `errors.js` に切り出した（CDN import を含む face.js は Node でテストできないため）。face.js の公開関数は設計書どおり。

各ビューモジュールは共通で `mount(root: HTMLElement)`, `show()`, `hide()` を export する。

---

### Task 1: プロジェクト雛形 + 打刻ルールと日別集計

**Files:**
- Create: `face-attendance/package.json`
- Create: `face-attendance/tools/serve.mjs`
- Create: `face-attendance/js/attendance.js`
- Test: `face-attendance/tests/attendance.test.js`

**Interfaces:**
- Produces:
  - `DUPLICATE_WINDOW_MS: number` (= 60000)
  - `localDateKey(date: Date|string) => 'YYYY-MM-DD'`（ローカル時刻）
  - `localTime(date: Date|string|number) => 'HH:MM'`
  - `formatDuration(ms: number) => 'H:MM'`
  - `shouldRejectPunch(existingPunches: Punch[], newPunch: Punch) => boolean`
  - `summarizeDaily(punches: Punch[], employees: Employee[]) => DailyRow[]`
  - 型: `Punch = {employeeId:number, type:'in'|'out', timestamp:string(ISO)}`、`Employee = {id:number, name:string, descriptors:number[][], createdAt:string, sample?:boolean}`、`DailyRow = {date:string, employeeId:number, name:string, clockIn:string|null, clockOut:string|null, worked:string|null}`

- [ ] **Step 1: package.json とサーバーを作る**

`face-attendance/package.json`:
```json
{
  "name": "face-attendance",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/*.test.js\"",
    "start": "node tools/serve.mjs"
  }
}
```

`face-attendance/tools/serve.mjs`:
```js
// 依存なしの静的ファイルサーバー（ローカル確認用）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT) || 5181;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const filePath = resolve(join(root, urlPath.endsWith('/') ? `${urlPath}index.html` : urlPath));
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}/`);
});
```

- [ ] **Step 2: 失敗するテストを書く**

`face-attendance/tests/attendance.test.js`:
```js
// 日付境界のテストを日本時間で行う（attendance.js は import 時に日付計算をしないので、ここで設定すれば効く）
process.env.TZ = 'Asia/Tokyo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRejectPunch, summarizeDaily, formatDuration, localDateKey } from '../js/attendance.js';

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
```

- [ ] **Step 3: テストが失敗することを確認**

Run（`face-attendance/` で）: `npm test`
Expected: FAIL（`Cannot find module '.../js/attendance.js'`）

- [ ] **Step 4: 実装する**

`face-attendance/js/attendance.js`:
```js
// 打刻ルール・日別集計・CSV生成（DOM / DB に依存しない純粋関数）

export const DUPLICATE_WINDOW_MS = 60 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

/** ローカル時刻での日付 'YYYY-MM-DD' */
export function localDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** ローカル時刻 'HH:MM' */
export function localTime(date) {
  const d = new Date(date);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** ミリ秒 → 'H:MM'（分未満切り捨て） */
export function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  return `${Math.floor(totalMinutes / 60)}:${pad2(totalMinutes % 60)}`;
}

/** 同じ人・同じ種別の打刻が1分以内にあれば true */
export function shouldRejectPunch(existingPunches, newPunch) {
  const newTime = new Date(newPunch.timestamp).getTime();
  return existingPunches.some((p) => {
    if (p.employeeId !== newPunch.employeeId || p.type !== newPunch.type) return false;
    const diff = newTime - new Date(p.timestamp).getTime();
    return diff >= 0 && diff < DUPLICATE_WINDOW_MS;
  });
}

/** 打刻を「日付×従業員」ごとに集計する。出勤=最初の in、退勤=最後の out */
export function summarizeDaily(punches, employees) {
  const names = new Map(employees.map((e) => [e.id, e.name]));
  const groups = new Map();
  for (const p of punches) {
    if (!names.has(p.employeeId)) continue;
    const date = localDateKey(p.timestamp);
    const key = `${date}|${p.employeeId}`;
    if (!groups.has(key)) groups.set(key, { date, employeeId: p.employeeId, firstIn: null, lastOut: null });
    const g = groups.get(key);
    const t = new Date(p.timestamp).getTime();
    if (p.type === 'in' && (g.firstIn === null || t < g.firstIn)) g.firstIn = t;
    if (p.type === 'out' && (g.lastOut === null || t > g.lastOut)) g.lastOut = t;
  }
  return [...groups.values()]
    .map((g) => ({
      date: g.date,
      employeeId: g.employeeId,
      name: names.get(g.employeeId),
      clockIn: g.firstIn === null ? null : localTime(g.firstIn),
      clockOut: g.lastOut === null ? null : localTime(g.lastOut),
      worked: g.firstIn !== null && g.lastOut !== null && g.lastOut > g.firstIn
        ? formatDuration(g.lastOut - g.firstIn)
        : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ja'));
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS（14 tests）

- [ ] **Step 6: サーバーが起動することを確認**

Run: `node tools/serve.mjs`（バックグラウンド）→ `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5181/package.json` → `200`、`http://127.0.0.1:5181/../x` 相当のパス外アクセスが 403 または 404 であること。確認後に停止。

---

### Task 2: CSV 生成と月の範囲

**Files:**
- Modify: `face-attendance/js/attendance.js`（末尾に追記）
- Test: `face-attendance/tests/attendance.test.js`（末尾に追記）

**Interfaces:**
- Consumes: `DailyRow`（Task 1）
- Produces:
  - `toCsv(rows: DailyRow[]) => string`（BOM付き、CRLF、末尾改行あり）
  - `monthRange('YYYY-MM') => {from: ISO, to: ISO}`（from 含む・to 含まない、ローカル時刻の月初）
  - `currentMonth(now?: Date) => 'YYYY-MM'`

- [ ] **Step 1: 失敗するテストを追記**

`tests/attendance.test.js` の import 行を次に置き換える:
```js
import {
  shouldRejectPunch, summarizeDaily, formatDuration, localDateKey,
  toCsv, monthRange, currentMonth,
} from '../js/attendance.js';
```

ファイル末尾に追記:
```js
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL（`toCsv` などが export されていない SyntaxError）

- [ ] **Step 3: 実装を追記**

`js/attendance.js` の末尾に追記:
```js
const CSV_HEADER = ['日付', '名前', '出勤', '退勤', '勤務時間'];

function csvField(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // Excel に数式として解釈させない
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 日別集計の行 → CSV（UTF-8 BOM付き、CRLF） */
export function toCsv(rows) {
  const lines = [CSV_HEADER, ...rows.map((r) => [r.date, r.name, r.clockIn, r.clockOut, r.worked])];
  return `\uFEFF${lines.map((cols) => cols.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/** 'YYYY-MM' → その月の範囲（ローカル時刻の月初。to は含まない） */
export function monthRange(yyyyMm) {
  const [y, m] = yyyyMm.split('-').map(Number);
  return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS（22 tests）

---

### Task 3: 照合ロジックとエラーメッセージ

**Files:**
- Create: `face-attendance/js/match.js`
- Create: `face-attendance/js/errors.js`
- Test: `face-attendance/tests/match.test.js`, `face-attendance/tests/errors.test.js`

**Interfaces:**
- Consumes: `Employee`（Task 1）
- Produces:
  - `MATCH_THRESHOLD = 0.5`
  - `euclideanDistance(a: number[], b: number[]) => number`
  - `findBestMatch(descriptor: number[], employees: Employee[], threshold?: number) => {employee: Employee, distance: number} | null`
  - `pickLargestFace(detections: {detection:{box:{width,height}}}[]) => detection | null`
  - `errorMessage(err: unknown) => string`
  - `namedError(name: string, message?: string) => Error`（`err.name` を設定した Error）

- [ ] **Step 1: 失敗するテストを書く**

`face-attendance/tests/match.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euclideanDistance, findBestMatch, pickLargestFace, MATCH_THRESHOLD } from '../js/match.js';

// 128次元のうち先頭だけ値を持つベクトル
const vec = (first) => [first, ...new Array(127).fill(0)];
const emp = (id, ...firsts) => ({ id, name: `社員${id}`, descriptors: firsts.map(vec), createdAt: '' });

test('MATCH_THRESHOLD は 0.5', () => {
  assert.equal(MATCH_THRESHOLD, 0.5);
});

test('euclideanDistance', () => {
  assert.equal(euclideanDistance([0, 0], [3, 4]), 5);
});

test('findBestMatch: 最も近い人を返す（各人の複数特徴量のうち最小距離で比較）', () => {
  const result = findBestMatch(vec(0), [emp(1, 0.4, 0.9), emp(2, 0.2)]);
  assert.equal(result.employee.id, 2);
  assert.ok(Math.abs(result.distance - 0.2) < 1e-9);
});

test('findBestMatch: 最小距離が 0.5 ちょうどなら一致しない', () => {
  assert.equal(findBestMatch(vec(0), [emp(1, 0.5)]), null);
});

test('findBestMatch: 0.5 未満なら一致', () => {
  assert.equal(findBestMatch(vec(0), [emp(1, 0.49)]).employee.id, 1);
});

test('findBestMatch: 従業員がいなければ null', () => {
  assert.equal(findBestMatch(vec(0), []), null);
});

test('pickLargestFace: 面積が最大の顔', () => {
  const face = (w, h) => ({ detection: { box: { width: w, height: h } } });
  const big = face(100, 120);
  assert.equal(pickLargestFace([face(50, 50), big, face(90, 90)]), big);
});

test('pickLargestFace: 空なら null', () => {
  assert.equal(pickLargestFace([]), null);
});
```

`face-attendance/tests/errors.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage, namedError } from '../js/errors.js';

test('namedError: name が設定される', () => {
  const err = namedError('ModelLoadError', 'x');
  assert.equal(err.name, 'ModelLoadError');
  assert.equal(err.message, 'x');
});

test('errorMessage: カメラ拒否', () => {
  assert.match(errorMessage(namedError('NotAllowedError')), /カメラの使用を許可してください/);
});

test('errorMessage: カメラなし', () => {
  assert.equal(errorMessage(namedError('NotFoundError')), 'カメラが見つかりません。');
});

test('errorMessage: モデル読込失敗', () => {
  assert.equal(errorMessage(namedError('ModelLoadError')), '顔認識の準備に失敗しました。通信環境を確認して再読み込みしてください。');
});

test('errorMessage: https でない', () => {
  assert.match(errorMessage(namedError('InsecureContextError')), /https/);
});

test('errorMessage: 不明なエラーや undefined でも落ちない', () => {
  assert.match(errorMessage(new Error('?')), /予期しないエラー/);
  assert.match(errorMessage(undefined), /予期しないエラー/);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL（`match.js` / `errors.js` が見つからない）

- [ ] **Step 3: 実装する**

`face-attendance/js/match.js`:
```js
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
```

`face-attendance/js/errors.js`:
```js
// エラー → 画面に出す日本語メッセージ

export function namedError(name, message = '') {
  const err = new Error(message);
  err.name = name;
  return err;
}

export function errorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'カメラの使用を許可してください。アドレスバーのカメラアイコンから許可できます。';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'カメラが見つかりません。';
    case 'NotReadableError':
      return 'カメラを他のアプリが使用中です。他のアプリを閉じてからお試しください。';
    case 'InsecureContextError':
      return 'カメラを使うには https のページで開いてください。';
    case 'ModelLoadError':
      return '顔認識の準備に失敗しました。通信環境を確認して再読み込みしてください。';
    default:
      return '予期しないエラーが発生しました。再読み込みしてください。';
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS（36 tests）

---

### Task 4: サンプルデータ生成

**Files:**
- Create: `face-attendance/js/sample.js`
- Test: `face-attendance/tests/sample.test.js`

**Interfaces:**
- Consumes: `localDateKey`（Task 1）
- Produces:
  - `SAMPLE_NAMES: string[]`（3名）
  - `SAMPLE_DESCRIPTOR: number[]`（128次元、全要素 10。実在の顔とは一致しない）
  - `buildSamplePunches(employeeIds: number[], now?: Date) => Punch[]` — 今月1日〜今日の平日。過去日は出勤+退勤、今日は出勤のみ（`now` より後の時刻は含めない）。同じ入力なら同じ結果。

- [ ] **Step 1: 失敗するテストを書く**

`face-attendance/tests/sample.test.js`:
```js
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL（`sample.js` が見つからない）

- [ ] **Step 3: 実装する**

`face-attendance/js/sample.js`:
```js
// デモ用のサンプル打刻データ（純粋関数）

export const SAMPLE_NAMES = ['佐藤 花子', '鈴木 一郎', '高橋 美咲'];

/** 実在の顔の特徴量（おおむね ±0.3 の範囲）から遠く、決して一致しない値 */
export const SAMPLE_DESCRIPTOR = new Array(128).fill(10);

// 再現性のある簡易乱数（線形合同法）
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test`
Expected: PASS（42 tests）

---

### Task 5: IndexedDB ストア

**Files:**
- Create: `face-attendance/js/store.js`

**Interfaces:**
- Consumes: `SAMPLE_NAMES`, `SAMPLE_DESCRIPTOR`, `buildSamplePunches`（Task 4）
- Produces（すべて Promise を返す）:
  - `listEmployees() => Employee[]`
  - `addEmployee({name, descriptors}) => id:number`
  - `deleteEmployee(id) => void`（その人の打刻も削除）
  - `addPunch({employeeId, type, timestamp}) => id:number`
  - `listPunches({from, to}) => Punch[]`（from ≤ timestamp < to、ISO文字列で比較）
  - `seedSampleData(now?: Date) => boolean`（投入済みなら false）

IndexedDB はブラウザ専用のため自動テストはせず、Task 6 以降のブラウザで確認する。

- [ ] **Step 1: 実装する**

`face-attendance/js/store.js`:
```js
// データ保存（IndexedDB）。製品版ではここをサーバー保存に差し替える
import { SAMPLE_NAMES, SAMPLE_DESCRIPTOR, buildSamplePunches } from './sample.js';

const DB_NAME = 'face-attendance';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('employees', { keyPath: 'id', autoIncrement: true });
      const punches = db.createObjectStore('punches', { keyPath: 'id', autoIncrement: true });
      punches.createIndex('employeeId', 'employeeId');
      punches.createIndex('timestamp', 'timestamp');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const completed = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export async function listEmployees() {
  const db = await openDb();
  return request(db.transaction('employees').objectStore('employees').getAll());
}

export async function addEmployee({ name, descriptors }) {
  const db = await openDb();
  const tx = db.transaction('employees', 'readwrite');
  const done = completed(tx);
  const id = await request(tx.objectStore('employees').add({ name, descriptors, createdAt: new Date().toISOString() }));
  await done;
  return id;
}

export async function deleteEmployee(id) {
  const db = await openDb();
  const tx = db.transaction(['employees', 'punches'], 'readwrite');
  const done = completed(tx);
  tx.objectStore('employees').delete(id);
  const punches = tx.objectStore('punches');
  const keys = await request(punches.index('employeeId').getAllKeys(id));
  for (const key of keys) punches.delete(key);
  await done;
}

export async function addPunch({ employeeId, type, timestamp }) {
  const db = await openDb();
  const tx = db.transaction('punches', 'readwrite');
  const done = completed(tx);
  const id = await request(tx.objectStore('punches').add({ employeeId, type, timestamp }));
  await done;
  return id;
}

export async function listPunches({ from, to }) {
  const db = await openDb();
  const range = IDBKeyRange.bound(from, to, false, true);
  return request(db.transaction('punches').objectStore('punches').index('timestamp').getAll(range));
}

/** サンプルの従業員3名と今月の打刻を入れる。投入済みなら何もせず false */
export async function seedSampleData(now = new Date()) {
  if ((await listEmployees()).some((e) => e.sample)) return false;
  const db = await openDb();
  const tx = db.transaction(['employees', 'punches'], 'readwrite');
  const done = completed(tx);
  const employees = tx.objectStore('employees');
  const ids = [];
  for (const name of SAMPLE_NAMES) {
    ids.push(await request(employees.add({ name, descriptors: [SAMPLE_DESCRIPTOR], createdAt: now.toISOString(), sample: true })));
  }
  const punches = tx.objectStore('punches');
  for (const p of buildSamplePunches(ids, now)) punches.add(p);
  await done;
  return true;
}
```

- [ ] **Step 2: 既存テストが壊れていないことを確認**

Run: `npm test`
Expected: PASS（42 tests）。store.js 自体の動作確認は Task 6 Step 5 で行う。

---

### Task 6: 顔認識モジュールとアプリの骨組み

**Files:**
- Create: `face-attendance/js/face.js`
- Create: `face-attendance/js/dom.js`
- Create: `face-attendance/js/app.js`
- Create: `face-attendance/index.html`
- Create: `face-attendance/css/style.css`
- Create（仮実装。Task 7〜9 で置き換える）: `face-attendance/js/views/punch.js`, `face-attendance/js/views/register.js`, `face-attendance/js/views/records.js`
- Modify: `<作業フォルダ>/.claude/launch.json`（`face-attendance` 構成を追加）

**Interfaces:**
- Consumes: `pickLargestFace`（Task 3）, `namedError`, `errorMessage`（Task 3）
- Produces:
  - face.js: `loadModels() => Promise<void>`（失敗時 `ModelLoadError`。何度呼んでも読込は1回、失敗後は再試行可）, `startCamera(video) => Promise<void>`, `stopCamera(video?) => void`, `detectDescriptor(video) => Promise<number[] | null>`
  - dom.js: `el(tag, props?, children?) => HTMLElement`（props: `class` / `text`（textContent）/ `onXxx`（イベント）/ その他は属性）, `sleep(ms) => Promise<void>`
  - ビュー共通: `mount(root)`, `show()`, `hide()`

- [ ] **Step 1: face.js と dom.js を作る**

`face-attendance/js/face.js`:
```js
// カメラ・顔の特徴量抽出（ブラウザ専用）。製品版で別方式に差し替える場合はこのファイルを置き換える
import { pickLargestFace } from './match.js';
import { namedError } from './errors.js';

const FACE_API_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';

let faceapi = null;
let modelsPromise = null;
let stream = null;

/** face-api 本体とモデルを読み込む（1回だけ。失敗したら次回呼び出しで再試行） */
export function loadModels() {
  modelsPromise ??= (async () => {
    const api = await import(FACE_API_URL);
    await api.tf.ready();
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    faceapi = api;
  })().catch((err) => {
    modelsPromise = null;
    throw namedError('ModelLoadError', String(err));
  });
  return modelsPromise;
}

export async function startCamera(videoEl) {
  if (!navigator.mediaDevices?.getUserMedia) throw namedError('InsecureContextError');
  stopCamera(videoEl);
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();
}

export function stopCamera(videoEl) {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (videoEl) videoEl.srcObject = null;
}

/** 映像から一番大きい顔の特徴量（128次元）を返す。顔がなければ null */
export async function detectDescriptor(videoEl) {
  await loadModels();
  const results = await faceapi
    .detectAllFaces(videoEl, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  const face = pickLargestFace(results);
  return face ? Array.from(face.descriptor) : null;
}
```

`face-attendance/js/dom.js`:
```js
// 小さな DOM ヘルパー。ユーザー入力は必ず text（textContent）で渡す
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  node.append(...[].concat(children));
  return node;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

- [ ] **Step 2: index.html と app.js、仮のビューを作る**

`face-attendance/index.html`:
```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>顔認証 出退勤</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="app-header">
    <h1 class="app-title">顔認証 出退勤</h1>
    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" data-view="punch" aria-selected="true">打刻</button>
      <button class="tab" role="tab" data-view="register" aria-selected="false">従業員登録</button>
      <button class="tab" role="tab" data-view="records" aria-selected="false">勤怠一覧</button>
    </nav>
  </header>
  <main class="app-main">
    <section id="view-punch" class="view"></section>
    <section id="view-register" class="view" hidden></section>
    <section id="view-records" class="view" hidden></section>
  </main>
  <div id="model-status" class="model-status" role="status">顔認識を準備中…</div>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

`face-attendance/js/app.js`:
```js
import { loadModels } from './face.js';
import { errorMessage } from './errors.js';
import * as punchView from './views/punch.js';
import * as registerView from './views/register.js';
import * as recordsView from './views/records.js';

const views = { punch: punchView, register: registerView, records: recordsView };
const section = (name) => document.getElementById(`view-${name}`);
let current = 'punch';

for (const [name, view] of Object.entries(views)) view.mount(section(name));

function switchTo(name) {
  if (name === current) return;
  views[current].hide();
  section(current).hidden = true;
  current = name;
  section(current).hidden = false;
  views[current].show();
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === name));
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => switchTo(tab.dataset.view));
}
views[current].show();

// 初回の打刻を速くするため、起動時にモデルを読み込んでおく
const status = document.getElementById('model-status');
loadModels()
  .then(() => {
    status.textContent = '顔認識の準備ができました';
    status.classList.add('ready');
    setTimeout(() => { status.hidden = true; }, 2000);
  })
  .catch((err) => {
    status.textContent = errorMessage(err);
    status.classList.add('error');
  });
```

仮のビュー（3ファイルとも同じ内容。見出しだけ変える）:

`face-attendance/js/views/punch.js`:
```js
export function mount(root) { root.textContent = '打刻（準備中）'; }
export function show() {}
export function hide() {}
```
`face-attendance/js/views/register.js`:
```js
export function mount(root) { root.textContent = '従業員登録（準備中）'; }
export function show() {}
export function hide() {}
```
`face-attendance/js/views/records.js`:
```js
export function mount(root) { root.textContent = '勤怠一覧（準備中）'; }
export function show() {}
export function hide() {}
```

- [ ] **Step 3: スタイルを作る**

`face-attendance/css/style.css`:
```css
:root {
  --bg: #f5f6f8;
  --surface: #ffffff;
  --text: #1d2330;
  --muted: #667085;
  --border: #d9dde5;
  --primary: #2556d9;
  --in: #0f8a5f;
  --out: #c2410c;
  --ok-bg: #e7f6ef;
  --warn-bg: #fff4e0;
  --error: #b42318;
  --error-bg: #fdecea;
  --radius: 12px;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif;
  line-height: 1.6;
}

button { font: inherit; cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: 0.5; }
[hidden] { display: none !important; }

.app-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.app-title { margin: 0; font-size: 1.15rem; }

.tabs { display: flex; gap: 4px; }
.tab {
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--text);
}
.tab[aria-selected="true"] { background: var(--primary); border-color: var(--primary); color: #fff; }

.app-main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }

.model-status {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--text);
  color: #fff;
  font-size: 0.9rem;
  max-width: calc(100% - 32px);
}
.model-status.ready { background: var(--in); }
.model-status.error { background: var(--error); }

.btn-primary, .btn-secondary, .btn-danger {
  padding: 10px 18px;
  border-radius: 8px;
  border: 1px solid var(--primary);
}
.btn-primary { background: var(--primary); color: #fff; }
.btn-secondary { background: var(--surface); color: var(--primary); }
.btn-danger { background: var(--surface); color: var(--error); border-color: var(--error); padding: 4px 12px; }

.message { padding: 10px 14px; border-radius: 8px; margin: 12px 0; }
.message.ok { background: var(--ok-bg); color: var(--in); }
.message.error { background: var(--error-bg); color: var(--error); }

.camera {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.camera video {
  width: 100%;
  max-width: 560px;
  aspect-ratio: 4 / 3;
  background: #000;
  border-radius: var(--radius);
  transform: scaleX(-1); /* 鏡のように表示 */
  object-fit: cover;
}
.hint { margin: 0; font-size: 1.1rem; font-weight: 600; text-align: center; }
.camera-actions { display: flex; gap: 8px; }

/* 打刻 */
.punch { display: flex; flex-direction: column; align-items: center; gap: 24px; }
.clock { font-size: 2.5rem; font-weight: 700; font-variant-numeric: tabular-nums; text-align: center; }
.clock small { display: block; font-size: 1rem; font-weight: 400; color: var(--muted); }
.punch-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; width: 100%; max-width: 560px; }
.btn-punch {
  padding: 40px 0;
  border: none;
  border-radius: var(--radius);
  color: #fff;
  font-size: 2rem;
  font-weight: 700;
}
.btn-punch.in { background: var(--in); }
.btn-punch.out { background: var(--out); }
.result {
  width: 100%;
  max-width: 560px;
  padding: 40px 16px;
  border-radius: var(--radius);
  text-align: center;
  cursor: pointer;
}
.result.ok { background: var(--ok-bg); color: var(--in); }
.result.warn { background: var(--warn-bg); color: var(--out); }
.result.error { background: var(--error-bg); color: var(--error); }
.result-title { margin: 0; font-size: 2rem; font-weight: 700; }
.result-detail { margin: 8px 0 0; font-size: 1.5rem; }

/* 従業員登録 */
.register-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.register-form label { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
.register-form input { padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; font: inherit; min-width: 240px; }
.shots { display: flex; gap: 8px; }
.shot { width: 14px; height: 14px; border-radius: 50%; background: var(--border); }
.shot.done { background: var(--in); }
.employee-list { list-style: none; padding: 0; margin: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.employee-list li { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--border); }
.employee-list li:first-child { border-top: none; }
.employee-name { font-weight: 600; flex: 1; overflow-wrap: anywhere; }
.employee-date { color: var(--muted); font-size: 0.9rem; }
.badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; background: var(--border); color: var(--muted); }
.empty { color: var(--muted); padding: 12px 16px; }

/* 勤怠一覧 */
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
.toolbar input { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; font: inherit; }
.table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { background: var(--bg); font-size: 0.9rem; color: var(--muted); }
td.num { font-variant-numeric: tabular-nums; }

@media (max-width: 600px) {
  .app-header { flex-direction: column; align-items: stretch; }
  .tabs { justify-content: space-between; }
  .tab { flex: 1; padding: 8px 4px; }
  .btn-punch { padding: 28px 0; font-size: 1.6rem; }
  .clock { font-size: 2rem; }
}
```

- [ ] **Step 4: launch.json に構成を追加**

`<作業フォルダ>/.claude/launch.json` の `configurations` 配列末尾に追加:
```json
    {
      "name": "face-attendance",
      "runtimeExecutable": "node",
      "runtimeArgs": ["<作業フォルダ>/face-attendance/tools/serve.mjs"],
      "cwd": "<作業フォルダ>/face-attendance",
      "port": 5181,
      "autoPort": false
    }
```

- [ ] **Step 5: ブラウザで確認**

`preview_start {name: "face-attendance"}` →
1. コンソールにエラーがない。3つのタブが切り替わる。
2. 数秒後に「顔認識の準備ができました」が出る（`read_page` で確認）。
3. `javascript_tool` で store.js を確認:
```js
const s = await import('/js/store.js');
const id = await s.addEmployee({ name: 'テスト', descriptors: [[1, 2]] });
await s.addPunch({ employeeId: id, type: 'in', timestamp: new Date().toISOString() });
const before = (await s.listPunches({ from: '2000-01-01', to: '2100-01-01' })).length;
await s.deleteEmployee(id);
const after = (await s.listPunches({ from: '2000-01-01', to: '2100-01-01' })).length;
({ before, after, employees: (await s.listEmployees()).length, seeded: await s.seedSampleData(), seededAgain: await s.seedSampleData() });
```
Expected: `before - after === 1`、`seeded: true`、`seededAgain: false`。確認後 `indexedDB.deleteDatabase('face-attendance')` して再読み込み。

---

### Task 7: 従業員登録画面

**Files:**
- Modify（全体を置き換え）: `face-attendance/js/views/register.js`

**Interfaces:**
- Consumes: `loadModels`, `startCamera`, `stopCamera`, `detectDescriptor`（Task 6）, `listEmployees`, `addEmployee`, `deleteEmployee`（Task 5）, `errorMessage`（Task 3）, `el`（Task 6）
- Produces: `mount(root)`, `show()`, `hide()`

- [ ] **Step 1: 実装する**

`face-attendance/js/views/register.js`:
```js
import { loadModels, startCamera, stopCamera, detectDescriptor } from '../face.js';
import { listEmployees, addEmployee, deleteEmployee } from '../store.js';
import { localDateKey } from '../attendance.js';
import { errorMessage } from '../errors.js';
import { el } from '../dom.js';

const PROMPTS = ['正面を向いてください', '少し右を向いてください', '少し左を向いてください'];

let form, nameInput, message, camera, video, hint, shots, captureBtn, list;
let pendingName = null; // 撮影中の名前（撮影していなければ null）
let descriptors = [];
let capturing = false;

export function mount(root) {
  root.innerHTML = `
    <div class="register">
      <form class="register-form" data-form novalidate>
        <label>名前<input name="name" maxlength="40" autocomplete="off" placeholder="例：山田 太郎"></label>
        <button type="submit" class="btn-primary">撮影開始</button>
      </form>
      <p class="message" data-message hidden></p>
      <div class="camera" data-camera hidden>
        <video playsinline muted></video>
        <p class="hint" data-hint></p>
        <div class="shots" data-shots></div>
        <div class="camera-actions">
          <button type="button" class="btn-primary" data-capture>撮影</button>
          <button type="button" class="btn-secondary" data-cancel>キャンセル</button>
        </div>
      </div>
      <h2>登録済みの従業員</h2>
      <ul class="employee-list" data-list></ul>
    </div>`;
  form = root.querySelector('[data-form]');
  nameInput = form.querySelector('input');
  message = root.querySelector('[data-message]');
  camera = root.querySelector('[data-camera]');
  video = camera.querySelector('video');
  hint = root.querySelector('[data-hint]');
  shots = root.querySelector('[data-shots]');
  captureBtn = root.querySelector('[data-capture]');
  list = root.querySelector('[data-list]');

  form.addEventListener('submit', onStart);
  captureBtn.addEventListener('click', onCapture);
  root.querySelector('[data-cancel]').addEventListener('click', () => { reset(); showMessage(null); });
}

export function show() {
  renderList();
}

export function hide() {
  reset();
  showMessage(null);
}

async function onStart(event) {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return showMessage('error', '名前を入力してください');
  if ((await listEmployees()).some((e) => e.name === name)) {
    return showMessage('error', '同じ名前の従業員がすでに登録されています');
  }
  showMessage(null);
  pendingName = name;
  descriptors = [];
  form.hidden = true;
  camera.hidden = false;
  captureBtn.disabled = true;
  hint.textContent = 'カメラを準備中…';
  renderShots();
  try {
    await loadModels();
    await startCamera(video);
    if (pendingName === null) { stopCamera(video); return; } // 準備中にキャンセルされた
    updatePrompt();
    captureBtn.disabled = false;
  } catch (err) {
    reset();
    showMessage('error', errorMessage(err));
  }
}

async function onCapture() {
  if (capturing || pendingName === null) return;
  capturing = true;
  captureBtn.disabled = true;
  try {
    const descriptor = await detectDescriptor(video);
    if (pendingName === null) return;
    if (!descriptor) {
      hint.textContent = `顔が見つかりません。明るい場所でカメラに顔を向けてください（${descriptors.length + 1}/3枚目：${PROMPTS[descriptors.length]}）`;
      return;
    }
    descriptors.push(descriptor);
    renderShots();
    if (descriptors.length < PROMPTS.length) { updatePrompt(); return; }
    const name = pendingName;
    await addEmployee({ name, descriptors });
    reset();
    nameInput.value = '';
    showMessage('ok', `${name}さんを登録しました`);
    await renderList();
  } catch (err) {
    reset();
    showMessage('error', errorMessage(err));
  } finally {
    capturing = false;
    if (pendingName !== null) captureBtn.disabled = false;
  }
}

function updatePrompt() {
  hint.textContent = `${descriptors.length + 1}/3枚目：${PROMPTS[descriptors.length]}`;
}

function renderShots() {
  shots.replaceChildren(...PROMPTS.map((_, i) => el('span', { class: i < descriptors.length ? 'shot done' : 'shot' })));
}

function reset() {
  pendingName = null;
  descriptors = [];
  stopCamera(video);
  camera.hidden = true;
  form.hidden = false;
}

function showMessage(kind, text = '') {
  message.hidden = !kind;
  message.className = `message ${kind ?? ''}`;
  message.textContent = text;
}

async function renderList() {
  const employees = await listEmployees();
  if (employees.length === 0) {
    list.replaceChildren(el('li', { class: 'empty', text: 'まだ登録されていません' }));
    return;
  }
  list.replaceChildren(...employees.map((e) => el('li', {}, [
    el('span', { class: 'employee-name', text: e.name }),
    ...(e.sample ? [el('span', { class: 'badge', text: 'サンプル' })] : []),
    el('span', { class: 'employee-date', text: `登録日 ${localDateKey(e.createdAt)}` }),
    el('button', {
      class: 'btn-danger',
      type: 'button',
      text: '削除',
      onClick: async () => {
        if (!confirm(`${e.name}さんを削除しますか？打刻記録も削除されます。`)) return;
        await deleteEmployee(e.id);
        await renderList();
      },
    }),
  ])));
}
```

- [ ] **Step 2: ブラウザで確認**

preview を再読み込みして「従業員登録」タブ:
1. 名前空欄で「撮影開始」→「名前を入力してください」。
2. 「撮影開始」→ ブラウザ枠にカメラがなければ「カメラが見つかりません。」等のエラーが出て、フォームに戻る（カメラが使える環境なら撮影3回→登録→一覧に出る）。
3. **Review Focus 4**: `javascript_tool` で `(await import('/js/store.js')).addEmployee({ name: '<b>太字</b><img src=x onerror=alert(1)>', descriptors: [] })` → タブを切り替えて戻り、一覧にタグが**文字のまま**表示され、alert が出ないこと。確認後その従業員を削除。
4. 同じ名前をもう一度登録しようとすると「同じ名前の従業員がすでに登録されています」。

---

### Task 8: 打刻画面

**Files:**
- Modify（全体を置き換え）: `face-attendance/js/views/punch.js`

**Interfaces:**
- Consumes: `loadModels`, `startCamera`, `stopCamera`, `detectDescriptor`（Task 6）, `findBestMatch`（Task 3）, `listEmployees`, `addPunch`, `listPunches`（Task 5）, `shouldRejectPunch`, `DUPLICATE_WINDOW_MS`, `localTime`（Task 1）, `errorMessage`（Task 3）, `el`, `sleep`（Task 6）
- Produces: `mount(root)`, `show()`, `hide()`

- [ ] **Step 1: 実装する**

`face-attendance/js/views/punch.js`:
```js
import { loadModels, startCamera, stopCamera, detectDescriptor } from '../face.js';
import { findBestMatch } from '../match.js';
import { listEmployees, addPunch, listPunches } from '../store.js';
import { shouldRejectPunch, DUPLICATE_WINDOW_MS, localTime } from '../attendance.js';
import { errorMessage } from '../errors.js';
import { el, sleep } from '../dom.js';

const SCAN_TIMEOUT_MS = 10000;
const SCAN_INTERVAL_MS = 300;
const RESULT_MS = 3000;
const LABEL = { in: '出勤', out: '退勤' };
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

let clock, buttons, camera, video, hint, result;
let busy = false;       // 打刻処理中（連打防止）
let cancelled = false;
let resultTimer = null;

export function mount(root) {
  root.innerHTML = `
    <div class="punch">
      <div class="clock" data-clock></div>
      <div class="punch-buttons" data-buttons>
        <button type="button" class="btn-punch in" data-type="in">出勤</button>
        <button type="button" class="btn-punch out" data-type="out">退勤</button>
      </div>
      <div class="camera" data-camera hidden>
        <video playsinline muted></video>
        <p class="hint" data-hint></p>
        <div class="camera-actions">
          <button type="button" class="btn-secondary" data-cancel>キャンセル</button>
        </div>
      </div>
      <div class="result" data-result hidden></div>
    </div>`;
  clock = root.querySelector('[data-clock]');
  buttons = root.querySelector('[data-buttons]');
  camera = root.querySelector('[data-camera]');
  video = camera.querySelector('video');
  hint = root.querySelector('[data-hint]');
  result = root.querySelector('[data-result]');

  for (const btn of buttons.querySelectorAll('button')) {
    btn.addEventListener('click', () => begin(btn.dataset.type));
  }
  root.querySelector('[data-cancel]').addEventListener('click', () => {
    cancelled = true;
    hint.textContent = 'キャンセルしています…';
  });
  result.addEventListener('click', reset);

  updateClock();
  setInterval(updateClock, 1000);
}

export function show() {
  reset();
}

export function hide() {
  cancelled = true;
  reset();
}

function updateClock() {
  const now = new Date();
  clock.replaceChildren(
    el('small', { text: `${now.getMonth() + 1}月${now.getDate()}日（${WEEKDAYS[now.getDay()]}）` }),
    `${localTime(now)}:${String(now.getSeconds()).padStart(2, '0')}`,
  );
}

async function begin(type) {
  if (busy) return;
  busy = true;
  cancelled = false;
  setButtonsDisabled(true);
  try {
    const employees = (await listEmployees()).filter((e) => !e.sample);
    if (employees.length === 0) return showResult('error', '先に従業員登録をしてください');

    buttons.hidden = true;
    camera.hidden = false;
    hint.textContent = 'カメラを準備中…';
    await loadModels();
    await startCamera(video);
    if (cancelled) return reset();

    hint.textContent = `${LABEL[type]}：カメラに顔を向けてください`;
    const match = await scan(employees);
    stopCamera(video);
    if (cancelled) return reset();
    if (!match) return showResult('error', '認識できませんでした', 'もう一度お試しください');

    const now = new Date();
    const punch = { employeeId: match.employee.id, type, timestamp: now.toISOString() };
    const recent = await listPunches({
      from: new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString(),
      to: new Date(now.getTime() + 1).toISOString(),
    });
    const name = match.employee.name;
    if (shouldRejectPunch(recent, punch)) {
      return showResult('warn', `${name}さん`, `すでに${LABEL[type]}打刻済みです`);
    }
    await addPunch(punch);
    showResult('ok', `${name}さん`, `${LABEL[type]} ${localTime(now)}`);
  } catch (err) {
    stopCamera(video);
    showResult('error', errorMessage(err));
  }
}

/** 最大10秒、0.3秒ごとに顔を探して照合する */
async function scan(employees) {
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (Date.now() < deadline && !cancelled) {
    const descriptor = await detectDescriptor(video);
    if (descriptor) {
      const match = findBestMatch(descriptor, employees);
      if (match) return match;
    }
    await sleep(SCAN_INTERVAL_MS);
  }
  return null;
}

function showResult(kind, title, detail = '') {
  camera.hidden = true;
  buttons.hidden = true;
  result.hidden = false;
  result.className = `result ${kind}`;
  result.replaceChildren(
    el('p', { class: 'result-title', text: title }),
    ...(detail ? [el('p', { class: 'result-detail', text: detail })] : []),
  );
  clearTimeout(resultTimer);
  resultTimer = setTimeout(reset, RESULT_MS);
}

function reset() {
  clearTimeout(resultTimer);
  resultTimer = null;
  stopCamera(video);
  camera.hidden = true;
  result.hidden = true;
  buttons.hidden = false;
  setButtonsDisabled(false);
  busy = false;
}

function setButtonsDisabled(disabled) {
  for (const btn of buttons.querySelectorAll('button')) btn.disabled = disabled;
}
```

- [ ] **Step 2: ブラウザで確認**

preview を再読み込みして「打刻」タブ:
1. 時計が1秒ごとに進む。
2. 従業員0人（またはサンプルのみ）で「出勤」→「先に従業員登録をしてください」→ 3秒で初期画面。
3. **Review Focus 5**: 実在の従業員を1人入れた状態（`addEmployee({name:'確認用', descriptors:[new Array(128).fill(0)]})`）で「出勤」を押した直後に `javascript_tool` で「退勤」も click → 処理が1回しか走らない（ボタンが disabled）。カメラ待ち中に「勤怠一覧」タブへ切り替え → 打刻タブに戻ると初期画面で、`document.querySelector('#view-punch video').srcObject === null`。
4. カメラが使えない環境ではエラー文言が表示されて3秒で戻る。
5. 確認用の従業員を削除する。

---

### Task 9: 勤怠一覧画面

**Files:**
- Modify（全体を置き換え）: `face-attendance/js/views/records.js`

**Interfaces:**
- Consumes: `listEmployees`, `listPunches`, `seedSampleData`（Task 5）, `summarizeDaily`, `toCsv`, `monthRange`, `currentMonth`（Task 1–2）, `el`（Task 6）
- Produces: `mount(root)`, `show()`, `hide()`

- [ ] **Step 1: 実装する**

`face-attendance/js/views/records.js`:
```js
import { listEmployees, listPunches, seedSampleData } from '../store.js';
import { summarizeDaily, toCsv, monthRange, currentMonth } from '../attendance.js';
import { el } from '../dom.js';

let monthInput, csvBtn, body, empty;
let rows = [];
let refreshId = 0;

export function mount(root) {
  root.innerHTML = `
    <div class="records">
      <div class="toolbar">
        <label>月 <input type="month" data-month></label>
        <button type="button" class="btn-primary" data-csv>CSVダウンロード</button>
        <button type="button" class="btn-secondary" data-seed>サンプルデータを入れる</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>日付</th><th>名前</th><th>出勤</th><th>退勤</th><th>勤務時間</th></tr></thead>
          <tbody data-body></tbody>
        </table>
        <p class="empty" data-empty hidden>この月の記録はありません</p>
      </div>
    </div>`;
  monthInput = root.querySelector('[data-month]');
  csvBtn = root.querySelector('[data-csv]');
  body = root.querySelector('[data-body]');
  empty = root.querySelector('[data-empty]');

  monthInput.value = currentMonth();
  monthInput.addEventListener('change', refresh);
  csvBtn.addEventListener('click', downloadCsv);
  root.querySelector('[data-seed]').addEventListener('click', async () => {
    if (!(await seedSampleData())) alert('サンプルデータは投入済みです');
    monthInput.value = currentMonth();
    await refresh();
  });
}

export function show() {
  refresh();
}

export function hide() {}

async function refresh() {
  if (!monthInput.value) monthInput.value = currentMonth();
  const id = ++refreshId;
  const { from, to } = monthRange(monthInput.value);
  const [employees, punches] = await Promise.all([listEmployees(), listPunches({ from, to })]);
  if (id !== refreshId) return; // 新しい月が選ばれていたら古い結果は捨てる
  rows = summarizeDaily(punches, employees);
  render();
}

function render() {
  const dash = (v) => v ?? '—';
  body.replaceChildren(...rows.map((r) => el('tr', {}, [
    el('td', { class: 'num', text: r.date }),
    el('td', { text: r.name }),
    el('td', { class: 'num', text: dash(r.clockIn) }),
    el('td', { class: 'num', text: dash(r.clockOut) }),
    el('td', { class: 'num', text: dash(r.worked) }),
  ])));
  empty.hidden = rows.length > 0;
  csvBtn.disabled = rows.length === 0;
}

function downloadCsv() {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `勤怠_${monthInput.value}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 2: ブラウザで確認**

preview を再読み込みして「勤怠一覧」タブ:
1. 空の状態で「この月の記録はありません」、CSVボタンが disabled。
2. 「サンプルデータを入れる」→ 今月の平日分が表に並ぶ。今日の行は退勤・勤務時間が「—」。
3. もう一度押す →「サンプルデータは投入済みです」、行数は増えない。
4. 前月を選ぶ → 空表示。今月に戻す → 再表示。
5. CSV: `javascript_tool` で `toCsv` の結果先頭が `\uFEFF日付,名前` であることを確認（ダウンロード自体はクリックで発火することを `read_console_messages` にエラーがないことで確認）。
6. 「従業員登録」タブにサンプル3名が「サンプル」バッジ付きで出る。1名削除 → 一覧からその人の行が消える。
7. `resize_window {preset:"mobile"}` で横スクロールがページ全体に出ない（表は枠内でスクロール）。確認後 `preset:"desktop"` に戻す。

---

### Task 10: 最終確認と README

**Files:**
- Create: `face-attendance/README.md`

- [ ] **Step 1: README を書く**

`face-attendance/README.md`:
```markdown
# 顔認証 出退勤デモ

ブラウザだけで動く顔認証の出退勤打刻デモです。費用はかかりません。

- 顔の認識はすべてブラウザの中で行います。顔の画像は保存・送信しません（保存するのは顔の特徴を表す数値だけです）。
- データはそのブラウザの中（IndexedDB）に保存されます。別の端末・別のブラウザとは共有されません。

## 使い方

1. 「従業員登録」で名前を入れ、カメラで3回撮影する
2. 「打刻」で「出勤」か「退勤」を押し、カメラに顔を向ける
3. 「勤怠一覧」で月ごとの記録を見る・CSVで保存する（「サンプルデータを入れる」でデモ用の表示もできます）

## 手元で動かす

Node.js が必要です。

    npm start      # http://127.0.0.1:5181/ を開く
    npm test       # 自動テスト

## 公開する（無料）

フォルダ一式を GitHub Pages または Netlify にアップロードします。カメラを使うため https で公開してください（どちらも標準で https です）。初回表示時に顔認識のモデル（数MB）を jsDelivr から読み込むため、インターネット接続が必要です。

## デモ版の制限（製品版で対応予定）

- 写真をカメラにかざすと認証されてしまう可能性がある（なりすまし対策なし）
- 管理者ログインなし、複数店舗・複数社の切り替えなし
- データは端末のブラウザ内のみ。ブラウザのデータを消すと記録も消える
- 日をまたぐ勤務（夜勤）は日ごとに分かれて表示される
```

- [ ] **Step 2: 全体確認**

1. `npm test` → 全 PASS（42 tests）。
2. preview で3画面を一巡し、`read_console_messages {onlyErrors:true}` が空。
3. スクリーンショットを撮ってユーザーに共有する。
4. カメラを使った実打刻（登録→本人で打刻成功／他人で「認識できませんでした」）はブラウザペインでは検証できない可能性が高い。その場合はユーザーに「Chrome で `http://127.0.0.1:5181/` を開いて試してください」と、確認できた範囲・できなかった範囲を正直に伝える。
