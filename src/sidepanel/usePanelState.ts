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
  /** 目录还记着，但权限被浏览器回收了。只差一次用户手势，不必重选目录。 */
  | { kind: 'need_permission' }
  /**
   * 句柄和权限都还在，但目录已经从磁盘上消失了（被删、被移走、外置盘拔了）。
   * 与 need_permission 相反，这个只能重新选目录，恢复授权救不了。
   */
  | { kind: 'missing_root' }
  | { kind: 'need_collector' }
  /** 还没确认过写入路径。数据落在哪必须在采之前就说定。 */
  | { kind: 'need_path' }
  | { kind: 'not_xhs' }
  | { kind: 'not_note' }
  /** 页面数据还没填好，正在等着重读。不是错误，不要吓用户。 */
  | { kind: 'reading' }
  | { kind: 'unreadable'; reason: UnreadableReason; detail?: string }
  | { kind: 'video_rejected' }
  /**
   * 别人采过。不是死路——可以接管，动作与 mine 相同，只是会作废对方的指针。
   * 所以这里必须跟 mine/ready 一样带上笔记与评论。
   */
  | { kind: 'others'; note: ExtractedNote; comments: ExtractedComments; pointers: Pointer[] }
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
  /** 句柄当前是否还有 readwrite 权限。它会在采集途中被回收，见 handle-store。 */
  hasPermission: boolean;
  /** 目录当前是否还在磁盘上。没权限时探不了，那种情况传什么都不影响判定。 */
  rootExists: boolean;
  store: Store;
  collector: string | null;
  /** 使用者是否确认过写入路径。有默认值不等于确认过。 */
  hasDatasetPath: boolean;
  tabUrl: string;
  readNote(): Promise<PageReadResult>;
  /** 每次实际读过页面就回调一次，供侧边栏记工作日志。 */
  onDiag?(diag: PageDiag): void;
}

/** 顺序即优先级，与设计文档第 8 节的状态机一致。 */
export async function resolvePanelState(input: ResolveInput): Promise<PanelState> {
  if (!input.hasRoot) return { kind: 'need_root' };
  // 没权限时下面每一步读盘都会抛 NotAllowedError，先拦住比让它炸在深处强。
  if (!input.hasPermission) return { kind: 'need_permission' };
  // 排在权限之后：没权限时根本探不了目录。排在采集者之前：目录都没了，
  // 再往下走每一步读盘都只会安静地返回空，最后把「仓库没了」显示成「可采集」。
  if (!input.rootExists) return { kind: 'missing_root' };
  if (!input.collector) return { kind: 'need_collector' };
  if (!input.hasDatasetPath) return { kind: 'need_path' };

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
  if (check.state === 'others') {
    return { kind: 'others', note: ext.note, comments, pointers: check.pointers };
  }
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
