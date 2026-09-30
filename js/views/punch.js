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
let busy = false;       // 打刻処理中（連打・二重実行防止）
let session = 0;       // キャンセル・タブ切替で進める。古い処理は自分の番号と違えば中断する
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
    session++;
    reset();
  });
  result.addEventListener('click', reset);

  updateClock();
  setInterval(updateClock, 1000);
}

export function show() {
  reset();
}

export function hide() {
  session++;
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
  const id = ++session;
  const stale = () => id !== session;
  setButtonsDisabled(true);
  try {
    const employees = (await listEmployees()).filter((e) => !e.sample);
    if (stale()) return;
    if (employees.length === 0) return showResult('error', '先に従業員登録をしてください');

    buttons.hidden = true;
    camera.hidden = false;
    hint.textContent = 'カメラを準備中…';
    await loadModels();
    if (stale()) return;
    await startCamera(video, stale);

    hint.textContent = `${LABEL[type]}：カメラに顔を向けてください`;
    const match = await scan(employees, stale);
    stopCamera(video);
    if (stale()) return;
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
    if (stale() || err.name === 'CancelledError') return; // キャンセル済み。画面は reset() で戻っている
    showResult('error', errorMessage(err));
  } finally {
    // タブ切替やキャンセルで画面が戻っても、この処理が終わるまで次の打刻は始めさせない
    busy = false;
    setButtonsDisabled(false);
  }
}

/** 最大10秒、0.3秒ごとに顔を探して照合する */
async function scan(employees, stale) {
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  while (Date.now() < deadline && !stale()) {
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
  setButtonsDisabled(busy);
}

function setButtonsDisabled(disabled) {
  for (const btn of buttons.querySelectorAll('button')) btn.disabled = disabled;
}
