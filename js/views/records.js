import { listEmployees, listPunches, seedSampleData } from '../store.js';
import { summarizeDaily, toCsv, monthRange, currentMonth, parseMonth } from '../attendance.js';
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
  // type="month" 非対応のブラウザ（Mac の Safari など）では文字入力になるので、ゆれを正規化する
  monthInput.value = parseMonth(monthInput.value) ?? currentMonth();
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
