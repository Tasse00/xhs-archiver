import type { RawNote } from '../types';

export type PageReadResult =
  | { ok: true; raw: RawNote }
  | { ok: false; reason: 'no_state' | 'no_note' };

/**
 * 注入到页面 MAIN world 执行。
 *
 * 约束：函数体会被序列化后在页面上下文运行，**不能引用本模块的任何外部变量**
 * （包括 import 的类型以外的一切）。
 *
 * 登录态下 __INITIAL_STATE__ 是持续存在的 Vue 响应式 store，
 * 三种入口（独立页 / 首页 modal / 搜索 modal）均可读到完整数据。
 */
export function readNoteFromPage(): PageReadResult {
  const state = (window as unknown as { __INITIAL_STATE__?: Record<string, unknown> }).__INITIAL_STATE__;
  if (!state || typeof state !== 'object') return { ok: false, reason: 'no_state' };

  const noteStore = state.note as
    | { currentNoteId?: { _value?: unknown }; noteDetailMap?: Record<string, { note?: unknown }> }
    | undefined;
  if (!noteStore) return { ok: false, reason: 'no_note' };

  // 必须用 currentNoteId._value：noteDetailMap 含 "" 与 "undefined" 脏 key。
  const id = noteStore.currentNoteId?._value;
  if (typeof id !== 'string' || id === '') return { ok: false, reason: 'no_note' };

  const entry = noteStore.noteDetailMap?.[id];
  if (!entry || !entry.note) return { ok: false, reason: 'no_note' };

  // 只取 .note 子对象：其父层含 dep/computed 循环引用，无法穿过扩展边界。
  return { ok: true, raw: structuredClone(entry.note) as RawNote };
}

const NOTE_URL_RE = /^https:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item|user\/profile\/[^/]+)\/([0-9a-f]+)/;

export function parseNoteUrl(url: string): string | null {
  return NOTE_URL_RE.exec(url)?.[1] ?? null;
}

export async function readNoteViaTab(tabId: number): Promise<PageReadResult> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: readNoteFromPage,
  });
  return (res?.result as PageReadResult | undefined) ?? { ok: false, reason: 'no_state' };
}
