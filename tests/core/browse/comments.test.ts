import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../../src/core/store';
import { commentImagePath, loadComments } from '../../../src/core/browse/comments';
import { memRoot } from '../../helpers/memory-fs';

const A = '6a61e639000000001c00e6d9';
const DS = 'collected/2026-08-03';
const ref = { noteId: A, datasetPath: DS };

const FILE = JSON.stringify({
  schema_version: 1,
  note_id: A,
  declared_total: 96,
  collected_count: 18,
  complete: false,
  has_more: true,
  comments: [
    {
      id: '6a61e88a00000000090162b7',
      content: '这套配色好会挑',
      published_at: '2026-08-01T10:00:00+08:00',
      ip_location: '上海',
      liked_count: 12,
      author: { user_id: 'u2', nickname: '小 D', avatar_url: '', profile_url: '' },
      at_users: [],
      tags: [],
      images: [{ index: 1, file: 'images/comments/6a61e88a00000000090162b7-01.webp',
        width: 556, height: 717, declared_width: 284, declared_height: 367,
        bytes: 1, sha256: 'x', source_kind: 'WB_DFT', source_url: 'https://x/c1' }],
      sub_comment_count: 1,
      sub_comments: [{
        id: '6a636acb0000000029027397',
        content: '谢谢喜欢～',
        published_at: '2026-08-01T10:05:00+08:00',
        ip_location: '上海',
        liked_count: 0,
        author: { user_id: 'u1', nickname: '小 A', avatar_url: '', profile_url: '' },
        at_users: [], tags: [], images: [],
      }],
    },
  ],
});

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('loadComments', () => {
  it('读出完整结构，含子评论与配图', async () => {
    await store.writeFile(`${DS}/${A}/comments.json`, FILE);
    const r = await loadComments(store, ref);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.file.declared_total).toBe(96);
    expect(r.file.collected_count).toBe(18);
    expect(r.file.comments[0]!.sub_comments![0]!.content).toBe('谢谢喜欢～');
    expect(r.file.comments[0]!.images[0]!.file).toContain('images/comments/');
  });

  it('文件不存在是正常状态 none，不是错误', async () => {
    expect(await loadComments(store, ref)).toEqual({ kind: 'none' });
  });

  it('JSON 损坏时报 error 而不是 none', async () => {
    await store.writeFile(`${DS}/${A}/comments.json`, '{ 坏');
    const r = await loadComments(store, ref);
    expect(r.kind).toBe('error');
  });
});

describe('commentImagePath', () => {
  it('拼成相对仓库根的完整路径', () => {
    expect(commentImagePath(ref, 'images/comments/x-01.webp'))
      .toBe(`${DS}/${A}/images/comments/x-01.webp`);
  });
});
