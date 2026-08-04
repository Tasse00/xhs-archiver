import { describe, it, expect, afterEach, vi } from 'vitest';
import { readNoteFromPage, parseNoteUrl, readNoteViaTab } from '../../src/page/read-note';

describe('parseNoteUrl', () => {
  it('识别独立页与 modal（两者 URL 形态相同）', () => {
    expect(parseNoteUrl('https://www.xiaohongshu.com/explore/6a030b86?xsec_token=X')).toBe('6a030b86');
    expect(parseNoteUrl('https://www.xiaohongshu.com/explore/6a030b86')).toBe('6a030b86');
  });
  it('识别用户主页下的笔记链接', () => {
    expect(parseNoteUrl('https://www.xiaohongshu.com/user/profile/u1/6a030b86?x=1')).toBe('6a030b86');
  });
  it('非笔记页返回 null', () => {
    expect(parseNoteUrl('https://www.xiaohongshu.com/explore')).toBeNull();
    expect(parseNoteUrl('https://www.xiaohongshu.com/search_result?keyword=x')).toBeNull();
    expect(parseNoteUrl('https://example.com/explore/abc')).toBeNull();
  });
});

describe('readNoteFromPage', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__INITIAL_STATE__;
    delete (globalThis as Record<string, unknown>).location;
  });

  function setState(state: unknown, pathname = '/explore/6a030b86') {
    (globalThis as Record<string, unknown>).window = globalThis;
    (globalThis as Record<string, unknown>).location = { pathname };
    (globalThis as Record<string, unknown>).__INITIAL_STATE__ = state;
  }

  const dirtyMap = {
    '': { note: { noteId: 'empty-key' } },
    undefined: { note: { noteId: 'undefined-key' } },
    '6a030b86': { note: { noteId: '6a030b86', type: 'normal' } },
  };

  it('无全局变量时返回 no_state', () => {
    (globalThis as Record<string, unknown>).window = globalThis;
    (globalThis as Record<string, unknown>).location = { pathname: '/explore/6a030b86' };
    expect(readNoteFromPage()).toMatchObject({ ok: false, reason: 'no_state' });
  });

  it('用 URL 里的 id 定位，忽略脏 key', () => {
    setState({ note: { currentNoteId: { _value: '6a030b86' }, noteDetailMap: dirtyMap } });
    expect(readNoteFromPage()).toMatchObject({ ok: true, raw: { noteId: '6a030b86', type: 'normal' } });
  });

  // 关掉 modal 再打开时 currentNoteId 会被重置为空，而 map 里的数据仍然完好。
  it('currentNoteId 被清空时仍能按 URL 取到笔记', () => {
    setState({ note: { currentNoteId: { _value: '' }, noteDetailMap: dirtyMap } });
    expect(readNoteFromPage()).toMatchObject({ ok: true, raw: { noteId: '6a030b86', type: 'normal' } });
  });

  it('URL 与 currentNoteId 不一致时以 URL 为准', () => {
    setState({
      note: {
        currentNoteId: { _value: 'stale' },
        noteDetailMap: { ...dirtyMap, stale: { note: { noteId: 'stale' } } },
      },
    });
    expect(readNoteFromPage()).toMatchObject({ ok: true, raw: { noteId: '6a030b86', type: 'normal' } });
  });

  it('URL 上没有 id 时退回 currentNoteId', () => {
    setState({ note: { currentNoteId: { _value: '6a030b86' }, noteDetailMap: dirtyMap } }, '/explore');
    expect(readNoteFromPage()).toMatchObject({ ok: true, raw: { noteId: '6a030b86', type: 'normal' } });
  });

  it('URL 与 currentNoteId 都取不到 id 时返回 no_note', () => {
    setState({ note: { currentNoteId: { _value: '' }, noteDetailMap: dirtyMap } }, '/explore');
    expect(readNoteFromPage()).toMatchObject({ ok: false, reason: 'no_note' });
  });

  it('map 中无对应条目时返回 no_note', () => {
    setState({ note: { currentNoteId: { _value: 'missing' }, noteDetailMap: {} } });
    expect(readNoteFromPage()).toMatchObject({ ok: false, reason: 'no_note' });
  });

  it('回传现场快照供排查', () => {
    setState({ note: { currentNoteId: { _value: 'stale' }, noteDetailMap: dirtyMap } });
    expect(readNoteFromPage().diag).toEqual({
      pathname: '/explore/6a030b86',
      urlId: '6a030b86',
      currentNoteId: 'stale',
      mapKeys: ['', 'undefined', '6a030b86'],
      entryFound: true,
    });
  });

  // 抛出去会让 executeScript 的 result 变成 undefined，现场信息就全丢了。
  it('页面内抛异常时归为 page_error 并带回错误原文', () => {
    setState({
      note: {
        currentNoteId: { _value: '6a030b86' },
        get noteDetailMap(): never { throw new TypeError('boom'); },
      },
    });
    const r = readNoteFromPage();
    expect(r).toMatchObject({ ok: false, reason: 'page_error', detail: 'TypeError: boom' });
    expect(r.diag.error).toBe('TypeError: boom');
  });
});

describe('readNoteViaTab 的失败归因', () => {
  function stubExecuteScript(impl: () => unknown) {
    vi.stubGlobal('chrome', { scripting: { executeScript: impl } });
  }
  afterEach(() => vi.unstubAllGlobals());

  it('executeScript 抛出时归为 inject_failed 并带上原文', async () => {
    stubExecuteScript(() => Promise.reject(new Error('Cannot access contents of the page')));
    expect(await readNoteViaTab(1)).toMatchObject({
      ok: false,
      reason: 'inject_failed',
      detail: 'Cannot access contents of the page',
    });
  });

  it('注入无返回值时归为 inject_failed，不再冒充 no_state', async () => {
    stubExecuteScript(() => Promise.resolve([{ result: undefined }]));
    expect(await readNoteViaTab(1)).toMatchObject({
      ok: false,
      reason: 'inject_failed',
      detail: '注入脚本无返回值',
    });
  });

  // Chrome 把页面内抛出的异常放在 error 字段里，不读就只剩「无返回值」。
  it('优先采用 Chrome 给出的注入错误信息', async () => {
    stubExecuteScript(() => Promise.resolve([{ result: undefined, error: { message: 'boom' } }]));
    expect(await readNoteViaTab(1)).toMatchObject({ reason: 'inject_failed', detail: 'boom' });
  });

  it('没有命中任何 frame 时归为 inject_failed', async () => {
    stubExecuteScript(() => Promise.resolve([]));
    expect(await readNoteViaTab(1)).toMatchObject({
      ok: false,
      reason: 'inject_failed',
      detail: '注入未命中任何 frame',
    });
  });

  it('失败时也始终带上 diag，调用方不必判空', async () => {
    stubExecuteScript(() => Promise.resolve([]));
    expect((await readNoteViaTab(1)).diag).toMatchObject({ pathname: '', urlId: null });
  });

  it('页面真的没有全局变量时才报 no_state', async () => {
    const diag = { pathname: '/explore/x', urlId: 'x', currentNoteId: null, mapKeys: [], entryFound: false };
    stubExecuteScript(() => Promise.resolve([{ result: { ok: false, reason: 'no_state', diag } }]));
    expect(await readNoteViaTab(1)).toEqual({ ok: false, reason: 'no_state', diag });
  });
});
