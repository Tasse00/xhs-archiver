// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { writeArticleNote } from '../../src/core/article-note';
import { useArticleNote } from '../../src/sidepanel/useArticleNote';
import { ArticleNoteEditor } from '../../src/sidepanel/components/ArticleNoteEditor';

afterEach(cleanup);

const A = '6a030b860000000036000201';
const B = '6a030b860000000036000202';
const DIR = `collected/${A}`;

describe('useArticleNote', () => {
  it('加载已有 Note，并能取消回已保存内容', async () => {
    const store = createStore(memRoot());
    await writeArticleNote(store, DIR, '磁盘内容');
    const { result } = renderHook(() => useArticleNote(store, A, DIR));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.value).toBe('磁盘内容');

    act(() => result.current.setValue('临时修改'));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.cancel());
    expect(result.current.value).toBe('磁盘内容');
  });

  it('按 note_id 保留当前侧边栏生命周期里的新文章草稿', () => {
    const store = createStore(memRoot());
    const props = { noteId: A, path: null as string | null };
    const { result, rerender } = renderHook(
      ({ noteId, path }) => useArticleNote(store, noteId, path),
      { initialProps: props },
    );
    act(() => result.current.setValue('A 的草稿'));
    rerender({ noteId: B, path: null });
    act(() => result.current.setValue('B 的草稿'));
    rerender({ noteId: A, path: null });
    expect(result.current.value).toBe('A 的草稿');
  });

  it('已有文章独立保存，失败时保留草稿和错误', async () => {
    const store = createStore(memRoot());
    const { result } = renderHook(() => useArticleNote(store, A, DIR));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setValue('要保存'));
    await act(async () => { expect(await result.current.save()).toBe(true); });
    expect(result.current.dirty).toBe(false);
    expect(result.current.notice).toBe('Note 已保存');

    const broken: Store = {
      ...store,
      writeFile: async () => { throw new Error('save boom'); },
    };
    const failed = renderHook(() => useArticleNote(broken, B, `collected/${B}`));
    await waitFor(() => expect(failed.result.current.loading).toBe(false));
    act(() => failed.result.current.setValue('不能丢'));
    await act(async () => { expect(await failed.result.current.save()).toBe(false); });
    expect(failed.result.current.value).toBe('不能丢');
    expect(failed.result.current.error).toContain('save boom');
  });

  it('读取失败时不能把默认空值保存回磁盘', async () => {
    const base = createStore(memRoot());
    const broken: Store = {
      ...base,
      readText: async () => { throw new Error('read boom'); },
    };
    const { result } = renderHook(() => useArticleNote(broken, A, DIR));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loaded).toBe(false);
    expect(result.current.error).toContain('read boom');
    await act(async () => { expect(await result.current.save()).toBe(false); });
  });

  it('归档值区分新文章、未编辑旧文章和明确清空', async () => {
    const store = createStore(memRoot());
    const fresh = renderHook(() => useArticleNote(store, A, null));
    expect(fresh.result.current.archiveValue).toBe('');

    await writeArticleNote(store, `collected/${B}`, '旧内容');
    const old = renderHook(() => useArticleNote(store, B, `collected/${B}`));
    await waitFor(() => expect(old.result.current.loading).toBe(false));
    expect(old.result.current.archiveValue).toBeUndefined();
    act(() => old.result.current.setValue(''));
    expect(old.result.current.archiveValue).toBe('');
  });

  it('归档成功后用新路径标记为已保存', () => {
    const store = createStore(memRoot());
    const { result } = renderHook(() => useArticleNote(store, A, null));
    act(() => result.current.setValue('一起保存'));
    act(() => result.current.markArchived(DIR));
    expect(result.current.path).toBe(DIR);
    expect(result.current.saved).toBe('一起保存');
    expect(result.current.dirty).toBe(false);
  });

  it('已归档文章可主动重新读取磁盘，未归档草稿不会被刷新清空', async () => {
    const store = createStore(memRoot());
    await writeArticleNote(store, DIR, '第一次读取');
    const archived = renderHook(() => useArticleNote(store, A, DIR));
    await waitFor(() => expect(archived.result.current.loading).toBe(false));
    await writeArticleNote(store, DIR, '磁盘外部修改');
    act(() => archived.result.current.reload());
    await waitFor(() => expect(archived.result.current.value).toBe('磁盘外部修改'));

    const fresh = renderHook(() => useArticleNote(store, B, null));
    act(() => fresh.result.current.setValue('未提交草稿'));
    act(() => fresh.result.current.reload());
    expect(fresh.result.current.value).toBe('未提交草稿');
  });
});

describe('ArticleNoteEditor', () => {
  it('新文章只提示随采集保存，不显示独立保存按钮', () => {
    render(createElement(ArticleNoteEditor, {
      archived: false, value: '', saved: '', loading: false, saving: false,
      loaded: true, disabled: false, error: null, notice: null,
      onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(),
    }));
    expect(screen.getByText('将在采集文章时一并保存')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull();
  });

  it('已归档文章修改后可以保存或取消', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(createElement(ArticleNoteEditor, {
      archived: true, value: '改后', saved: '改前', loading: false, saving: false,
      loaded: true, disabled: false, error: null, notice: null, onChange, onSave, onCancel,
    }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note（可选）' }), { target: { value: '继续改' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onChange).toHaveBeenCalledWith('继续改');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('加载和保存期间禁用输入，错误内容可见', () => {
    const { rerender } = render(createElement(ArticleNoteEditor, {
      archived: true, value: '', saved: '', loading: true, saving: false,
      loaded: false, disabled: false, error: null, notice: null,
      onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(),
    }));
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true);
    rerender(createElement(ArticleNoteEditor, {
      archived: true, value: '不能丢', saved: '', loading: false, saving: false, disabled: false,
      loaded: true, error: 'save boom', notice: null, onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(),
    }));
    expect(screen.getByText(/save boom/)).toBeTruthy();
    expect(screen.getByDisplayValue('不能丢')).toBeTruthy();
  });

  it('保存成功给出轻量反馈，外部写入时禁用编辑', () => {
    render(createElement(ArticleNoteEditor, {
      archived: true, value: '已存', saved: '已存', loading: false, saving: false, disabled: true,
      loaded: true, error: null, notice: 'Note 已保存', onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(),
    }));
    expect(screen.getByText('Note 已保存')).toBeTruthy();
    expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true);
  });
});
