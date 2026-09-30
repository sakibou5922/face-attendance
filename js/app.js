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
