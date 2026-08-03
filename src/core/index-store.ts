import type { Pointer } from '../types';
import type { Store } from './store';
import { serializePointer } from './serialize';

const INDEX_ROOT = '_index';

/** 前两位分桶，避免单目录堆积数万条目。noteId 是 hex，分布均匀。 */
export function bucketOf(noteId: string): string {
  return noteId.slice(0, 2);
}

export function pointerDir(noteId: string): string {
  return `${INDEX_ROOT}/${bucketOf(noteId)}/${noteId}`;
}

export function pointerPath(noteId: string, collector: string): string {
  return `${pointerDir(noteId)}/${collector}.json`;
}

/**
 * 返回该笔记的全部指针。长度 > 1 说明发生了并发采集竞态
 * （多人各自未 pull 就采了同一篇），需人工清理。
 */
export async function lookup(store: Store, noteId: string): Promise<Pointer[]> {
  const names = await store.listDir(pointerDir(noteId));
  const out: Pointer[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const txt = await store.readText(`${pointerDir(noteId)}/${name}`);
    if (txt === null) continue;
    try {
      out.push(JSON.parse(txt) as Pointer);
    } catch {
      // 损坏的指针不应让整个查重失败
    }
  }
  return out;
}

export async function writePointer(store: Store, p: Pointer): Promise<void> {
  await store.writeFile(pointerPath(p.note_id, p.collector), serializePointer(p));
}

export async function removePointer(store: Store, noteId: string, collector: string): Promise<void> {
  await store.removeFile(pointerPath(noteId, collector));
}
