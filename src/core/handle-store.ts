/**
 * FSA 目录句柄只能存在 IndexedDB 里（structuredClone 支持，JSON 不支持）。
 * chrome.storage 不能存句柄。
 */
const DB_NAME = 'xhs-archiver';
const STORE = 'handles';
const KEY = 'root';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveRootHandle(h: FileSystemDirectoryHandle): Promise<void> {
  await tx('readwrite', (s) => s.put(h, KEY));
}

export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const h = await tx<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY));
  return h ?? null;
}

export async function clearRootHandle(): Promise<void> {
  await tx('readwrite', (s) => s.delete(KEY));
}

/** 权限可能在浏览器重启后失效；恢复需要用户手势，故只能由 UI 点击触发。 */
export async function ensurePermission(h: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await h.queryPermission(opts)) === 'granted') return true;
  return (await h.requestPermission(opts)) === 'granted';
}
