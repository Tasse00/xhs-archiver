import type { PageDiag } from '../page/read-note';
import type { PanelState } from './usePanelState';

export interface LogEntry {
  at: string;
  outcome: string;
  /** 侧边栏拿到的 tab 地址，已去掉 query（里面有会过期的 xsec_token）。 */
  tabUrl: string;
  /** 页面自己报的路径。与 tabUrl 不一致就是 SPA 导航后 tab.url 滞后了。 */
  pathname: string;
  urlId: string;
  currentNoteId: string;
  mapKeys: number;
  entryFound: boolean;
  /** 页面上已加载的主评论条数。 */
  comments: number;
  /** 这次判定重读了几次页面才定下来。0 表示一次就成。 */
  attempts: number;
  /** 同一个判定连续出现的次数。>1 时说明页面事件重复触发了。 */
  repeats: number;
  error?: string;
}

/** 日志只为看最近发生了什么，留太多反而难找。 */
const MAX_ENTRIES = 30;

/**
 * 只记录当前标签页确实停在一篇笔记上时的判定。
 *
 * 日志是用来回答「这篇为什么采不了」的。切标签页、逛非笔记页、还没配好仓库
 * 时也照记，产生的全是噪音，而且会把真正有用的那几条挤出 MAX_ENTRIES。
 *
 * 例外是 panel_error：侧边栏自己抛异常时根本无从判断当时在不在笔记页，
 * 丢掉它就等于丢掉唯一的线索。
 */
export function shouldLog(state: PanelState): boolean {
  switch (state.kind) {
    case 'need_root':
    case 'need_collector':
    case 'not_xhs':
    case 'not_note':
      return false;
    default:
      return true;
  }
}

export function describeOutcome(state: PanelState): string {
  switch (state.kind) {
    case 'need_root': return '未选择仓库目录';
    case 'need_collector': return '未设置采集者 ID';
    case 'not_xhs': return '当前标签页不是小红书';
    case 'not_note': return '未打开笔记';
    case 'reading': return '页面数据未就绪，稍后重读';
    case 'unreadable': return `读取失败：${state.reason}`;
    case 'video_rejected': return '视频笔记，不采集';
    case 'blocked_by_other': return `他人已采集（${state.pointers.length} 条指针）`;
    case 'mine': return '自己已采集';
    case 'ready': return '可采集';
  }
}

export function buildLogEntry(
  state: PanelState,
  tabUrl: string,
  diag: PageDiag | null,
  at: Date,
  attempts = 0,
): LogEntry {
  const detail = state.kind === 'unreadable' ? state.detail : undefined;
  return {
    at: at.toTimeString().slice(0, 8),
    outcome: describeOutcome(state),
    tabUrl: tabUrl.split('?')[0] ?? '',
    pathname: diag?.pathname ?? '—',
    urlId: diag?.urlId ?? '—',
    currentNoteId: diag?.currentNoteId === '' ? '(空)' : diag?.currentNoteId ?? '—',
    mapKeys: diag?.mapKeys.length ?? 0,
    entryFound: diag?.entryFound ?? false,
    comments: diag?.commentCount ?? 0,
    attempts,
    repeats: 1,
    ...(diag?.error ?? detail ? { error: diag?.error ?? detail } : {}),
  };
}

/** 最新的排在最前面。 */
export function appendLog(prev: LogEntry[], entry: LogEntry): LogEntry[] {
  return [entry, ...prev].slice(0, MAX_ENTRIES);
}

/**
 * 是不是同一个判定。评论条数与重读次数刻意不参与比较：它们会变，
 * 但「这篇可采集」这个结论没变，不该因此多出一条。
 */
function isSameFinding(a: LogEntry, b: LogEntry): boolean {
  return (
    a.outcome === b.outcome &&
    a.pathname === b.pathname &&
    a.urlId === b.urlId &&
    a.entryFound === b.entryFound &&
    a.error === b.error
  );
}

/**
 * 记一次判定。与最近一条结论相同就地合并，只累加次数并把时间与现场
 * 更新为最新的，不新增条目。
 *
 * 这是必需的：`chrome.tabs.onUpdated` 在一次导航里会触发好几次
 * （loading / title / favicon / complete），逐条记录会让打开一篇笔记
 * 就刷出十几条一模一样的日志，把真正有用的历史挤出 MAX_ENTRIES。
 */
export function recordLog(prev: LogEntry[], entry: LogEntry): LogEntry[] {
  const head = prev[0];
  if (head && isSameFinding(head, entry)) {
    return [{ ...entry, repeats: head.repeats + 1 }, ...prev.slice(1)];
  }
  return appendLog(prev, entry);
}
