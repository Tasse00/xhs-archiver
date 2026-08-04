import type { ReadStore } from '../read-store';
import { loadNote } from './row-meta';
import { noteKeyOf } from './scope';
import type { NoteDetail, NoteKey, NoteRef, RowMeta } from './types';

export interface ScanSink {
  metas: Map<NoteKey, RowMeta>;
  details: Map<NoteKey, NoteDetail>;
  errors: Map<NoteKey, string>;
}

export interface ScanOptions {
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
}

export interface ScanResult {
  loaded: number;
  skipped: number;
  failures: { ref: NoteRef; reason: string }[];
  /** false 表示中途取消。调用方据此决定不给这个范围打 scanned 标记 */
  completed: boolean;
}

/**
 * 把整个范围的元数据读满。排序、搜索、按采集者筛选都要全量数据，
 * 做不到懒加载，所以做成带进度和取消的显式动作。
 *
 * 取消后已读到的保留在 sink 里（下次扫描会跳过），但 completed 为 false ——
 * 调用方不能拿半份数据去排序或搜索，那会让用户看到一个没有说明的子集。
 */
export async function scanScope(
  store: ReadStore,
  refs: NoteRef[],
  sink: ScanSink,
  opts: ScanOptions,
): Promise<ScanResult> {
  const failures: ScanResult['failures'] = [];
  let loaded = 0;
  let skipped = 0;
  let done = 0;

  for (const ref of refs) {
    if (opts.signal?.aborted === true) {
      return { loaded, skipped, failures, completed: false };
    }
    const key = noteKeyOf(ref);
    if (sink.metas.has(key) || sink.errors.has(key)) {
      skipped++;
      opts.onProgress?.(++done, refs.length);
      continue;
    }
    const r = await loadNote(store, ref);
    if (r.ok) {
      sink.metas.set(key, r.meta);
      sink.details.set(key, r.detail);
      loaded++;
    } else {
      sink.errors.set(key, r.reason);
      failures.push({ ref, reason: r.reason });
    }
    opts.onProgress?.(++done, refs.length);
  }

  return { loaded, skipped, failures, completed: true };
}
