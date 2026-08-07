// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PathDisplay } from '../../src/sidepanel/components/Actions';
import { NoteView } from '../../src/sidepanel/components/NoteView';
import { PathSetup } from '../../src/sidepanel/components/Setup';
import { todayBeijing } from '../../src/core/time';

afterEach(cleanup);

describe('PathDisplay', () => {
  it('只读显示当前写入路径和修改入口', () => {
    const html = renderToStaticMarkup(createElement(PathDisplay, {
      value: 'collected/2026-08-04',
      onEdit: vi.fn(),
    }));

    expect(html).toContain('写入路径');
    expect(html).toContain('collected/2026-08-04');
    expect(html).toContain('· 修改');
    expect(html).not.toContain('<input');
  });

  it('采集期间禁用修改', () => {
    const html = renderToStaticMarkup(createElement(PathDisplay, {
      value: 'collected',
      onEdit: vi.fn(),
      disabled: true,
    }));

    expect(html).toContain('disabled=""');
  });

  it('点击修改时通知上层进入设置页', () => {
    const onEdit = vi.fn();
    render(createElement(PathDisplay, { value: 'collected', onEdit }));

    fireEvent.click(screen.getByRole('button', { name: '· 修改' }));

    expect(onEdit).toHaveBeenCalledOnce();
  });
});

describe('PathSetup', () => {
  it('首次设置说明二级路径用法并给出案例', () => {
    const html = renderToStaticMarkup(createElement(PathSetup, {
      initial: 'collected',
      rootName: '笔记仓库',
      collector: 'zach',
      onSave: vi.fn(),
    }));

    expect(html).toContain('设置采集写入路径');
    expect(html).toContain('collected/2026-08-04');
    expect(html).toContain('collected/outfit');
    expect(html).toContain('路径不会随日期自动变化');
    expect(html).toContain('使用这个路径');
    expect(html).not.toContain('取消');
  });

  it('修改时提供保存和取消', () => {
    const html = renderToStaticMarkup(createElement(PathSetup, {
      initial: 'collected/2026-08-04',
      rootName: '笔记仓库',
      collector: 'zach',
      onSave: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(html).toContain('修改采集写入路径');
    expect(html).toContain('保存修改');
    expect(html).toContain('取消');
  });

  it('保存时才提交编辑后的草稿', () => {
    const onSave = vi.fn();
    render(createElement(PathSetup, {
      initial: 'collected', rootName: '笔记仓库', collector: 'zach', onSave, onCancel: vi.fn(),
    }));

    fireEvent.change(screen.getByLabelText('写入路径'), {
      target: { value: 'collected/2026-08-05' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));

    expect(onSave).toHaveBeenCalledWith('collected/2026-08-05');
  });

  it('取消时不提交草稿', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(createElement(PathSetup, {
      initial: 'collected', rootName: '笔记仓库', collector: 'zach', onSave, onCancel,
    }));

    fireEvent.change(screen.getByLabelText('写入路径'), {
      target: { value: 'collected/outfit' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  // 快捷选项只填输入框、不直接保存：路径决定仓库怎么组织，
  // 点一下就落盘等于把「确认」这一步从流程里抽掉。
  it('列出四个快捷选项', () => {
    const html = renderToStaticMarkup(createElement(PathSetup, {
      initial: 'collected',
      rootName: '笔记仓库',
      collector: 'zach',
      onSave: vi.fn(),
    }));

    expect(html).toContain('快捷选项');
    for (const p of ['collected', `collected/${todayBeijing()}`, 'zach', `zach/${todayBeijing()}`]) {
      expect(html).toContain(p);
    }
  });

  it('点快捷选项只填进输入框，要再点保存才提交', () => {
    const onSave = vi.fn();
    render(createElement(PathSetup, {
      initial: 'collected', rootName: '笔记仓库', collector: 'zach', onSave, onCancel: vi.fn(),
    }));

    fireEvent.click(screen.getByRole('button', { name: `zach/${todayBeijing()}` }));

    expect((screen.getByLabelText('写入路径') as HTMLInputElement).value)
      .toBe(`zach/${todayBeijing()}`);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(onSave).toHaveBeenCalledWith(`zach/${todayBeijing()}`);
  });

  it('当前路径命中的那个快捷选项被标记为已选中', () => {
    render(createElement(PathSetup, {
      initial: 'collected', rootName: '笔记仓库', collector: 'zach', onSave: vi.fn(),
    }));

    expect(screen.getByRole('button', { name: 'collected' }).getAttribute('aria-pressed'))
      .toBe('true');
    expect(screen.getByRole('button', { name: 'zach' }).getAttribute('aria-pressed'))
      .toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'zach' }));

    expect(screen.getByRole('button', { name: 'zach' }).getAttribute('aria-pressed'))
      .toBe('true');
  });

  it('没有采集者时不出带采集者的那两个选项', () => {
    render(createElement(PathSetup, {
      initial: 'collected', rootName: '笔记仓库', collector: null, onSave: vi.fn(),
    }));

    expect(screen.getAllByRole('button', { name: /^collected/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'zach' })).toBeNull();
  });

  it('非法路径不能保存且错误与输入框关联', () => {
    const onSave = vi.fn();
    render(createElement(PathSetup, {
      initial: 'collected', rootName: '笔记仓库', collector: 'zach', onSave, onCancel: vi.fn(),
    }));

    const input = screen.getByLabelText('写入路径');
    fireEvent.change(input, { target: { value: '/bad' } });
    const save = screen.getByRole('button', { name: '保存修改' }) as HTMLButtonElement;

    expect(save.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('dataset-path-error');
    expect(document.getElementById('dataset-path-error')?.textContent).toContain('每一段只能');
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('NoteView', () => {
  it('采集中即使页面暂时进入读取态也不能修改路径', () => {
    const html = renderToStaticMarkup(createElement(NoteView, {
      state: { kind: 'reading' },
      collector: 'zach',
      datasetPath: 'collected',
      onEditDatasetPath: vi.fn(),
      onArchive: vi.fn(),
      progress: { done: 1, total: 3 },
      message: null,
      justArchived: null,
      pageStep: null,
      deletePlan: null,
      onOpenDelete: vi.fn(),
      onCancelDelete: vi.fn(),
      onConfirmDelete: vi.fn(),
      justDeleted: null,
    }));

    expect(html).toContain('· 修改');
    expect(html).toContain('disabled=""');
  });
});
