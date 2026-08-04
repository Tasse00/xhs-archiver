import type { ExtractResult, RawNote, ExtractedImage } from '../types';
import { isValidTimestamp, toBeijingIso } from './time';

/** 互动数在页面里是字符串，可能带「万」「亿」「+」。 */
export function parseCount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v !== 'string') return 0;
  const s = v.trim();
  if (s === '') return 0;
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10);
  const m = s.match(/^([\d.]+)\s*(万|亿)\+?$/);
  if (m) {
    const unit = m[2] === '万' ? 10_000 : 100_000_000;
    return Math.round(Number.parseFloat(m[1]!) * unit);
  }
  const lead = s.match(/^([\d.]+)/);
  return lead ? Math.round(Number.parseFloat(lead[1]!)) : 0;
}

/**
 * 正文里会把话题标签重复一遍，形如 `#名字[话题]#`，可连写也可散在中间。
 * tags 字段已经从 tagList 单独取过，正文再留一份既冗余又影响阅读。
 * 只认带 `[话题]#` 的完整形态，作者手写的普通 `#` 不动。
 */
export function stripTopicTags(desc: string): string {
  return desc
    .replace(/#[^#\n]*\[话题\]#/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    // 话题被平台截断时会在结尾剩下一个孤零零的 #
    .replace(/\s*#\s*$/, '')
    .trim();
}

export function extract(raw: RawNote): ExtractResult {
  if (raw.type === 'video') return { ok: false, reason: 'unsupported_video' };
  // 页面刚打开 modal 时 note 可能只填了一半，缺字段一律当作「还没准备好」，
  // 决不能带着坏值往下走——落盘的 note.json 是要进 Git 的。
  if (!raw.noteId || !Array.isArray(raw.imageList) || raw.imageList.length === 0) {
    return { ok: false, reason: 'missing_data' };
  }
  if (!isValidTimestamp(raw.time) || !raw.user?.userId) {
    return { ok: false, reason: 'missing_data' };
  }

  const images: ExtractedImage[] = raw.imageList.map((img, i) => ({
    index: i + 1,
    fileId: img.fileId,
    declaredWidth: img.width,
    declaredHeight: img.height,
    isLive: img.livePhoto === true,
    urlDefault: img.urlDefault ?? '',
    urlPre: img.urlPre ?? '',
  }));

  return {
    ok: true,
    note: {
      noteId: raw.noteId,
      // 刻意不含 xsec_token：它会过期，落盘只会让 diff 变脏。
      url: `https://www.xiaohongshu.com/explore/${raw.noteId}`,
      title: raw.title ?? '',
      content: stripTopicTags(raw.desc ?? ''),
      tags: (raw.tagList ?? []).map((t) => t.name),
      publishedAt: toBeijingIso(raw.time),
      lastEditedAt: toBeijingIso(isValidTimestamp(raw.lastUpdateTime) ? raw.lastUpdateTime : raw.time),
      author: {
        user_id: raw.user.userId,
        nickname: raw.user.nickname,
        avatar_url: raw.user.avatar,
        profile_url: `https://www.xiaohongshu.com/user/profile/${raw.user.userId}`,
      },
      interact: {
        liked: parseCount(raw.interactInfo?.likedCount),
        collected: parseCount(raw.interactInfo?.collectedCount),
        comment: parseCount(raw.interactInfo?.commentCount),
        share: parseCount(raw.interactInfo?.shareCount),
      },
      images,
      raw,
    },
  };
}
