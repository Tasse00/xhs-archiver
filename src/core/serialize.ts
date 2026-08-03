import type { NoteRecord, Pointer } from '../types';

/**
 * 递归按 key 排序。实测 note 的字段顺序在不同入口（独立页 / 首页 modal /
 * 搜索 modal）下不一致，不排序会让每次重采的 diff 充满噪音。
 */
export function sortKeysDeep<T>(v: T): T {
  if (Array.isArray(v)) return v.map(sortKeysDeep) as unknown as T;
  if (v !== null && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortKeysDeep(src[k]);
    return out as unknown as T;
  }
  return v;
}

function stringify(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

export function serializeNote(n: NoteRecord): string {
  return stringify({
    schema_version: n.schema_version,
    note_id: n.note_id,
    url: n.url,
    type: n.type,
    title: n.title,
    content: n.content,
    tags: n.tags,
    published_at: n.published_at,
    author: {
      user_id: n.author.user_id,
      nickname: n.author.nickname,
      avatar_url: n.author.avatar_url,
      profile_url: n.author.profile_url,
    },
    interact: {
      liked: n.interact.liked,
      collected: n.interact.collected,
      comment: n.interact.comment,
      share: n.interact.share,
    },
    images: n.images.map((i) => ({
      index: i.index,
      file: i.file,
      is_live: i.is_live,
      file_id: i.file_id,
      width: i.width,
      height: i.height,
      declared_width: i.declared_width,
      declared_height: i.declared_height,
      bytes: i.bytes,
      sha256: i.sha256,
      source_kind: i.source_kind,
      source_url: i.source_url,
    })),
    archive: {
      first_archived_at: n.archive.first_archived_at,
      last_archived_at: n.archive.last_archived_at,
      collector: n.archive.collector,
      archive_count: n.archive.archive_count,
      status: n.archive.status,
    },
    raw: sortKeysDeep(n.raw),
  });
}

export function serializePointer(p: Pointer): string {
  return stringify({
    note_id: p.note_id,
    path: p.path,
    collector: p.collector,
    title: p.title,
    first_archived_at: p.first_archived_at,
    last_archived_at: p.last_archived_at,
  });
}
