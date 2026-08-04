import type {
  ExtractedComment,
  ExtractedCommentImage,
  ExtractedComments,
  RawComment,
  RawCommentPicture,
  RawComments,
} from '../types';
import { parseCount } from './extractor';
import { isValidTimestamp, toBeijingIso } from './time';

/**
 * 评论图的 url 在页面上是 http，且路径里嵌着一段有效期（形如 /202608040956/）。
 * 升到 https 是为了在扩展页面里能直接 fetch，不被混合内容策略拦掉。
 */
function toHttps(url: string): string {
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url;
}

/**
 * 评论图没有 fileId，实测按笔记原图的规则构造出的地址一律 404，
 * 所以只有 WB_DFT / WB_PRV 两个派生候选可用。
 * 声明尺寸是展示尺寸（实测 284x367 的图实际是 556x717），不能拿来做校验。
 */
function extractPictures(pics: RawCommentPicture[] | undefined): ExtractedCommentImage[] {
  if (!Array.isArray(pics)) return [];
  return pics
    .map((p, i) => ({
      index: i + 1,
      declaredWidth: typeof p.width === 'number' ? p.width : 0,
      declaredHeight: typeof p.height === 'number' ? p.height : 0,
      urlDefault: toHttps(p.urlDefault ?? ''),
      urlPre: toHttps(p.urlPre ?? ''),
    }))
    .filter((img) => img.urlDefault !== '' || img.urlPre !== '');
}

/**
 * 单条评论归一化。返回 null 表示这条不可用，调用方直接丢弃——一条坏评论
 * 不该牵连整篇笔记，更不该让 toBeijingIso 抛 RangeError 冒泡到面板。
 *
 * 刻意不保留 raw：评论字段少而稳，且 raw 里的 xsecToken 会过期、liked 是
 * 「当前账号点没点赞」，两者都只会让 Git diff 变脏。
 */
function extractOne(c: RawComment | undefined, withSub: boolean): ExtractedComment | null {
  if (!c || typeof c !== 'object') return null;
  if (!c.id || !isValidTimestamp(c.createTime) || !c.userInfo?.userId) return null;

  const base: ExtractedComment = {
    id: c.id,
    content: c.content ?? '',
    publishedAt: toBeijingIso(c.createTime),
    ipLocation: c.ipLocation ?? '',
    likedCount: parseCount(c.likeCount),
    author: {
      user_id: c.userInfo.userId,
      nickname: c.userInfo.nickname ?? '',
      avatar_url: c.userInfo.image ?? '',
      profile_url: `https://www.xiaohongshu.com/user/profile/${c.userInfo.userId}`,
    },
    atUsers: (c.atUsers ?? [])
      .filter((u) => u?.userId)
      .map((u) => ({ user_id: u.userId, nickname: u.nickname ?? '' })),
    tags: Array.isArray(c.showTags) ? c.showTags : [],
    images: extractPictures(c.pictures),
    subCommentCount: parseCount(c.subCommentCount),
  };

  // 回复不再往下嵌套，加上 subComments 字段只会让落盘结构多一层空数组。
  if (!withSub) return base;

  return {
    ...base,
    subComments: (c.subComments ?? [])
      .map((s) => extractOne(s, false))
      .filter((s): s is ExtractedComment => s !== null),
  };
}

/**
 * 归一化页面上「当前已加载」的评论。
 *
 * 按设计只取页面自己填好的那部分：不滚动、不点「展开 N 条回复」，
 * 插件全程不碰用户的页面。因此 collectedCount 通常远小于 declaredTotal，
 * 这不是错误，落盘时用 complete 字段如实标出来即可。
 */
export function extractComments(
  raw: RawComments | undefined | null,
  declaredTotal: number,
): ExtractedComments {
  const src = Array.isArray(raw?.list) ? raw.list : [];
  const list = src
    .map((c) => extractOne(c, true))
    .filter((c): c is ExtractedComment => c !== null);

  const collectedCount = list.reduce((n, c) => n + 1 + (c.subComments?.length ?? 0), 0);

  return {
    declaredTotal,
    collectedCount,
    complete: collectedCount >= declaredTotal,
    hasMore: raw?.hasMore === true,
    list,
  };
}
