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
let session = 0;        // 撮影開始・キャンセル・タブ切替で進める。古い処理は自分の番号と違えば中断する

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
  const id = ++session;
  const stale = () => id !== session;
  const name = nameInput.value.trim();
  if (!name) return showMessage('error', '名前を入力してください');
  const employees = await listEmployees();
  if (stale()) return;
  if (employees.some((e) => e.name === name)) {
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
    if (stale()) return;
    await startCamera(video, stale);
    updatePrompt();
    captureBtn.disabled = false;
  } catch (err) {
    if (stale() || err.name === 'CancelledError') return; // キャンセル済み。画面は reset() で戻っている
    reset();
    showMessage('error', errorMessage(err));
  }
}

async function onCapture() {
  if (capturing || pendingName === null) return;
  const id = session;
  const stale = () => id !== session;
  capturing = true;
  captureBtn.disabled = true;
  try {
    const descriptor = await detectDescriptor(video);
    if (stale()) return;
    if (!descriptor) {
      hint.textContent = `顔が見つかりません。明るい場所でカメラに顔を向けてください（${descriptors.length + 1}/3枚目：${PROMPTS[descriptors.length]}）`;
      return;
    }
    descriptors.push(descriptor);
    renderShots();
    if (descriptors.length < PROMPTS.length) { updatePrompt(); return; }
    const name = pendingName;
    await addEmployee({ name, descriptors });
    if (stale()) return;
    reset();
    nameInput.value = '';
    showMessage('ok', `${name}さんを登録しました`);
    await renderList();
  } catch (err) {
    if (stale()) return;
    reset();
    showMessage('error', errorMessage(err));
  } finally {
    capturing = false;
    if (!stale() && pendingName !== null) captureBtn.disabled = false;
  }
}

function updatePrompt() {
  hint.textContent = `${descriptors.length + 1}/3枚目：${PROMPTS[descriptors.length]}`;
}

function renderShots() {
  shots.replaceChildren(...PROMPTS.map((_, i) => el('span', { class: i < descriptors.length ? 'shot done' : 'shot' })));
}

function reset() {
  session++;
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
