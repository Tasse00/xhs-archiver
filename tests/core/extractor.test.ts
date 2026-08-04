import { describe, it, expect } from 'vitest';
import { extract, parseCount, stripTopicTags } from '../../src/core/extractor';
import type { RawNote } from '../../src/types';
import imageNote from '../fixtures/note-image.json';
import videoNote from '../fixtures/note-video.json';

describe('parseCount', () => {
  it('纯数字字符串', () => expect(parseCount('1236')).toBe(1236));
  it('万单位', () => expect(parseCount('1.2万')).toBe(12000));
  it('带加号', () => expect(parseCount('10万+')).toBe(100000));
  it('空值归零', () => {
    expect(parseCount('')).toBe(0);
    expect(parseCount(undefined)).toBe(0);
  });
});

describe('stripTopicTags', () => {
  it('剔除连写的话题标签', () => {
    expect(stripTopicTags('正文\n#七夕礼物[话题]##礼物[话题]#')).toBe('正文');
  });

  it('剔除空格分隔的话题标签，并清掉被截断的残缺 #', () => {
    expect(stripTopicTags('正文\n#送礼指南[话题]# #好物分享[话题]# #')).toBe('正文');
  });

  it('剔除夹在正文中间的话题标签', () => {
    expect(stripTopicTags('前面 #礼物[话题]# 后面')).toBe('前面  后面');
  });

  it('保留作者手写的普通井号', () => {
    expect(stripTopicTags('C#入门 #1 名')).toBe('C#入门 #1 名');
  });

  it('没有话题标签时不改动正文', () => {
    expect(stripTopicTags('第一行\n\n第二行')).toBe('第一行\n\n第二行');
  });
});

describe('extract', () => {
  it('拒绝视频笔记', () => {
    const r = extract(videoNote as unknown as RawNote);
    expect(r).toEqual({ ok: false, reason: 'unsupported_video' });
  });

  it('归一化图文笔记', () => {
    const r = extract(imageNote as unknown as RawNote);
    if (!r.ok) throw new Error('should succeed');
    expect(r.note.noteId).toBe('6a030b860000000036000201');
    expect(r.note.title).toBe('听劝改造第四天，学一下许光汉优衣库穿搭');
    expect(r.note.tags).toEqual(['真听劝改造', '听劝改造自己', '找出自我穿搭风格', '穿搭改造', '优衣库']);
    expect(r.note.interact).toEqual({ liked: 1236, collected: 220, comment: 3272, share: 2383 });
    expect(r.note.author.profile_url).toBe('https://www.xiaohongshu.com/user/profile/5b1f8e0c11be103d0f4d2b7a');
    expect(r.note.url).toBe('https://www.xiaohongshu.com/explore/6a030b860000000036000201');
    expect(r.note.images).toHaveLength(1);
    expect(r.note.images[0]!.fileId).toBe('notes_pre_post/1040g3k83202lbd8f48005qcgi63ocap3qtle3do');
    expect(r.note.images[0]!.isLive).toBe(false);
  });

  it('正文剔除话题标签，tags 仍完整', () => {
    const raw = {
      ...(imageNote as unknown as RawNote),
      desc: '正文内容\n#穿搭改造[话题]# #优衣库[话题]#',
    };
    const r = extract(raw);
    if (!r.ok) throw new Error('should succeed');
    expect(r.note.content).toBe('正文内容');
    expect(r.note.tags).toContain('穿搭改造');
  });

  it('采集最后编辑时间', () => {
    const raw = { ...(imageNote as unknown as RawNote), lastUpdateTime: 1784371156000 };
    const r = extract(raw);
    if (!r.ok) throw new Error('should succeed');
    expect(r.note.publishedAt).toBe('2026-05-12T19:14:14+08:00');
    expect(r.note.lastEditedAt).toBe('2026-07-18T18:39:16+08:00');
  });

  // 实测：modal 刚打开时会读到只填了一半的 note，time 缺失让 toBeijingIso
  // 抛 RangeError，错误一路冒泡到面板顶层，显示成一句「Invalid time value」。
  it('time 无效时判为 missing_data，不抛异常', () => {
    for (const time of [undefined, 0, NaN]) {
      const raw = { ...(imageNote as unknown as RawNote), time } as RawNote;
      expect(extract(raw)).toEqual({ ok: false, reason: 'missing_data' });
    }
  });

  it('lastUpdateTime 无效时退回发布时间而不是报错', () => {
    const raw = { ...(imageNote as unknown as RawNote), lastUpdateTime: 0 };
    const r = extract(raw);
    if (!r.ok) throw new Error('should succeed');
    expect(r.note.lastEditedAt).toBe(r.note.publishedAt);
  });

  it('缺作者时判为 missing_data', () => {
    const raw = { ...(imageNote as unknown as RawNote), user: undefined } as unknown as RawNote;
    expect(extract(raw)).toEqual({ ok: false, reason: 'missing_data' });
  });

  it('缺 lastUpdateTime 时退回发布时间', () => {
    const raw = { ...(imageNote as unknown as RawNote) };
    delete raw.lastUpdateTime;
    const r = extract(raw);
    if (!r.ok) throw new Error('should succeed');
    expect(r.note.lastEditedAt).toBe(r.note.publishedAt);
  });

  it('url 中不含 xsec_token', () => {
    const r = extract(imageNote as unknown as RawNote);
    if (!r.ok) throw new Error('should succeed');
    expect(r.note.url).not.toContain('xsec_token');
  });

  it('缺少 imageList 时拒绝', () => {
    const r = extract({ ...(imageNote as unknown as RawNote), imageList: [] });
    expect(r).toEqual({ ok: false, reason: 'missing_data' });
  });
});
