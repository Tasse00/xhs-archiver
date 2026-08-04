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

const RW = { mode: 'readwrite' as const };

/**
 * 权限随时可能被回收，不只是浏览器重启。实测：扩展 origin 的最后一个标签页
 * 关闭时（例如从侧边栏开了浏览页又关掉），Chrome 就把该 origin 上所有句柄的
 * 权限降回 prompt——侧边栏还开着也一样，它不算标签页。
 *
 * 所以任何一次落盘之前都要查一遍，不能只在挂载时查。
 */
export async function hasPermission(h: FileSystemDirectoryHandle): Promise<boolean> {
  return (await h.queryPermission(RW)) === 'granted';
}

/** 恢复需要用户手势，故只能由 UI 点击触发。 */
export async function ensurePermission(h: FileSystemDirectoryHandle): Promise<boolean> {
  if (await hasPermission(h)) return true;
  return (await h.requestPermission(RW)) === 'granted';
}

/**
 * 权限没了的时候 FSA 抛的是 NotAllowedError。它跟「目录不存在」完全是两回事，
 * 混进通用错误处理会把人指向「重新加载扩展」这个错误方向。
 */
export function isPermissionError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
}
