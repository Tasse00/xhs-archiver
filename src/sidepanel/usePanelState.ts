import type { ExtractedComments, ExtractedNote, Pointer, RawNote } from '../types';
import type { Store } from '../core/store';
import { extract } from '../core/extractor';
import { extractComments } from '../core/comments';
import { checkNote } from '../core/archiver';
import { type PageDiag, type PageReadFailure, type PageReadResult } from '../page/read-note';

export type UnreadableReason =
  | PageReadFailure
  /** 读到了，但 note 只填了一半——多为 modal 刚打开、详情还没回来。 */
  | 'incomplete_data'
  /** 侧边栏自己出错，与页面无关。 */
  | 'panel_error';

/** 这些是等一下就可能自己好的，值得自动重试一次。 */
export function isTransient(reason: UnreadableReason): boolean {
  return reason === 'no_note' || reason === 'incomplete_data';
}

export type PanelState =
  | { kind: 'need_root' }
  | { kind: 'need_collector' }
  | { kind: 'not_xhs' }
  | { kind: 'not_note' }
  /** 页面数据还没填好，正在等着重读。不是错误，不要吓用户。 */
  | { kind: 'reading' }
  | { kind: 'unreadable'; reason: UnreadableReason; detail?: string }
  | { kind: 'video_rejected' }
  | { kind: 'blocked_by_other'; pointers: Pointer[] }
  | {
      kind: 'mine';
      note: ExtractedNote;
      comments: ExtractedComments;
      pointer: Pointer;
      duplicates: Pointer[];
    }
  | { kind: 'ready'; note: ExtractedNote; comments: ExtractedComments };

export interface ResolveInput {
  hasRoot: boolean;
  store: Store;
  collector: string | null;
  tabUrl: string;
  readNote(): Promise<PageReadResult>;
  /** 每次实际读过页面就回调一次，供侧边栏记工作日志。 */
  onDiag?(diag: PageDiag): void;
}

/** 顺序即优先级，与设计文档第 8 节的状态机一致。 */
export async function resolvePanelState(input: ResolveInput): Promise<PanelState> {
  if (!input.hasRoot) return { kind: 'need_root' };
  if (!input.collector) return { kind: 'need_collector' };

  // 域名用 tab.url 判断即可（SPA 导航不会改域名）。但「是不是在看笔记」不能用
  // 它判断：modal 开关只改 SPA 地址，tab.url 会滞后，据此判定会指向错的笔记。
  if (!/^https:\/\/(?:www\.)?xiaohongshu\.com\//.test(input.tabUrl)) return { kind: 'not_xhs' };

  const read = await input.readNote();
  input.onDiag?.(read.diag);

  if (!read.ok) {
    // 页面自己说当前地址上没有笔记 id，那就是没打开笔记，不是读取失败。
    if (read.diag.pathname && !read.diag.urlId && !read.diag.currentNoteId) {
      return { kind: 'not_note' };
    }
    return { kind: 'unreadable', reason: read.reason, detail: read.detail };
  }

  const ext = extract(read.raw as RawNote);
  if (!ext.ok) {
    return ext.reason === 'unsupported_video'
      ? { kind: 'video_rejected' }
      : { kind: 'unreadable', reason: 'incomplete_data' };
  }

  // 评论只取页面已经加载好的那部分，读不到就是空集——它不参与任何判定，
  // 不能因为评论没准备好就把一篇本可采集的笔记挡在外面。
  const comments = extractComments(read.rawComments, ext.note.interact.comment);

  const check = await checkNote(input.store, ext.note.noteId, input.collector);
  if (check.state === 'others') return { kind: 'blocked_by_other', pointers: check.pointers };
  if (check.state === 'mine') {
    return {
      kind: 'mine',
      note: ext.note,
      comments,
      pointer: check.pointer,
      duplicates: check.duplicates,
    };
  }
  return { kind: 'ready', note: ext.note, comments };
}
