import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../../src/core/store';
import { scanScope } from '../../../src/core/browse/scan';
import { noteKeyOf } from '../../../src/core/browse/scope';
import type { NoteDetail, NoteKey, NoteRef, RowMeta } from '../../../src/core/browse/types';
import { memRoot } from '../../helpers/memory-fs';

const DS = 'collected/2026-08-03';
const ids = [
  '6a61e639000000001c00e6d9',
  '6a6356e8000000002902e848',
  '6a636acb0000000029027397',
];
const refs: NoteRef[] = ids.map((noteId) => ({ noteId, datasetPath: DS }));

function noteJson(id: string, title: string) {
  return JSON.stringify({
    schema_version: 1, note_id: id, url: '', type: 'normal', title, content: '', tags: [],
    published_at: '', last_edited_at: '',
    author: { user_id: 'u', nickname: 'n', avatar_url: '', profile_url: '' },
    interact: { liked: 0, collected: 0, comment: 0, share: 0 },
    images: [],
    archive: { first_archived_at: '', last_archived_at: '', collector: 'zach', archive_count: 1, status: 'complete' },
    raw: {},
  });
}

function sink() {
  return {
    metas: new Map<NoteKey, RowMeta>(),
    details: new Map<NoteKey, NoteDetail>(),
    errors: new Map<NoteKey, string>(),
  };
}

let store: Store;
beforeEach(async () => {
  store = createStore(memRoot());
  for (const [i, id] of ids.entries()) {
    await store.writeFile(`${DS}/${id}/note.json`, noteJson(id, `第 ${i} 篇`));
  }
});

describe('scanScope', () => {
  it('把范围内全部元数据填进 sink', async () => {
    const s = sink();
    const r = await scanScope(store, refs, s, {});
    expect(r).toEqual({ loaded: 3, skipped: 0, failures: [], completed: true });
    expect(s.metas.size).toBe(3);
    expect(s.details.size).toBe(3);
    expect(s.metas.get(noteKeyOf(refs[0]!))!.title).toBe('第 0 篇');
  });

  it('已经加载过的跳过，不重读', async () => {
    const s = sink();
    await scanScope(store, refs, s, {});
    const r = await scanScope(store, refs, s, {});
    expect(r).toEqual({ loaded: 0, skipped: 3, failures: [], completed: true });
  });

  it('回报进度', async () => {
    const seen: [number, number][] = [];
    await scanScope(store, refs, sink(), { onProgress: (d, t) => seen.push([d, t]) });
    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('单篇失败不中断，汇总在 failures 里', async () => {
    await store.writeFile(`${DS}/${ids[1]}/note.json`, '{ 坏');
    const s = sink();
    const r = await scanScope(store, refs, s, {});
    expect(r.loaded).toBe(2);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0]!.ref.noteId).toBe(ids[1]);
    expect(r.completed).toBe(true);
    expect(s.errors.get(noteKeyOf(refs[1]!))).toContain('解析失败');
  });

  it('取消后 completed 为 false，但已读到的保留', async () => {
    const ctrl = new AbortController();
    const s = sink();
    const r = await scanScope(store, refs, s, {
      signal: ctrl.signal,
      onProgress: (done) => { if (done === 1) ctrl.abort(); },
    });
    expect(r.completed).toBe(false);
    expect(r.loaded).toBe(1);
    expect(s.metas.size).toBe(1);
  });

  it('已经取消的 signal 传进来就一篇都不读', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await scanScope(store, refs, sink(), { signal: ctrl.signal });
    expect(r).toEqual({ loaded: 0, skipped: 0, failures: [], completed: false });
  });

  it('空范围直接完成', async () => {
    expect(await scanScope(store, [], sink(), {}))
      .toEqual({ loaded: 0, skipped: 0, failures: [], completed: true });
  });
});
