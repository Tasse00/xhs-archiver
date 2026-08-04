import { describe, it, expect } from 'vitest';
import { extractComments } from '../../src/core/comments';
import type { RawComments } from '../../src/types';
import raw from '../fixtures/note-comments.json';

const fixture = raw as unknown as RawComments;

describe('extractComments', () => {
  it('归一化主评论', () => {
    const c = extractComments(fixture, 96);
    expect(c.list[0]).toMatchObject({
      id: '6a6356e8000000002902e848',
      content: '没招了家人们[微笑R]说我笔记违规了，我真的纯陈述事实啊[哭惹R]',
      publishedAt: '2026-07-24T20:13:29+08:00',
      ipLocation: '安徽',
      likedCount: 8,
      tags: ['is_author', 'user_top'],
      subCommentCount: 0,
    });
    expect(c.list[0]!.author).toEqual({
      user_id: '5fc8bc69000000000101f483',
      nickname: 'momo',
      avatar_url:
        'https://sns-avatar-qc.xhscdn.com/avatar/1040g2jo31rcqu0hr7u605nu8nhkgbt431kc6ls0?imageView2/2/w/120/format/jpg',
      profile_url: 'https://www.xiaohongshu.com/user/profile/5fc8bc69000000000101f483',
    });
  });

  // 点赞数和笔记的互动数一样是字符串，会出现「1.2万」。
  it('点赞数按互动数的规则解析', () => {
    expect(extractComments(fixture, 96).list[1]!.likedCount).toBe(12000);
  });

  it('子评论同样归一化，且不再向下嵌套', () => {
    const sub = extractComments(fixture, 96).list[1]!.subComments ?? [];
    expect(sub).toHaveLength(1);
    expect(sub[0]).toMatchObject({
      id: '6a636d9c00000000150145a8',
      content: '笑死我了',
      publishedAt: '2026-07-24T21:50:00+08:00',
      ipLocation: '上海',
    });
    expect(sub[0]).not.toHaveProperty('subComments');
    expect(sub[0]!.atUsers).toEqual([
      { user_id: '591569c650c4b43f2bb4c0de', nickname: '樱桃小王子（上岸版）' },
    ]);
  });

  // xsecToken 会过期，落盘只是让 diff 变脏；liked 是「当前账号点没点赞」，
  // 与采集者绑定，两个采集者采同一篇会得到不同的值。
  it('不落 xsecToken 与 liked', () => {
    const json = JSON.stringify(extractComments(fixture, 96));
    expect(json).not.toContain('xsecToken');
    expect(json).not.toContain('ABs8ikdGLzFuRyDHJrmyZ7T7hdttSuICiK69pKdwq50LU=');
    expect(json).not.toContain('"liked"');
  });

  it('评论图只留 WB_DFT / WB_PRV，并升到 https', () => {
    const imgs = extractComments(fixture, 96).list[2]!.images;
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatchObject({
      index: 1,
      declaredWidth: 284,
      declaredHeight: 367,
    });
    expect(imgs[0]!.urlDefault).toMatch(/^https:\/\//);
    expect(imgs[0]!.urlPre).toMatch(/^https:\/\//);
  });

  // 主评论 3 条 + 子评论 1 条 = 4，而页面声明有 96 条。
  it('计数区分「实际采到」与「页面声明」', () => {
    const c = extractComments(fixture, 96);
    expect(c.collectedCount).toBe(4);
    expect(c.declaredTotal).toBe(96);
    expect(c.complete).toBe(false);
    expect(c.hasMore).toBe(true);
  });

  it('采满了就是完整的', () => {
    const c = extractComments(fixture, 4);
    expect(c.complete).toBe(true);
  });

  // 评论是附属数据：读不到也绝不能让整篇笔记采不成。
  it('没有评论字段时返回空集而不是抛错', () => {
    for (const v of [undefined, null, {}, { list: null }] as unknown[]) {
      const c = extractComments(v as RawComments | undefined, 0);
      expect(c.list).toEqual([]);
      expect(c.collectedCount).toBe(0);
    }
  });

  // 与 note 同理：createTime 缺失会让 toBeijingIso 抛 RangeError。
  it('时间戳无效的评论整条丢弃，不牵连其他评论', () => {
    const bad: RawComments = {
      list: [
        { id: 'a', createTime: 0, userInfo: { userId: 'u', nickname: 'n', image: '' } },
        { id: 'b', createTime: 1784895209000, userInfo: { userId: 'u', nickname: 'n', image: '' } },
      ] as never,
    };
    const c = extractComments(bad, 2);
    expect(c.list.map((x) => x.id)).toEqual(['b']);
  });

  it('缺 id 或缺 userInfo 的评论同样丢弃', () => {
    const bad: RawComments = {
      list: [
        { id: '', createTime: 1784895209000, userInfo: { userId: 'u', nickname: 'n', image: '' } },
        { id: 'c', createTime: 1784895209000 },
      ] as never,
    };
    expect(extractComments(bad, 2).list).toEqual([]);
  });
});
