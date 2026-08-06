import { describe, it, expect } from 'vitest';
import { extractAuthorCard } from '../../src/core/author';
import type { RawAuthorCard } from '../../src/types';

const FETCHED = '2026-08-06T14:32:10+08:00';

const full: RawAuthorCard = {
  basic_info: { nickname: '不会coding的开发', images: 'https://sns-avatar-qc.xhscdn.com/avatar/x', desc: '简介第一行\n第二行' },
  verify_info: { red_official_verify_type: 0 },
  interact_info: { follows: '21', fans: '384', interaction: '1500' },
};

describe('extractAuthorCard', () => {
  it('归一化完整卡片', () => {
    expect(extractAuthorCard(full, FETCHED)).toEqual({
      desc: '简介第一行\n第二行',
      verify_type: 0,
      follows: 21,
      fans: 384,
      interaction: 1500,
      counts_raw: { follows: '21', fans: '384', interaction: '1500' },
      approximate: false,
      card_fetched_at: FETCHED,
    });
  });

  // 大号的计数是「10万+」这种，parseCount 给出的不是真值，必须标出来。
  it('计数带量级后缀时标记 approximate', () => {
    const r = extractAuthorCard({ ...full, interact_info: { follows: '21', fans: '10万+', interaction: '1千+' } }, FETCHED)!;
    expect(r.approximate).toBe(true);
    expect(r.fans).toBe(100000);
    expect(r.interaction).toBe(1000);
    expect(r.counts_raw).toEqual({ follows: '21', fans: '10万+', interaction: '1千+' });
  });

  // DOM 兜底路径读不到认证类型。写 0 会让「未认证」与「不知道」变得无法区分。
  it('没有 verify_info 时整个字段缺席，而不是写 0', () => {
    const r = extractAuthorCard({ ...full, verify_info: undefined }, FETCHED)!;
    expect('verify_type' in r).toBe(false);
  });

  it('简介缺失时给空串', () => {
    const r = extractAuthorCard({ ...full, basic_info: { nickname: 'x' } }, FETCHED)!;
    expect(r.desc).toBe('');
  });

  // 三个计数一个都没有，说明这份卡片没意义，当作没采到而不是写半份数据。
  it('计数全缺时返回 null', () => {
    expect(extractAuthorCard({ ...full, interact_info: {} }, FETCHED)).toBeNull();
    expect(extractAuthorCard({ ...full, interact_info: undefined }, FETCHED)).toBeNull();
  });

  // 计数为「0」是合法的真值，不能当成缺失。
  it('计数为 0 时照常归一化', () => {
    const r = extractAuthorCard({ ...full, interact_info: { follows: '0', fans: '0', interaction: '0' } }, FETCHED)!;
    expect(r).toMatchObject({ follows: 0, fans: 0, interaction: 0, approximate: false });
  });

  it('部分计数缺失时缺的那个记 0，原文记空串', () => {
    const r = extractAuthorCard({ ...full, interact_info: { fans: '384' } }, FETCHED)!;
    expect(r).toMatchObject({ follows: 0, fans: 384, interaction: 0 });
    expect(r.counts_raw).toEqual({ follows: '', fans: '384', interaction: '' });
  });
});
