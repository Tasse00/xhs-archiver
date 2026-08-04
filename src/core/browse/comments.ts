import type { CommentsFile } from '../../types';
import type { ReadStore } from '../read-store';
import { noteKeyOf } from './scope';
import type { NoteRef } from './types';

export type CommentsResult =
  | { kind: 'none' }
  | { kind: 'ok'; file: CommentsFile }
  | { kind: 'error'; reason: string };

/**
 * 文件不存在返回 none 而不是 error：没采评论是正常状态
 * （采集时页面上一条都没加载出来就不会写这个文件），报成错误会吓人。
 */
export async function loadComments(store: ReadStore, ref: NoteRef): Promise<CommentsResult> {
  const txt = await store.readText(`${noteKeyOf(ref)}/comments.json`);
  if (txt === null) return { kind: 'none' };
  try {
    const file = JSON.parse(txt) as CommentsFile;
    if (!Array.isArray(file.comments)) return { kind: 'error', reason: 'comments.json 缺少 comments 数组' };
    return { kind: 'ok', file };
  } catch (e) {
    return { kind: 'error', reason: `comments.json 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** CommentImageRecord.file 是相对笔记目录的，读盘要补上笔记目录前缀。 */
export function commentImagePath(ref: NoteRef, file: string): string {
  return `${noteKeyOf(ref)}/${file}`;
}
