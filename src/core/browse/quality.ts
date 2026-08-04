import type { Pointer } from '../../types';
import { pointerDir } from '../index-store';
import type { ReadStore } from '../read-store';
import { noteKeyOf } from './scope';
import type { NoteDetail, NoteRef } from './types';

export type QualityState =
  | { kind: 'ok' }
  | { kind: 'no_pointer' }
  | { kind: 'pointer_elsewhere'; paths: string[] }
  | { kind: 'race_diverged'; pointers: Pointer[] }
  | { kind: 'race_same_path'; collectors: string[] }
  | { kind: 'invariant_broken'; missing: string[] };

export interface QualityReport {
  state: QualityState;
  /** 无论指针状态如何都报，供画廊标出缺哪几张 */
  missingImages: string[];
  pointers: Pointer[];
}

/**
 * index-store.lookup 要的是完整 Store（它用 listDir），浏览页只有 ReadStore。
 * 这里用 listEntries 重读一遍，代价是十来行重复，换来浏览页彻底不碰写接口。
 */
async function readPointers(store: ReadStore, noteId: string): Promise<Pointer[]> {
  const dir = pointerDir(noteId);
  const out: Pointer[] = [];
  for (const e of await store.listEntries(dir)) {
    if (e.kind !== 'file' || !e.name.endsWith('.json')) continue;
    const txt = await store.readText(`${dir}/${e.name}`);
    if (txt === null) continue;
    try {
      out.push(JSON.parse(txt) as Pointer);
    } catch {
      // 损坏的指针不该让整篇的质量判定失败
    }
  }
  return out;
}

async function missingImageFiles(
  store: ReadStore,
  ref: NoteRef,
  detail: NoteDetail,
): Promise<string[]> {
  const base = noteKeyOf(ref);
  const missing: string[] = [];
  for (const img of detail.images) {
    if (!(await store.exists(`${base}/${img.file}`))) missing.push(img.file);
  }
  return missing;
}

/**
 * 判据必须比对物理路径。只看「指针存不存在」会把一种情况判错：
 * 同一 note_id 有指针、但指向另一个目录，那时当前这个目录仍然是孤儿。
 *
 * detail 传 null 表示 note.json 根本读不出来。
 */
export async function checkQuality(
  store: ReadStore,
  ref: NoteRef,
  detail: NoteDetail | null,
): Promise<QualityReport> {
  const here = noteKeyOf(ref);
  const pointers = await readPointers(store, ref.noteId);
  const missingImages = detail ? await missingImageFiles(store, ref, detail) : [];

  const atHere = pointers.filter((p) => p.path === here);
  const paths = [...new Set(pointers.map((p) => p.path))].sort();

  let state: QualityState;
  if (pointers.length === 0) {
    state = { kind: 'no_pointer' };
  } else if (atHere.length === 0) {
    state = { kind: 'pointer_elsewhere', paths };
  } else if (detail === null) {
    state = { kind: 'invariant_broken', missing: ['note.json'] };
  } else if (missingImages.length > 0) {
    // 有指针却数据不全，说明「指针存在 ⟹ 数据完整」这条不变量已经破了。
    // 它比路径分叉更要紧：别人的查重结果因此是错的。
    state = { kind: 'invariant_broken', missing: missingImages };
  } else if (paths.length > 1) {
    state = { kind: 'race_diverged', pointers };
  } else if (atHere.length > 1) {
    state = { kind: 'race_same_path', collectors: atHere.map((p) => p.collector).sort() };
  } else {
    state = { kind: 'ok' };
  }

  return { state, missingImages, pointers };
}
