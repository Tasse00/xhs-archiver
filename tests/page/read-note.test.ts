import { describe, it, expect, afterEach } from 'vitest';
import { readNoteFromPage, parseNoteUrl } from '../../src/page/read-note';

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
  afterEach(() => { delete (globalThis as Record<string, unknown>).__INITIAL_STATE__; });

  function setState(state: unknown) {
    (globalThis as Record<string, unknown>).window = globalThis;
    (globalThis as Record<string, unknown>).__INITIAL_STATE__ = state;
  }

  it('无全局变量时返回 no_state', () => {
    (globalThis as Record<string, unknown>).window = globalThis;
    expect(readNoteFromPage()).toEqual({ ok: false, reason: 'no_state' });
  });

  it('用 currentNoteId._value 定位，忽略脏 key', () => {
    setState({
      note: {
        currentNoteId: { _value: 'real' },
        noteDetailMap: {
          '': { note: { noteId: 'empty-key' } },
          undefined: { note: { noteId: 'undefined-key' } },
          real: { note: { noteId: 'real', type: 'normal' } },
        },
      },
    });
    const r = readNoteFromPage();
    expect(r).toEqual({ ok: true, raw: { noteId: 'real', type: 'normal' } });
  });

  it('currentNoteId 缺失时返回 no_note', () => {
    setState({ note: { noteDetailMap: { real: { note: { noteId: 'real' } } } } });
    expect(readNoteFromPage()).toEqual({ ok: false, reason: 'no_note' });
  });

  it('map 中无对应条目时返回 no_note', () => {
    setState({ note: { currentNoteId: { _value: 'missing' }, noteDetailMap: {} } });
    expect(readNoteFromPage()).toEqual({ ok: false, reason: 'no_note' });
  });
});
