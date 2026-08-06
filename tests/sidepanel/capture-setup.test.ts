import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CaptureSetup } from '../../src/sidepanel/components/Setup';

function render(captureAuthor: boolean, captureShare: boolean) {
  return renderToStaticMarkup(createElement(CaptureSetup, {
    captureAuthor, captureShare,
    onChange: vi.fn(), onBack: vi.fn(),
  }));
}

describe('CaptureSetup', () => {
  it('两个开关都在，勾选状态跟着 props 走', () => {
    const html = render(true, false);
    expect(html).toContain('采集作者信息');
    expect(html).toContain('采集分享链接');
    // 开着的那个 checked、关着的那个不 checked
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toContain('checked');
    expect(boxes[1]).not.toContain('checked');
  });

  // 关掉之后使用者最担心的就是「我以前采的会不会没了」，必须当场回答
  it('说明关掉的后果，并说清不影响已采过的笔记', () => {
    const html = render(true, true);
    expect(html).toContain('已经采过的笔记不受影响');
  });

  // 这一页没有「保存」，一拨就生效。不写清楚会让人以为改了没存
  it('只有返回按钮，没有保存按钮', () => {
    const html = render(true, true);
    expect(html).toContain('返回');
    expect(html).not.toContain('保存');
  });
});
