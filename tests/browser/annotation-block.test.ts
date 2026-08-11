// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { readArticleNote, writeArticleNote } from '../../src/core/article-note';
import { AnnotationBlock } from '../../src/browser/components/AnnotationBlock';

afterEach(cleanup);

const noteRef = { noteId: '6a030b860000000036000201', datasetPath: 'collected' };
const DIR = `collected/${noteRef.noteId}`;

describe('AnnotationBlock', () => {
  it('文件不存在时显示空状态，添加后写入磁盘', async () => {
    const store = createStore(memRoot());
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange: vi.fn() }));
    await waitFor(() => expect(screen.getByText('暂无 Note')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '浏览页添加' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText('浏览页添加')).toBeTruthy());
    expect(screen.getByText('Note 已保存')).toBeTruthy();
    expect(await readArticleNote(store, DIR)).toBe('浏览页添加');
  });

  it('展示已有多行内容，取消恢复已保存内容', async () => {
    const store = createStore(memRoot());
    await writeArticleNote(store, DIR, '第一行\n第二行');
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange: vi.fn() }));
    await waitFor(() => expect(screen.getByText(/第一行/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '临时修改' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByText(/第一行/)).toBeTruthy();
    expect(await readArticleNote(store, DIR)).toBe('第一行\n第二行');
  });

  it('清空保存时删除文件', async () => {
    const store = createStore(memRoot());
    await writeArticleNote(store, DIR, '待清空');
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange: vi.fn() }));
    await waitFor(() => expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText('暂无 Note')).toBeTruthy());
    expect(await store.exists(`${DIR}/annotation.txt`)).toBe(false);
  });

  it('保存失败时保留输入和编辑状态，并通知上层 busy 已结束', async () => {
    const base = createStore(memRoot());
    const store: Store = { ...base, writeFile: async () => { throw new Error('save boom'); } };
    const onSavingChange = vi.fn();
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange }));
    await waitFor(() => expect(screen.getByText('暂无 Note')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '不能丢' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.getByText(/save boom/)).toBeTruthy());
    expect(screen.getByDisplayValue('不能丢')).toBeTruthy();
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
  });

  it('读取失败不显示成空 Note，并允许重试', async () => {
    let broken = true;
    const base = createStore(memRoot());
    const store: Store = {
      ...base,
      readText: async (path) => {
        if (broken && path.endsWith('annotation.txt')) throw new Error('read boom');
        return base.readText(path);
      },
    };
    render(createElement(AnnotationBlock, { store, noteRef, disabled: false, onSavingChange: vi.fn() }));
    await waitFor(() => expect(screen.getByText(/read boom/)).toBeTruthy());
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.getByText('暂无 Note')).toBeTruthy());
  });

  it('删除写盘期间禁用添加入口', async () => {
    const store = createStore(memRoot());
    render(createElement(AnnotationBlock, {
      store, noteRef, disabled: true, onSavingChange: vi.fn(),
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: '添加' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '添加' }).hasAttribute('disabled')).toBe(true);
  });
});
