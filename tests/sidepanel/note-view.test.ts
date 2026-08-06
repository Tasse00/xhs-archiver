import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Result, type ArchiveOutcome } from '../../src/sidepanel/components/NoteView';
import type { ExtractedComments } from '../../src/types';

const comments: ExtractedComments = {
  declaredTotal: 10, collectedCount: 10, complete: true, hasMore: false, list: [],
};

function outcome(
  author: ArchiveOutcome['author'],
  share: ArchiveOutcome['share'] = { kind: 'ok', url: 'https://www.xiaohongshu.com/discovery/item/n1?xsec_token=T' },
): ArchiveOutcome {
  return {
    mode: 'new', status: 'complete', path: 'collected/n1', failures: [],
    imageCount: 3, comments, commentImageFailures: [], author, share,
  };
}

describe('Result 里的作者信息', () => {
  it('采到时显示粉丝与获赞收藏', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ kind: 'ok', fans: 384, interaction: 1500, approximate: false }) }),
    );
    expect(html).toContain('384');
    expect(html).toContain('1,500');
    expect(html).not.toContain('约');
  });

  // 大号的计数是平台模糊过的，不能让人以为那是精确值
  it('approximate 时标注「约」', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ kind: 'ok', fans: 100000, interaction: 1000, approximate: true }) }),
    );
    expect(html).toContain('约');
  });

  // 采不到不阻断归档，但必须如实说，别让人以为采到了
  it('没采到时说明原因，并且不影响「采集完成」', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ kind: 'fail', reason: 'no_element' }) }),
    );
    expect(html).toContain('采集完成');
    expect(html).toContain('作者信息未采到');
    expect(html).toContain('重采这篇可以再试');
  });

  // 「关掉了」跟「采失败了」是两回事：前者是使用者的决定，不该带失败措辞，
  // 更不该劝人重采——重采还是会跳过。
  it('关掉时说明是设置里关的，不显示失败措辞', () => {
    const html = renderToStaticMarkup(
      createElement(Result, { outcome: outcome({ kind: 'skipped' }) }),
    );
    expect(html).toContain('采集完成');
    expect(html).toContain('已在设置中关闭');
    expect(html).not.toContain('未采到');
    expect(html).not.toContain('重采这篇可以再试');
  });
});

describe('Result 里的分享链接', () => {
  const okAuthor = { kind: 'ok', fans: 1, interaction: 1, approximate: false } as const;

  it('采到时说明已记录', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(okAuthor, {
        kind: 'ok', url: 'https://www.xiaohongshu.com/discovery/item/n1?xsec_token=T',
      }),
    }));
    expect(html).toContain('分享链接');
    expect(html).toContain('已记录');
  });

  // 采不到不阻断归档，但必须如实说
  it('没采到时说明原因，并且不影响「采集完成」', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(okAuthor, { kind: 'fail', reason: 'no_panel' }),
    }));
    expect(html).toContain('采集完成');
    expect(html).toContain('分享链接未采到');
    expect(html).toContain('分享面板没弹出来');
    expect(html).toContain('重采这篇可以再试');
  });

  it('解析层的失败也能原样说出来', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(okAuthor, { kind: 'fail', reason: 'id_mismatch' }),
    }));
    expect(html).toContain('链接指向别的笔记');
  });

  it('关掉时说明是设置里关的', () => {
    const html = renderToStaticMarkup(createElement(Result, {
      outcome: outcome(okAuthor, { kind: 'skipped' }),
    }));
    expect(html).toContain('采集完成');
    expect(html).toContain('已在设置中关闭');
    expect(html).not.toContain('未采到');
  });
});
