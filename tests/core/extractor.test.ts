import { describe, it, expect } from 'vitest';
import { extract, parseCount } from '../../src/core/extractor';
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
