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
