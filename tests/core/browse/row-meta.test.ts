import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../../src/core/store';
import { loadNote } from '../../../src/core/browse/row-meta';
import { memRoot } from '../../helpers/memory-fs';

const A = '6a61e639000000001c00e6d9';
const DS = 'collected/2026-08-03';
const ref = { noteId: A, datasetPath: DS };

function noteJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema_version: 1,
    note_id: A,
    url: `https://www.xiaohongshu.com/explore/${A}`,
    type: 'normal',
    title: '夏日通勤穿搭',
    content: '三件单品搞定一周',
    tags: ['穿搭', '通勤'],
    published_at: '2026-08-01T09:12:00+08:00',
    last_edited_at: '2026-08-02T20:30:00+08:00',
    author: { user_id: 'u1', nickname: '小 A', avatar_url: 'https://x/a.jpg', profile_url: 'https://x/u1' },
    interact: { liked: 1236, collected: 402, comment: 96, share: 31 },
    images: [
      { index: 1, file: 'images/01.jpg', is_live: false, file_id: 'f1', width: 1080, height: 1440,
        declared_width: 1080, declared_height: 1440, bytes: 100, sha256: 'a', source_kind: 'original', source_url: 'https://x/1' },
      { index: 2, file: 'images/02.webp', is_live: false, file_id: 'f2', width: 1080, height: 1440,
        declared_width: 1080, declared_height: 1440, bytes: 100, sha256: 'b', source_kind: 'WB_DFT', source_url: 'https://x/2' },
    ],
    archive: {
      first_archived_at: '2026-08-03T14:02:11+08:00',
      last_archived_at: '2026-08-03T14:02:11+08:00',
      collector: 'zach',
      archive_count: 2,
      status: 'complete',
    },
    raw: { noteId: A, ipLocation: '上海', desc: '很长的原文', imageList: [] },
    ...over,
  });
}

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('loadNote', () => {
  it('一次读取同时产出 RowMeta 与 NoteDetail', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson());
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.meta.title).toBe('夏日通勤穿搭');
    expect(r.meta.authorNickname).toBe('小 A');
    expect(r.meta.liked).toBe(1236);
    expect(r.meta.collected).toBe(402);
    expect(r.meta.comment).toBe(96);
    expect(r.meta.share).toBe(31);
    expect(r.meta.imageCount).toBe(2);
    expect(r.meta.coverFile).toBe('images/01.jpg');
    expect(r.meta.collector).toBe('zach');
    expect(r.meta.archiveCount).toBe(2);
    expect(r.meta.datasetPath).toBe(DS);
    expect(r.detail.images).toHaveLength(2);
    expect(r.detail.author.nickname).toBe('小 A');
  });

  it('IP 从 raw.ipLocation 提取，raw 本身不保留', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson());
    const r = await loadNote(store, ref);
    expect(r.ok && r.detail.ipLocation).toBe('上海');
    // 断言的是「raw 这个键不该存在」，而 NoteDetail/RowMeta 类型里本就没有它，
    // 所以必须先过 unknown 才能转成索引签名类型。
    expect(r.ok && (r.detail as unknown as Record<string, unknown>).raw).toBeUndefined();
    expect(r.ok && (r.meta as unknown as Record<string, unknown>).raw).toBeUndefined();
  });

  it('文件不存在时给出可读原因', async () => {
    const r = await loadNote(store, ref);
    expect(r).toEqual({ ok: false, reason: 'note.json 不存在' });
  });

  it('JSON 损坏时不抛错', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, '{ 坏掉的');
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('解析失败');
  });

  it('缺必要字段时判为错误行', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, JSON.stringify({ note_id: A }));
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('缺少必要字段');
  });

  it('没有图片时 coverFile 为 null', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson({ images: [] }));
    const r = await loadNote(store, ref);
    expect(r.ok && r.meta.coverFile).toBeNull();
    expect(r.ok && r.meta.imageCount).toBe(0);
  });

  it('缺 raw.ipLocation 时给空串而不是崩', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson({ raw: { noteId: A } }));
    const r = await loadNote(store, ref);
    expect(r.ok).toBe(true);
    expect(r.ok && r.detail.ipLocation).toBe('');
  });

  it('读出作者卡片字段', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson({
      author: {
        user_id: 'u1', nickname: '小 A', avatar_url: 'https://x/a.jpg', profile_url: 'https://x/u1',
        desc: '简介', verify_type: 0, follows: 21, fans: 384, interaction: 1500,
        counts_raw: { follows: '21', fans: '384', interaction: '1500' },
        approximate: false, card_fetched_at: '2026-08-06T14:32:10+08:00',
      },
    }));
    const r = await loadNote(store, ref);
    expect(r.ok && r.meta.authorFans).toBe(384);
    expect(r.ok && r.meta.authorInteraction).toBe(1500);
  });

  // 老数据没有这些字段。null 不等于 0——「不知道」和「是 0」必须区分开
  it('老 note.json 没有卡片字段时给 null', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson());
    const r = await loadNote(store, ref);
    expect(r.ok && r.meta.authorFans).toBeNull();
    expect(r.ok && r.meta.authorInteraction).toBeNull();
  });

  it('同一 noteId 在两个数据集下各自独立', async () => {
    await store.writeFile(`${DS}/${A}/note.json`, noteJson({ title: '这份在 08-03' }));
    await store.writeFile(`collected/2026-07-29/${A}/note.json`, noteJson({ title: '这份在 07-29' }));
    const x = await loadNote(store, ref);
    const y = await loadNote(store, { noteId: A, datasetPath: 'collected/2026-07-29' });
    expect(x.ok && x.meta.title).toBe('这份在 08-03');
    expect(y.ok && y.meta.title).toBe('这份在 07-29');
  });
});
