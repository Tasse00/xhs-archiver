import { describe, it, expect } from 'vitest';
import { appendLog, buildLogEntry, describeOutcome, recordLog, shouldLog, type LogEntry } from '../../src/sidepanel/log';
import type { PageDiag } from '../../src/page/read-note';
import type { PanelState } from '../../src/sidepanel/usePanelState';

const diag: PageDiag = {
  pathname: '/explore/6a030b86',
  urlId: '6a030b86',
  currentNoteId: '',
  mapKeys: ['', '6a030b86'],
  entryFound: true,
  commentCount: 3,
};

const at = new Date('2026-08-04T09:30:15+08:00');

describe('buildLogEntry', () => {
  it('记录现场关键量', () => {
    const e = buildLogEntry(
      { kind: 'ready', note: { noteId: 'x' } as never, comments: {} as never },
      'https://www.xiaohongshu.com/explore/6a030b86?xsec_token=SECRET',
      diag,
      at,
    );
    expect(e).toMatchObject({
      outcome: '可采集',
      pathname: '/explore/6a030b86',
      urlId: '6a030b86',
      mapKeys: 2,
      entryFound: true,
      comments: 3,
      attempts: 0,
      repeats: 1,
    });
  });

  // 中间态不再单独成条，改为把重读次数记在最终结论上。
  it('带上重读次数', () => {
    const e = buildLogEntry({ kind: 'ready', note: {} as never, comments: {} as never }, '', diag, at, 3);
    expect(e.attempts).toBe(3);
  });

  // token 会过期，留在日志里既没用又是多余的泄露面。
  it('去掉 tabUrl 的 query', () => {
    const e = buildLogEntry(
      { kind: 'not_note' },
      'https://www.xiaohongshu.com/explore/6a030b86?xsec_token=SECRET',
      diag,
      at,
    );
    expect(e.tabUrl).toBe('https://www.xiaohongshu.com/explore/6a030b86');
    expect(e.tabUrl).not.toContain('SECRET');
  });

  it('空的 currentNoteId 显式标出来，与「读不到」区分', () => {
    expect(buildLogEntry({ kind: 'not_note' }, '', diag, at).currentNoteId).toBe('(空)');
    expect(buildLogEntry({ kind: 'not_note' }, '', null, at).currentNoteId).toBe('—');
  });

  it('没有诊断信息时不炸', () => {
    const e = buildLogEntry({ kind: 'not_xhs' }, 'https://example.com/', null, at);
    expect(e).toMatchObject({ pathname: '—', urlId: '—', mapKeys: 0, entryFound: false });
  });

  it('带出失败详情', () => {
    const e = buildLogEntry(
      { kind: 'unreadable', reason: 'inject_failed', detail: '注入脚本无返回值' },
      '',
      null,
      at,
    );
    expect(e.outcome).toBe('读取失败：inject_failed');
    expect(e.error).toBe('注入脚本无返回值');
  });

  it('页面内的异常优先于状态里的详情', () => {
    const e = buildLogEntry(
      { kind: 'unreadable', reason: 'page_error', detail: 'x' },
      '',
      { ...diag, error: 'TypeError: boom' },
      at,
    );
    expect(e.error).toBe('TypeError: boom');
  });
});

describe('shouldLog', () => {
  // 日志是为了排查「这篇为什么采不了」。切标签页、逛非笔记页产生的条目
  // 只会把真正有用的那几条挤出上限。
  it('不在笔记页的状态一律不记', () => {
    const skipped: PanelState[] = [
      { kind: 'need_root' },
      { kind: 'need_collector' },
      { kind: 'not_xhs' },
      { kind: 'not_note' },
      { kind: 'need_path' },
    ];
    for (const s of skipped) expect(shouldLog(s)).toBe(false);
  });

  it('笔记页上的判定照记，中间态也算', () => {
    const kept: PanelState[] = [
      { kind: 'reading' },
      { kind: 'unreadable', reason: 'no_state' },
      { kind: 'video_rejected' },
      { kind: 'others', note: {} as never, comments: {} as never, pointers: [] },
      { kind: 'mine', note: {} as never, comments: {} as never, pointer: {} as never, duplicates: [] },
      { kind: 'ready', note: {} as never, comments: {} as never },
    ];
    for (const s of kept) expect(shouldLog(s)).toBe(true);
  });

  // 侧边栏自己抛异常时无从判断当时在不在笔记页，丢掉就等于丢掉唯一的线索。
  it('侧边栏自身出错始终记录', () => {
    expect(shouldLog({ kind: 'unreadable', reason: 'panel_error', detail: 'boom' })).toBe(true);
  });
});

