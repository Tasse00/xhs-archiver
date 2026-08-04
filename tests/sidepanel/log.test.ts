import { describe, it, expect } from 'vitest';
import { appendLog, buildLogEntry, describeOutcome, type LogEntry } from '../../src/sidepanel/log';
import type { PageDiag } from '../../src/page/read-note';

const diag: PageDiag = {
  pathname: '/explore/6a030b86',
  urlId: '6a030b86',
  currentNoteId: '',
  mapKeys: ['', '6a030b86'],
  entryFound: true,
};

const at = new Date('2026-08-04T09:30:15+08:00');

describe('buildLogEntry', () => {
  it('记录现场关键量', () => {
    const e = buildLogEntry(
      { kind: 'ready', note: { noteId: 'x' } as never },
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
    });
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

describe('describeOutcome', () => {
  it('每个状态都有中文说法', () => {
    expect(describeOutcome({ kind: 'need_root' })).toBe('未选择仓库目录');
    // 中间态也要如实进日志，否则排查时看不出重试过几次
    expect(describeOutcome({ kind: 'reading' })).toBe('页面数据未就绪，稍后重读');
    expect(describeOutcome({ kind: 'video_rejected' })).toBe('视频笔记，不采集');
    expect(describeOutcome({ kind: 'blocked_by_other', pointers: [{} as never] })).toContain('1 条');
  });
});

describe('appendLog', () => {
  const entry = (at: string): LogEntry =>
    ({ at, outcome: 'x', tabUrl: '', pathname: '', urlId: '', currentNoteId: '', mapKeys: 0, entryFound: false });

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
