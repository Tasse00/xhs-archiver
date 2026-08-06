import type { AuthorCardFields, RawAuthorCard } from '../types';
import { parseCount } from './extractor';

/**
 * 计数被平台模糊化的判据。实测大号会返回「10万+」，降级时还出现过「1千+」，
 * 这些经 parseCount 得到的都不是真值，落盘时必须标出来。
 */
function isApproximate(...values: string[]): boolean {
  return values.some((v) => /[+千万亿]/.test(v));
}

/**
 * 卡片响应 → 落盘字段。返回 null 表示这份卡片没有意义，调用方当作没采到。
 *
 * verify_type 只在响应里真的带了 verify_info 时才写：DOM 兜底路径读不到认证
 * 类型，写 0 会让「未认证」与「不知道」变得无法区分。
 */
export function extractAuthorCard(raw: RawAuthorCard, fetchedAt: string): AuthorCardFields | null {
  const ii = raw.interact_info;
  // 三个计数一个都没有的卡片没有采集价值，不写半份数据。
  if (!ii || (ii.follows === undefined && ii.fans === undefined && ii.interaction === undefined)) {
    return null;
  }

  const follows = ii.follows ?? '';
  const fans = ii.fans ?? '';
  const interaction = ii.interaction ?? '';

  const out: AuthorCardFields = {
    desc: raw.basic_info?.desc ?? '',
    follows: parseCount(follows),
    fans: parseCount(fans),
    interaction: parseCount(interaction),
    counts_raw: { follows, fans, interaction },
    approximate: isApproximate(follows, fans, interaction),
    card_fetched_at: fetchedAt,
  };

  const verify = raw.verify_info?.red_official_verify_type;
  if (typeof verify === 'number') out.verify_type = verify;

  return out;
}
