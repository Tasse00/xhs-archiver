import { describe, it, expect } from 'vitest';
import { isTransient, resolvePanelState, type ResolveInput } from '../../src/sidepanel/usePanelState';
import type { PageDiag } from '../../src/page/read-note';
import { createStore } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { writePointer } from '../../src/core/index-store';
import type { Pointer } from '../../src/types';
import imageNote from '../fixtures/note-image.json';
import videoNote from '../fixtures/note-video.json';

const NOTE_ID = '6a030b860000000036000201';
const NOTE_URL = `https://www.xiaohongshu.com/explore/${NOTE_ID}?xsec_token=X`;

function diagOf(over: Partial<PageDiag> = {}): PageDiag {
  return {
    pathname: `/explore/${NOTE_ID}`,
    urlId: NOTE_ID,
    currentNoteId: NOTE_ID,
    mapKeys: [NOTE_ID],
    entryFound: true,
    ...over,
  };
}

/** 页面自己说「当前地址上没有笔记」时的现场。 */
const NO_NOTE_DIAG = diagOf({
  pathname: '/explore',
  urlId: null,
  currentNoteId: '',
  mapKeys: [],
  entryFound: false,
});

function baseInput(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    hasRoot: true,
    store: createStore(memRoot()),
    collector: 'zach',
    tabUrl: NOTE_URL,
    readNote: async () => ({ ok: true, raw: imageNote as never, diag: diagOf() }),
    ...over,
  };
}

const ptr = (collector: string): Pointer => ({
  note_id: NOTE_ID, path: `${collector}/2026-08-01/${NOTE_ID}`, collector, title: 't',
  first_archived_at: '2026-08-01T10:00:00+08:00',
  last_archived_at: '2026-08-01T10:00:00+08:00',
});

describe('isTransient', () => {
  it('只有等一下可能自愈的才重试', () => {
    expect(isTransient('no_note')).toBe(true);
    expect(isTransient('incomplete_data')).toBe(true);
    // 这些重试多少次都一样，重试只会刷屏
    expect(isTransient('no_state')).toBe(false);
    expect(isTransient('inject_failed')).toBe(false);
    expect(isTransient('page_error')).toBe(false);
    expect(isTransient('panel_error')).toBe(false);
  });
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
    const s = await resolvePanelState(baseInput({
      tabUrl: 'https://www.xiaohongshu.com/explore',
      readNote: async () => ({ ok: false, reason: 'no_note', diag: NO_NOTE_DIAG }),
    }));
    expect(s.kind).toBe('not_note');
  });

  // modal 关掉后 tab.url 会滞后，仍带着上一篇的 id。以页面自己报的地址为准。
  it('tab.url 滞后于页面时按页面判定为未打开笔记', async () => {
    const s = await resolvePanelState(baseInput({
      tabUrl: NOTE_URL,
      readNote: async () => ({ ok: false, reason: 'no_note', diag: NO_NOTE_DIAG }),
    }));
    expect(s.kind).toBe('not_note');
  });

  it('读不到页面数据', async () => {
    const s = await resolvePanelState(baseInput({
      readNote: async () => ({ ok: false, reason: 'no_state', diag: diagOf() }),
    }));
    expect(s.kind).toBe('unreadable');
  });

  it('页面上确实打开着笔记却读不到条目时报 unreadable', async () => {
    const s = await resolvePanelState(baseInput({
      readNote: async () => ({
        ok: false,
        reason: 'no_note',
        diag: diagOf({ mapKeys: [], entryFound: false }),
      }),
    }));
    expect(s.kind).toBe('unreadable');
  });

  it('注入失败时保留原因与详情', async () => {
    const s = await resolvePanelState(baseInput({
      readNote: async () => ({
        ok: false,
        reason: 'inject_failed',
        detail: '注入脚本无返回值',
        diag: diagOf({ pathname: '' }),
      }),
    }));
    expect(s).toMatchObject({ kind: 'unreadable', reason: 'inject_failed', detail: '注入脚本无返回值' });
  });

  it('每次读页面都回调诊断信息', async () => {
    const seen: PageDiag[] = [];
    await resolvePanelState(baseInput({ onDiag: (d) => seen.push(d) }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.urlId).toBe(NOTE_ID);
  });

  // 半份数据不能进 extract 的成功分支，更不能让异常冒泡到面板顶层。
  it('数据不完整时报 incomplete_data', async () => {
    const half = { ...(imageNote as Record<string, unknown>), time: undefined };
    const s = await resolvePanelState(baseInput({
      readNote: async () => ({ ok: true, raw: half as never, diag: diagOf() }),
    }));
    expect(s).toMatchObject({ kind: 'unreadable', reason: 'incomplete_data' });
  });

  it('视频笔记被拒绝', async () => {
    const s = await resolvePanelState(baseInput({
      readNote: async () => ({ ok: true, raw: videoNote as never, diag: diagOf() }),
    }));
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
