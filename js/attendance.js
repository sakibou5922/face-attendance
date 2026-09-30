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

/** 'YYYY-MM' や '2026/9'・'2026年9月' などを 'YYYY-MM' に。解釈できなければ null */
export function parseMonth(value) {
  const m = /^(\d{4})\D{1,2}(\d{1,2})\D?$/.exec(String(value).trim());
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${m[1]}-${pad2(month)}` : null;
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}
