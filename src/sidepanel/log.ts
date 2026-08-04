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
  error?: string;
}

/** 日志只为看最近发生了什么，留太多反而难找。 */
const MAX_ENTRIES = 30;

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
    ...(diag?.error ?? detail ? { error: diag?.error ?? detail } : {}),
  };
}

/** 最新的排在最前面。 */
export function appendLog(prev: LogEntry[], entry: LogEntry): LogEntry[] {
  return [entry, ...prev].slice(0, MAX_ENTRIES);
}
