// Tiny IndexedDB wrapper. Everything stays on this device.
const DB_NAME = 'pocket-ledger';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tx')) {
        const s = db.createObjectStore('tx', { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('accountId', 'accountId');
      }
      if (!db.objectStoreNames.contains('accounts')) db.createObjectStore('accounts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('imports')) db.createObjectStore('imports', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('checks')) db.createObjectStore('checks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const db = {
  async all(name) { return wrap((await store(name)).getAll()); },
  async get(name, key) { return wrap((await store(name)).get(key)); },
  async put(name, value, key) { return wrap((await store(name, 'readwrite')).put(value, key)); },
  async del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },
  async clear(name) { return wrap((await store(name, 'readwrite')).clear()); },
  async putMany(name, values) {
    const database = await open();
    return new Promise((res, rej) => {
      const t = database.transaction(name, 'readwrite');
      const s = t.objectStore(name);
      for (const v of values) s.put(v);
      t.oncomplete = () => res(values.length);
      t.onerror = () => rej(t.error);
    });
  },
  async kvGet(key, fallback = null) { const v = await this.get('kv', key); return v === undefined ? fallback : v; },
  async kvSet(key, value) { return this.put('kv', value, key); },
};

/** Ask the browser not to evict our data (important on iOS). */
export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
