import { compareByDefault, compareByMeta, noteKeyOf, type SortKey } from './scope';
import type { NoteKey, NoteRef, RowMeta } from './types';

/** 不分词、不模糊。团队内部核对用的工具，子串匹配够了。 */
export function matches(meta: RowMeta, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    meta.title.toLowerCase().includes(q) ||
    meta.content.toLowerCase().includes(q) ||
    meta.authorNickname.toLowerCase().includes(q) ||
    meta.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export interface FilterOpts {
  query: string;
  collector: string | null;
}

/**
 * 有筛选条件时，元数据还没加载的行一律排除——「不知道它匹不匹配」不能
 * 当成「它匹配」。调用方应先扫描（scanScope）再筛，扫完就不会有未加载的行。
 */
export function filterRefs(
  refs: NoteRef[],
  metas: Map<NoteKey, RowMeta>,
  opts: FilterOpts,
): NoteRef[] {
  const active = opts.query.trim() !== '' || opts.collector !== null;
  if (!active) return refs;
  return refs.filter((r) => {
    const m = metas.get(noteKeyOf(r));
    if (!m) return false;
    if (opts.collector !== null && m.collector !== opts.collector) return false;
    return matches(m, opts.query);
  });
}

export interface Sort {
  key: SortKey | 'default';
  desc: boolean;
}

export function sortRefs(refs: NoteRef[], metas: Map<NoteKey, RowMeta>, sort: Sort): NoteRef[] {
  const out = [...refs];
  if (sort.key === 'default') {
    out.sort(compareByDefault);
    return sort.desc ? out.reverse() : out;
  }
  const key = sort.key;
  out.sort((a, b) => {
    const ma = metas.get(noteKeyOf(a));
    const mb = metas.get(noteKeyOf(b));
    // 缺元数据的沉到末尾。丢掉它们会让行凭空消失，比排得不准糟得多
    if (!ma && !mb) return compareByDefault(a, b);
    if (!ma) return 1;
    if (!mb) return -1;
    const r = compareByMeta(key, ma, mb);
    return sort.desc ? -r : r;
  });
  return out;
}
