import { describe, it, expect } from 'vitest';
import { serializeComments, serializeNote, serializePointer, sortKeysDeep } from '../../src/core/serialize';
import type { CommentsFile, NoteRecord, Pointer } from '../../src/types';

const base: NoteRecord = {
  schema_version: 1,
  note_id: 'abc',
  url: 'https://www.xiaohongshu.com/explore/abc',
  type: 'normal',
  title: 't',
  content: 'c',
  tags: ['x'],
  published_at: '2026-05-12T12:34:14+08:00',
  last_edited_at: '2026-07-16T13:19:16+08:00',
  author: { user_id: 'u', nickname: 'n', avatar_url: 'a', profile_url: 'p' },
  interact: { liked: 1, collected: 2, comment: 3, share: 4 },
  images: [{
    index: 1, file: 'images/01.jpg', is_live: false, file_id: 'f',
    width: 10, height: 20, declared_width: 10, declared_height: 20,
    bytes: 100, sha256: 'deadbeef', source_kind: 'original', source_url: 'https://x/f',
  }],
  archive: {
    first_archived_at: '2026-08-03T14:02:11+08:00',
    last_archived_at: '2026-08-03T14:02:11+08:00',
    collector: 'zach', archive_count: 1, status: 'complete',
  },
  raw: { zulu: 1, alpha: 2 } as never,
};

describe('serializeNote', () => {
  it('key 顺序固定，2 空格缩进，末尾换行', () => {
    const out = serializeNote(base);
    expect(out.endsWith('}\n')).toBe(true);
    expect(out).toContain('\n  "note_id": "abc",');
    const keys = Object.keys(JSON.parse(out));
    expect(keys).toEqual([
      'schema_version', 'note_id', 'url', 'type', 'title', 'content', 'tags',
      'published_at', 'last_edited_at', 'author', 'interact', 'images', 'archive', 'raw',
    ]);
  });

  it('输入 key 顺序不同不影响输出', () => {
    const shuffled = JSON.parse(JSON.stringify(base));
    const reordered: NoteRecord = { ...shuffled, raw: { alpha: 2, zulu: 1 } };
    expect(serializeNote(reordered)).toBe(serializeNote(base));
  });

  it('raw 的 key 被递归排序', () => {
    const out = JSON.parse(serializeNote(base));
    expect(Object.keys(out.raw)).toEqual(['alpha', 'zulu']);
  });

  it('相同输入两次输出完全一致', () => {
    expect(serializeNote(base)).toBe(serializeNote(base));
  });
});

describe('sortKeysDeep', () => {
  it('数组内的对象也被排序', () => {
    const r = sortKeysDeep({ list: [{ b: 1, a: 2 }] }) as { list: object[] };
    expect(Object.keys(r.list[0]!)).toEqual(['a', 'b']);
  });
  it('null 与原始值原样返回', () => {
    expect(sortKeysDeep(null)).toBeNull();
    expect(sortKeysDeep(5)).toBe(5);
  });
});

describe('serializeComments', () => {
  const file: CommentsFile = {
    schema_version: 1,
    note_id: 'abc',
    declared_total: 96,
    collected_count: 2,
    complete: false,
    has_more: true,
    comments: [{
      id: 'c1',
      content: '正文',
      published_at: '2026-07-24T20:13:29+08:00',
      ip_location: '安徽',
      liked_count: 8,
      author: { user_id: 'u', nickname: 'n', avatar_url: 'a', profile_url: 'p' },
      at_users: [{ user_id: 'u2', nickname: 'n2' }],
      tags: ['is_author'],
      images: [{
        index: 1, file: 'images/comments/c1-01.webp',
        width: 556, height: 717, declared_width: 284, declared_height: 367,
        bytes: 26074, sha256: 'deadbeef', source_kind: 'WB_DFT', source_url: 'https://x/d',
      }],
      sub_comment_count: 1,
      sub_comments: [{
        id: 'c1s1',
        content: '回复',
        published_at: '2026-07-24T21:50:00+08:00',
        ip_location: '上海',
        liked_count: 0,
        author: { user_id: 'u3', nickname: 'n3', avatar_url: 'a3', profile_url: 'p3' },
        at_users: [],
        tags: [],
        images: [],
      }],
    }],
  };

  it('顶层与评论的 key 顺序固定，末尾换行', () => {
    const out = serializeComments(file);
    expect(out.endsWith('}\n')).toBe(true);
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed)).toEqual([
      'schema_version', 'note_id', 'declared_total', 'collected_count',
      'complete', 'has_more', 'comments',
    ]);
    expect(Object.keys(parsed.comments[0])).toEqual([
      'id', 'content', 'published_at', 'ip_location', 'liked_count',
      'author', 'at_users', 'tags', 'images', 'sub_comment_count', 'sub_comments',
    ]);
  });

  // 回复不会再有回复，多输出两个恒定字段只是噪音。
  it('子评论不带 sub_comment_count / sub_comments', () => {
    const sub = JSON.parse(serializeComments(file)).comments[0].sub_comments[0];
    expect(Object.keys(sub)).toEqual([
      'id', 'content', 'published_at', 'ip_location', 'liked_count',
      'author', 'at_users', 'tags', 'images',
    ]);
  });

  it('相同输入两次输出完全一致', () => {
    expect(serializeComments(file)).toBe(serializeComments(file));
  });
});

describe('serializePointer', () => {
  it('固定 key 顺序，末尾换行', () => {
    const p: Pointer = {
      note_id: 'abc', path: 'zach/2026-08-03/abc', collector: 'zach', title: 't',
      first_archived_at: '2026-08-03T14:02:11+08:00',
      last_archived_at: '2026-08-03T14:02:11+08:00',
    };
    const out = serializePointer(p);
    expect(out.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(out))).toEqual([
      'note_id', 'path', 'collector', 'title', 'first_archived_at', 'last_archived_at',
    ]);
  });
});
