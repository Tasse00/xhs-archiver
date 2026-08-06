import type { ArchivedAuthor, CommentImageRecord, CommentRecord, CommentsFile, NoteRecord, Pointer } from '../types';

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

/**
 * 卡片字段整组可缺席：card_fetched_at 在不在就是「有没有采到作者信息」的判据，
 * 缺的时候一个都不写，绝不用 fans: 0 占位。verify_type 还能单独缺席——
 * DOM 兜底路径读不到认证类型，写 0 会让「未认证」与「不知道」无法区分。
 */
function authorOf(a: ArchivedAuthor): Record<string, unknown> {
  const out: Record<string, unknown> = {
    user_id: a.user_id,
    nickname: a.nickname,
    avatar_url: a.avatar_url,
    profile_url: a.profile_url,
  };
  if (a.card_fetched_at === undefined) return out;

  out.desc = a.desc ?? '';
  if (a.verify_type !== undefined) out.verify_type = a.verify_type;
  out.follows = a.follows ?? 0;
  out.fans = a.fans ?? 0;
  out.interaction = a.interaction ?? 0;
  out.counts_raw = {
    follows: a.counts_raw?.follows ?? '',
    fans: a.counts_raw?.fans ?? '',
    interaction: a.counts_raw?.interaction ?? '',
  };
  out.approximate = a.approximate ?? false;
  out.card_fetched_at = a.card_fetched_at;
  return out;
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
    last_edited_at: n.last_edited_at,
    author: authorOf(n.author),
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

function commentImage(i: CommentImageRecord) {
  return {
    index: i.index,
    file: i.file,
    width: i.width,
    height: i.height,
    declared_width: i.declared_width,
    declared_height: i.declared_height,
    bytes: i.bytes,
    sha256: i.sha256,
    source_kind: i.source_kind,
    source_url: i.source_url,
  };
}

/** withSub 为假时省掉 sub_* 两个字段——回复不会再有回复。 */
function comment(c: CommentRecord, withSub: boolean): unknown {
  const base = {
    id: c.id,
    content: c.content,
    published_at: c.published_at,
    ip_location: c.ip_location,
    liked_count: c.liked_count,
    author: {
      user_id: c.author.user_id,
      nickname: c.author.nickname,
      avatar_url: c.author.avatar_url,
      profile_url: c.author.profile_url,
    },
    at_users: c.at_users.map((u) => ({ user_id: u.user_id, nickname: u.nickname })),
    tags: c.tags,
    images: c.images.map(commentImage),
  };
  if (!withSub) return base;
  return {
    ...base,
    sub_comment_count: c.sub_comment_count ?? 0,
    sub_comments: (c.sub_comments ?? []).map((s) => comment(s, false)),
  };
}

/**
 * 与 note.json 一样固定 key 顺序。评论不留 raw：字段少而稳，
 * 且 raw 里的 xsecToken 会过期、liked 与采集者绑定，只会让 diff 变脏。
 */
export function serializeComments(f: CommentsFile): string {
  return stringify({
    schema_version: f.schema_version,
    note_id: f.note_id,
    declared_total: f.declared_total,
    collected_count: f.collected_count,
    complete: f.complete,
    has_more: f.has_more,
    comments: f.comments.map((c) => comment(c, true)),
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
