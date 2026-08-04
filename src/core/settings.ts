/**
 * 目录名强制 ASCII：macOS 用 NFD 保存中文文件名，
 * 进 Git 后在其他平台会显示为乱码或被识别成不同路径。
 */
const SEGMENT_RE = /^[a-z0-9_-]{1,32}$/;
const RESERVED_TOP = '_index';

export interface Settings {
  collector: string | null;
  datasetPath: string | null;
}

export interface SettingsArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function isValidSegment(s: string): boolean {
  return SEGMENT_RE.test(s);
}

export function isValidDatasetPath(s: string): boolean {
  if (s === '' || s.startsWith('/') || s.endsWith('/')) return false;
  const parts = s.split('/');
  if (parts[0] === RESERVED_TOP) return false;
  return parts.every(isValidSegment);
}

export function randomCollectorId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => alphabet[b % alphabet.length]!).join('');
}

/**
 * 默认写入路径不按采集者分目录。一篇笔记在仓库里只有一份，谁采的记在指针文件名
 * 和 note.json 里；路径里带采集者名，接管之后目录名就跟实际采集者对不上了。
 */
export function defaultDatasetPath(): string {
  return 'collected';
}

const KEYS = ['collector', 'datasetPath'];

export async function loadSettings(area: SettingsArea): Promise<Settings> {
  const raw = await area.get(KEYS);
  return {
    collector: typeof raw.collector === 'string' ? raw.collector : null,
    datasetPath: typeof raw.datasetPath === 'string' ? raw.datasetPath : null,
  };
}

export async function saveSettings(area: SettingsArea, s: Settings): Promise<void> {
  if (s.collector !== null && !isValidSegment(s.collector)) {
    throw new Error('采集者 ID 只能包含小写字母、数字、连字符和下划线，且不超过 32 字符');
  }
  if (s.datasetPath !== null && !isValidDatasetPath(s.datasetPath)) {
    throw new Error('数据集路径每一段只能包含小写字母、数字、连字符和下划线，且不能以 _index 开头');
  }
  await area.set({ collector: s.collector, datasetPath: s.datasetPath });
}

/** 生产环境的存储区实现。 */
export const chromeLocalArea: SettingsArea = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
};
