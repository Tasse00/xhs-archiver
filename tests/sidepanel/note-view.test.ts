import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Result, type ArchiveOutcome } from '../../src/sidepanel/components/NoteView';
import type { ExtractedComments } from '../../src/types';

const comments: ExtractedComments = {
  declaredTotal: 10, collectedCount: 10, complete: true, hasMore: false, list: [],
};

function outcome(author: ArchiveOutcome['author']): ArchiveOutcome {
  return {
    mode: 'new', status: 'complete', path: 'collected/n1', failures: [],
    imageCount: 3, comments, commentImageFailures: [], author,
  };
}

describe('Result 里的作者信息', () => {
  it('采到时显示粉丝与获赞收藏', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ ok: true, fans: 384, interaction: 1500, approximate: false }) }),
    );
    expect(html).toContain('384');
    expect(html).toContain('1,500');
    expect(html).not.toContain('约');
  });

  // 大号的计数是平台模糊过的，不能让人以为那是精确值
  it('approximate 时标注「约」', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ ok: true, fans: 100000, interaction: 1000, approximate: true }) }),
    );
    expect(html).toContain('约');
  });

  // 采不到不阻断归档，但必须如实说，别让人以为采到了
  it('没采到时说明原因，并且不影响「采集完成」', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ ok: false, reason: 'no_element' }) }),
    );
    expect(html).toContain('采集完成');
    expect(html).toContain('作者信息未采到');
    expect(html).toContain('重采这篇可以再试');
  });
});
