import type { NoteRecord } from '../../types';
import type { ReadStore } from '../read-store';
import { noteKeyOf } from './scope';
import type { NoteDetail, NoteRef, RowMeta } from './types';

export type LoadNoteResult =
  | { ok: true; meta: RowMeta; detail: NoteDetail }
  | { ok: false; reason: string };

/**
 * 一次读取同时产出列表要的 RowMeta 和详情要的 NoteDetail。
 * 分两次读会让打开详情栏又走一遍磁盘，而多出来的只是一个 images 数组。
 *
 * 两者都不带 raw：它是 note.json 里最大的一块，只为归档 diff 稳定性存在，
 * 浏览页只用得上里面的 ipLocation 一个值。
 */
export async function loadNote(store: ReadStore, ref: NoteRef): Promise<LoadNoteResult> {
  const txt = await store.readText(`${noteKeyOf(ref)}/note.json`);
  if (txt === null) return { ok: false, reason: 'note.json 不存在' };

  let j: NoteRecord;
  try {
    j = JSON.parse(txt) as NoteRecord;
  } catch (e) {
    return { ok: false, reason: `note.json 解析失败：${e instanceof Error ? e.message : String(e)}` };
  }

  if (typeof j.note_id !== 'string' || !Array.isArray(j.images) || typeof j.archive !== 'object' || j.archive === null) {
    return { ok: false, reason: 'note.json 缺少必要字段（note_id / images / archive）' };
  }

  const raw = j.raw as { ipLocation?: unknown } | undefined;

  return {
    ok: true,
    meta: {
      noteId: j.note_id,
      datasetPath: ref.datasetPath,
      title: j.title ?? '',
      content: j.content ?? '',
      tags: j.tags ?? [],
      authorNickname: j.author?.nickname ?? '',
      authorFans: typeof j.author?.fans === 'number' ? j.author.fans : null,
      authorInteraction: typeof j.author?.interaction === 'number' ? j.author.interaction : null,
      liked: j.interact?.liked ?? 0,
      collected: j.interact?.collected ?? 0,
      comment: j.interact?.comment ?? 0,
      share: j.interact?.share ?? 0,
      imageCount: j.images.length,
      coverFile: j.images[0]?.file ?? null,
      collector: j.archive.collector ?? '',
      firstArchivedAt: j.archive.first_archived_at ?? '',
      lastArchivedAt: j.archive.last_archived_at ?? '',
      archiveCount: j.archive.archive_count ?? 0,
      publishedAt: j.published_at ?? '',
      lastEditedAt: j.last_edited_at ?? '',
    },
    detail: {
      url: j.url ?? '',
      shareUrl: j.share_url ?? '',
      author: j.author,
      ipLocation: typeof raw?.ipLocation === 'string' ? raw.ipLocation : '',
      images: j.images,
    },
  };
}
