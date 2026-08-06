import { describe, it, expect } from 'vitest';
import { filterRefs, matches, sortRefs } from '../../../src/core/browse/search';
import { noteKeyOf } from '../../../src/core/browse/scope';
import type { NoteKey, NoteRef, RowMeta } from '../../../src/core/browse/types';

const A = '6a61e639000000001c00e6d9';
const B = '6a6356e8000000002902e848';
const DS = 'collected/2026-08-03';

function meta(over: Partial<RowMeta>): RowMeta {
  return {
    noteId: A, datasetPath: DS, title: '', content: '', tags: [], authorNickname: '',
    authorFans: null, authorInteraction: null,
    liked: 0, collected: 0, comment: 0, share: 0, imageCount: 0, coverFile: null,
    collector: 'zach', firstArchivedAt: '', lastArchivedAt: '', archiveCount: 1,
    publishedAt: '', lastEditedAt: '', ...over,
  };
}

function table(...entries: [NoteRef, RowMeta][]): Map<NoteKey, RowMeta> {
  return new Map(entries.map(([r, m]) => [noteKeyOf(r), m]));
}

const refA: NoteRef = { noteId: A, datasetPath: DS };
const refB: NoteRef = { noteId: B, datasetPath: DS };

describe('matches', () => {
  it('空查询全部命中', () => {
    expect(matches(meta({}), '')).toBe(true);
    expect(matches(meta({}), '   ')).toBe(true);
  });

  it('命中标题、正文、作者、标签', () => {
    expect(matches(meta({ title: '夏日通勤穿搭' }), '通勤')).toBe(true);
    expect(matches(meta({ content: '三件单品搞定一周' }), '单品')).toBe(true);
    expect(matches(meta({ authorNickname: '小 A' }), '小')).toBe(true);
    expect(matches(meta({ tags: ['穿搭', '通勤'] }), '穿搭')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(matches(meta({ title: 'Summer OOTD' }), 'ootd')).toBe(true);
  });

  it('都不命中就返回 false', () => {
    expect(matches(meta({ title: '咖啡' }), '穿搭')).toBe(false);
  });
});

describe('filterRefs', () => {
  it('按查询词过滤', () => {
    const metas = table([refA, meta({ noteId: A, title: '穿搭' })], [refB, meta({ noteId: B, title: '咖啡' })]);
    expect(filterRefs([refA, refB], metas, { query: '穿搭', collector: null })).toEqual([refA]);
  });

  it('按采集者过滤', () => {
    const metas = table([refA, meta({ noteId: A, collector: 'zach' })], [refB, meta({ noteId: B, collector: 'lily' })]);
    expect(filterRefs([refA, refB], metas, { query: '', collector: 'lily' })).toEqual([refB]);
  });

  it('元数据还没加载的行在有筛选条件时被排除', () => {
    expect(filterRefs([refA], new Map(), { query: '穿搭', collector: null })).toEqual([]);
  });

  it('没有任何筛选条件时保留未加载的行', () => {
    expect(filterRefs([refA], new Map(), { query: '', collector: null })).toEqual([refA]);
  });
});

describe('sortRefs', () => {
  it('default 走目录序，不需要元数据', () => {
    const refs = [
      { noteId: B, datasetPath: 'collected/2026-07-29' },
      { noteId: A, datasetPath: 'collected/2026-08-03' },
    ];
    expect(sortRefs(refs, new Map(), { key: 'default', desc: false }).map(noteKeyOf)).toEqual([
      `collected/2026-08-03/${A}`,
      `collected/2026-07-29/${B}`,
    ]);
  });

  it('按字段升序与降序', () => {
    const metas = table([refA, meta({ noteId: A, liked: 10 })], [refB, meta({ noteId: B, liked: 20 })]);
    expect(sortRefs([refA, refB], metas, { key: 'liked', desc: false })).toEqual([refA, refB]);
    expect(sortRefs([refA, refB], metas, { key: 'liked', desc: true })).toEqual([refB, refA]);
  });

  it('缺元数据的行沉到末尾，不因排序消失', () => {
    const metas = table([refA, meta({ noteId: A, liked: 10 })]);
    expect(sortRefs([refB, refA], metas, { key: 'liked', desc: false })).toEqual([refA, refB]);
  });

  it('不修改传入的数组', () => {
    const refs = [refB, refA];
    sortRefs(refs, new Map(), { key: 'default', desc: false });
    expect(refs).toEqual([refB, refA]);
  });
});
