import type { RawNote } from '../types';

/** 每次读取都回传的现场快照，用于在侧边栏显示工作日志。 */
export interface PageDiag {
  /** 页面自己的 location.pathname，与侧边栏拿到的 tab.url 可能不一致。 */
  pathname: string;
  urlId: string | null;
  currentNoteId: string | null;
  mapKeys: string[];
  entryFound: boolean;
  /** 页面内抛出的异常原文。 */
  error?: string;
}

export type PageReadFailure =
  | 'no_state'
  | 'no_note'
  /** 注入本身没跑成：权限被拒、页面未就绪、脚本被拦。 */
  | 'inject_failed'
  /** 注入跑起来了，但读取过程中抛异常。 */
  | 'page_error';

export type PageReadResult =
  | { ok: true; raw: RawNote; diag: PageDiag }
  | { ok: false; reason: PageReadFailure; detail?: string; diag: PageDiag };

/**
 * 注入到页面 MAIN world 执行。
 *
 * 约束：函数体会被序列化后在页面上下文运行，**不能引用本模块的任何外部变量**
 * （包括 import 的类型以外的一切），正则、常量都得写在函数体里。
 *
 * 三条实测约束：
 * 1. 定位以页面自己的 location 为准。currentNoteId._value 会在 modal 关闭后被
 *    重置为空字符串，而侧边栏拿到的 tab.url 又可能滞后于 SPA 的实际地址，
 *    两者都会指向错误的笔记。currentNoteId 仅在 URL 上没有 id 时兜底。
 * 2. 只取 noteDetailMap[id].note 子对象：其父层含 dep/computed 循环引用。
 * 3. 全程 try/catch 并且始终返回值。抛出去会让 executeScript 的 result 变成
 *    undefined，调用方只能看到「无返回值」，等于把现场信息全丢了。
 */
export function readNoteFromPage(): PageReadResult {
  const diag: PageDiag = {
    pathname: '',
    urlId: null,
    currentNoteId: null,
    mapKeys: [],
    entryFound: false,
  };

  try {
    diag.pathname = location.pathname;

    const state = (window as unknown as { __INITIAL_STATE__?: Record<string, unknown> }).__INITIAL_STATE__;
    if (!state || typeof state !== 'object') return { ok: false, reason: 'no_state', diag };

    const noteStore = state.note as
      | { currentNoteId?: { _value?: unknown }; noteDetailMap?: Record<string, { note?: unknown }> }
      | undefined;
    if (!noteStore) return { ok: false, reason: 'no_note', diag };

    const map = noteStore.noteDetailMap ?? {};
    diag.mapKeys = Object.keys(map);

    const cur = noteStore.currentNoteId?._value;
    diag.currentNoteId = typeof cur === 'string' ? cur : null;

    const m = /\/(?:explore|discovery\/item|user\/profile\/[^/]+)\/([0-9a-f]+)/.exec(location.pathname);
    diag.urlId = m ? m[1]! : null;

    // noteDetailMap 含 "" 与 "undefined" 脏 key，空 id 会取到错误数据。
    const id = diag.urlId ?? (diag.currentNoteId || '');
    if (!id) return { ok: false, reason: 'no_note', diag };

    const entry = map[id];
    diag.entryFound = Boolean(entry && entry.note);
    if (!entry || !entry.note) return { ok: false, reason: 'no_note', diag };

    // JSON round-trip 而非 structuredClone：产物是纯 JSON，既能穿透 Vue 的响应式
    // 包装，也保证一定能跨扩展边界（structuredClone 的产物不一定能，实测出现过
    // 结果在传回时丢失、调用方只拿到 undefined 的情况）。落盘本来就是 JSON。
    return { ok: true, raw: JSON.parse(JSON.stringify(entry.note)) as RawNote, diag };
  } catch (e) {
    diag.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, reason: 'page_error', detail: diag.error, diag };
  }
}

const NOTE_URL_RE = /^https:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item|user\/profile\/[^/]+)\/([0-9a-f]+)/;

export function parseNoteUrl(url: string): string | null {
  return NOTE_URL_RE.exec(url)?.[1] ?? null;
}

const EMPTY_DIAG: PageDiag = {
  pathname: '',
  urlId: null,
  currentNoteId: null,
  mapKeys: [],
  entryFound: false,
};

/**
 * 注入失败与「页面确实没有全局变量」必须分开报：前者是扩展侧问题（权限、world、
 * 时序），后者才是页面侧问题（未登录、页面没加载完）。都兜成同一个错误码会让
 * 排查完全失去方向。
 */
export async function readNoteViaTab(tabId: number): Promise<PageReadResult> {
  let res;
  try {
    [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readNoteFromPage,
    });
  } catch (e) {
    return {
      ok: false,
      reason: 'inject_failed',
      detail: e instanceof Error ? e.message : String(e),
      diag: { ...EMPTY_DIAG },
    };
  }

  const result = res?.result as PageReadResult | undefined;
  if (!result) {
    // Chrome 把页面内抛出的异常放在 error 字段里，没有它就只剩「无返回值」。
    const injectionError = (res as { error?: { message?: string } } | undefined)?.error?.message;
    return {
      ok: false,
      reason: 'inject_failed',
      detail: injectionError ?? (res ? '注入脚本无返回值' : '注入未命中任何 frame'),
      diag: { ...EMPTY_DIAG },
    };
  }
  return result;
}
