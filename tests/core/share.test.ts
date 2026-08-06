import { describe, it, expect } from 'vitest';
import { extractShareUrl } from '../../src/core/share';

const NOTE_ID = '6a7149a6000000003400fae7';

const LINK =
  `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}` +
  '?source=webshare&xhsshare=pc_web' +
  '&xsec_token=ABgs7kX8938ifiJA_xrpVY2l9vAGJLGjJVkg86_DgFol8=&xsec_source=pc_share';

/** 实测「复制链接」写进剪贴板的形态：分享码 + 标题 + 链接。 */
const COPIED = `61 【40万翻新的自建房还是毛胚怎么办？ - 大疏不是大叔 | 小红书 - 你的生活兴趣社区】 😆 ${LINK}`;

describe('extractShareUrl', () => {
  it('从口令文案里取出链接', () => {
    expect(extractShareUrl(COPIED, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });

  it('文案就是一条裸链接时照样取得到', () => {
    expect(extractShareUrl(LINK, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });

  it('文案里没有链接时报 no_url', () => {
    const r = extractShareUrl('61 【标题】 复制本条信息，打开【小红书】App', NOTE_ID);
    expect(r).toEqual({ ok: false, reason: 'no_url' });
  });

  it('空文本报 no_url', () => {
    expect(extractShareUrl('', NOTE_ID)).toEqual({ ok: false, reason: 'no_url' });
  });

  // 与作者卡片的 uid 校验同理：页面中途切了笔记，拿到的是上一篇的链接，
  // 写进去就是张冠李戴。
  it('链接指向别的笔记时报 id_mismatch', () => {
    const r = extractShareUrl(COPIED, '6a72e9160000000008012abb');
    expect(r).toEqual({ ok: false, reason: 'id_mismatch' });
  });

  // no_url 与 id_mismatch 指向完全不同的排查方向，不能兜成同一个值
  it('两种失败可区分', () => {
    const a = extractShareUrl('没有链接', NOTE_ID);
    const b = extractShareUrl(LINK, 'other');
    expect(a).not.toEqual(b);
  });

  it('链接后面还有文案时只取链接本身', () => {
    const withTail = `${COPIED}，复制本条信息，打开【小红书】App查看精彩内容！`;
    expect(extractShareUrl(withTail, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });

  it('剥掉链接尾部的中文标点', () => {
    expect(extractShareUrl(`${LINK}。`, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });

  it('链接被引号包住时不把引号算进去', () => {
    expect(extractShareUrl(`分享："${LINK}"`, NOTE_ID)).toEqual({ ok: true, url: LINK });
  });
});
