import { describe, it, expect } from 'vitest';
import { resolvePanelState, type ResolveInput } from '../../src/sidepanel/usePanelState';
import { createStore } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { writePointer } from '../../src/core/index-store';
import type { Pointer } from '../../src/types';
import imageNote from '../fixtures/note-image.json';
import videoNote from '../fixtures/note-video.json';

const NOTE_ID = '6a030b860000000036000201';
const NOTE_URL = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=X`;

function baseInput(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    hasRoot: true,
    store: createStore(memRoot()),
    collector: 'zach',
    tabUrl: NOTE_URL,
    readNote: async () => ({ ok: true, raw: imageNote as never }),
    ...over,
  };
}

const ptr = (collector: string): Pointer => ({
  note_id: NOTE_ID, path: `${collector}/2026-08-01/${NOTE_ID}`, collector, title: 't',
  first_archived_at: '2026-08-01T10:00:00+08:00',
  last_archived_at: '2026-08-01T10:00:00+08:00',
});

describe('resolvePanelState 优先级', () => {
  it('未授权目录优先于一切', async () => {
    const s = await resolvePanelState(baseInput({ hasRoot: false, collector: null }));
    expect(s.kind).toBe('need_root');
  });

  it('未设采集者 ID 次之', async () => {
    const s = await resolvePanelState(baseInput({ collector: null }));
    expect(s.kind).toBe('need_collector');
  });

  it('非小红书页', async () => {
    const s = await resolvePanelState(baseInput({ tabUrl: 'https://example.com/' }));
    expect(s.kind).toBe('not_xhs');
  });

  it('小红书但非笔记页', async () => {
    const s = await resolvePanelState(baseInput({ tabUrl: 'https://www.xiaohongshu.com/explore' }));
    expect(s.kind).toBe('not_note');
  });

  it('读不到页面数据', async () => {
    const s = await resolvePanelState(baseInput({ readNote: async () => ({ ok: false, reason: 'no_state' }) }));
    expect(s.kind).toBe('unreadable');
  });

  it('视频笔记被拒绝', async () => {
    const s = await resolvePanelState(baseInput({ readNote: async () => ({ ok: true, raw: videoNote as never }) }));
    expect(s.kind).toBe('video_rejected');
  });

  it('他人已采集时阻止', async () => {
    const store = createStore(memRoot());
    await writePointer(store, ptr('alice'));
    const s = await resolvePanelState(baseInput({ store }));
    expect(s.kind).toBe('blocked_by_other');
    if (s.kind !== 'blocked_by_other') throw new Error();
    expect(s.pointers[0]!.collector).toBe('alice');
  });

  it('自己已采集时可更新或迁移', async () => {
    const store = createStore(memRoot());
    await writePointer(store, ptr('zach'));
    const s = await resolvePanelState(baseInput({ store }));
    expect(s.kind).toBe('mine');
  });

  it('全新笔记就绪可采', async () => {
    const s = await resolvePanelState(baseInput());
    expect(s.kind).toBe('ready');
    if (s.kind !== 'ready') throw new Error();
    expect(s.note.noteId).toBe(NOTE_ID);
  });

  it('存在多个指针时带出重复提示', async () => {
    const store = createStore(memRoot());
    await writePointer(store, ptr('zach'));
    await writePointer(store, ptr('bob'));
    const s = await resolvePanelState(baseInput({ store }));
    if (s.kind !== 'mine') throw new Error();
    expect(s.duplicates).toHaveLength(1);
  });
});