describe('describeOutcome', () => {
  it('每个状态都有中文说法', () => {
    expect(describeOutcome({ kind: 'need_root' })).toBe('未选择仓库目录');
    // 中间态也要如实进日志，否则排查时看不出重试过几次
    expect(describeOutcome({ kind: 'reading' })).toBe('页面数据未就绪，稍后重读');
    expect(describeOutcome({ kind: 'video_rejected' })).toBe('视频笔记，不采集');
    expect(describeOutcome({ kind: 'others', note: {} as never, comments: {} as never, pointers: [{} as never] })).toContain('1 条');
  });
});

describe('recordLog', () => {
  const at = new Date('2026-08-04T10:38:53+08:00');
  const later = new Date('2026-08-04T10:39:10+08:00');
  const ready = (when: Date, over: Partial<PageDiag> = {}) =>
    buildLogEntry({ kind: 'ready', note: {} as never, comments: {} as never }, '', { ...diag, ...over }, when);

  // onUpdated 一次导航触发好几次，逐条记录就是图里那一屏重复条目。
  it('结论相同就地合并，不新增条目', () => {
    let log: LogEntry[] = [];
    for (let i = 0; i < 5; i++) log = recordLog(log, ready(at));
    expect(log).toHaveLength(1);
    expect(log[0]!.repeats).toBe(5);
  });

  it('合并时保留最新的时间与现场', () => {
    const log = recordLog(recordLog([], ready(at)), ready(later, { commentCount: 20 }));
    expect(log[0]!.at).toBe('10:39:10');
    expect(log[0]!.comments).toBe(20);
  });

  it('结论变了才新增条目', () => {
    const first = recordLog([], ready(at));
    const changed = buildLogEntry({ kind: 'video_rejected' }, '', diag, later);
    const log = recordLog(first, changed);
    expect(log).toHaveLength(2);
    expect(log[0]!.outcome).toBe('视频笔记，不采集');
    expect(log[0]!.repeats).toBe(1);
  });

  // 换一篇笔记时 pathname 变了，即便结论同为「可采集」也是两回事。
  it('换了笔记不合并', () => {
    const a = recordLog([], ready(at));
    const log = recordLog(a, ready(later, { pathname: '/explore/other', urlId: 'other' }));
    expect(log).toHaveLength(2);
  });

  it('只与最近一条比较，不翻找历史', () => {
    const a = recordLog([], ready(at));
    const b = recordLog(a, buildLogEntry({ kind: 'video_rejected' }, '', diag, later));
    const log = recordLog(b, ready(later));
    expect(log).toHaveLength(3);
  });
});

describe('appendLog', () => {
  const entry = (at: string): LogEntry =>
    ({ at, outcome: 'x', tabUrl: '', pathname: '', urlId: '', currentNoteId: '', mapKeys: 0, entryFound: false, comments: 0, attempts: 0, repeats: 1 });

  it('最新的排最前', () => {
    const log = appendLog(appendLog([], entry('09:00:00')), entry('09:00:01'));
    expect(log.map((e) => e.at)).toEqual(['09:00:01', '09:00:00']);
  });

  it('超过上限时丢掉最老的', () => {
    let log: LogEntry[] = [];
    for (let i = 0; i < 40; i++) log = appendLog(log, entry(String(i)));
    expect(log).toHaveLength(30);
    expect(log[0]!.at).toBe('39');
  });
});
