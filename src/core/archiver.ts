import type { ExtractedNote, ImageRecord, NoteRecord, Pointer } from '../types';
import type { Store } from './store';
import { downloadImage, defaultDeps, type Deps, type FetchedImage } from './downloader';
import { lookup, writePointer } from './index-store';
import { serializeNote } from './serialize';
import { nowBeijingIso } from './time';

export type CheckResult =
  | { state: 'new' }
  | { state: 'mine'; pointer: Pointer; duplicates: Pointer[] }
  | { state: 'others'; pointers: Pointer[] };

export interface ArchiveOptions {
  store: Store;
  note: ExtractedNote;
  collector: string;
  datasetPath: string;
  mode: 'new' | 'update' | 'migrate';
  existing?: Pointer;
  deps?: Deps;
  onProgress?(done: number, total: number): void;
}

export interface ArchiveResult {
  status: 'complete' | 'partial';
  path: string;
  failures: string[];
}

export async function checkNote(store: Store, noteId: string, collector: string): Promise<CheckResult> {
  const all = await lookup(store, noteId);
  if (all.length === 0) return { state: 'new' };
  const mine = all.find((p) => p.collector === collector);
  if (mine) return { state: 'mine', pointer: mine, duplicates: all.filter((p) => p !== mine) };
  return { state: 'others', pointers: all };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 归档一篇笔记。
 *
 * 原子性保证：全部图片先下载到内存，成功后才写盘，最后写指针。
 * 因此「指针存在」永远蕴含「数据完整」，查重不会产生假阳性。
 */
export async function archive(opts: ArchiveOptions): Promise<ArchiveResult> {
  const { store, note, collector, mode, existing } = opts;
  const deps = opts.deps ?? defaultDeps;
  const targetPath = mode === 'update' && existing ? existing.path : `${opts.datasetPath}/${note.noteId}`;

  // 1. 先把全部图片取到内存，任何一张失败都不落盘。
  const fetched: FetchedImage[] = [];
  const failures: string[] = [];
  for (const img of note.images) {
    try {
      fetched.push(await downloadImage(img, deps));
      opts.onProgress?.(fetched.length, note.images.length);
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }

  const now = nowBeijingIso();

  if (failures.length > 0) {
    // 不写指针：残缺目录在语义上等同「未采集」，下次重采会直接覆盖。
    return { status: 'partial', path: targetPath, failures };
  }

  // 2. 组装 note.json
  const images: ImageRecord[] = fetched.map((f, i) => {
    const src = note.images[i]!;
    return {
      index: src.index,
      file: `images/${pad2(src.index)}.${f.ext}`,
      is_live: src.isLive,
      file_id: src.fileId,
      width: f.width,
      height: f.height,
      declared_width: src.declaredWidth,
      declared_height: src.declaredHeight,
      bytes: f.bytes.byteLength,
      sha256: f.sha256,
      source_kind: f.sourceKind,
      source_url: f.sourceUrl,
    };
  });

  const prior = mode === 'new' ? null : existing ?? null;
  const priorCount = prior ? await readArchiveCount(store, prior.path) : 0;

  const record: NoteRecord = {
    schema_version: 1,
    note_id: note.noteId,
    url: note.url,
    type: 'normal',
    title: note.title,
    content: note.content,
    tags: note.tags,
    published_at: note.publishedAt,
    last_edited_at: note.lastEditedAt,
    author: note.author,
    interact: note.interact,
    images,
    archive: {
      first_archived_at: prior ? prior.first_archived_at : now,
      last_archived_at: now,
      collector,
      archive_count: priorCount + 1,
      status: 'complete',
    },
    raw: note.raw,
  };

  // 3. 写数据
  await store.writeFile(`${targetPath}/note.json`, serializeNote(record));
  for (let i = 0; i < fetched.length; i++) {
    await store.writeFile(`${targetPath}/${images[i]!.file}`, fetched[i]!.bytes);
  }

  // 4. 写指针（数据已完整）
  await writePointer(store, {
    note_id: note.noteId,
    path: targetPath,
    collector,
    title: note.title,
    first_archived_at: record.archive.first_archived_at,
    last_archived_at: now,
  });

  // 5. 迁移：新位置确认无误后才删旧目录。
  //    任何中断最坏留下孤儿目录，绝不会「删了旧的但新的没写成」。
  if (mode === 'migrate' && existing && existing.path !== targetPath) {
    await store.removeDir(existing.path);
    await removeEmptyParent(store, existing.path);
  }

  return { status: 'complete', path: targetPath, failures: [] };
}

async function readArchiveCount(store: Store, path: string): Promise<number> {
  const txt = await store.readText(`${path}/note.json`);
  if (txt === null) return 0;
  try {
    const j = JSON.parse(txt) as NoteRecord;
    return typeof j.archive?.archive_count === 'number' ? j.archive.archive_count : 0;
  } catch {
    return 0;
  }
}

/** 迁移后清理因此变空的日期目录，但不删采集者目录。 */
async function removeEmptyParent(store: Store, path: string): Promise<void> {
  const parts = path.split('/');
  if (parts.length < 3) return;
  const parent = parts.slice(0, -1).join('/');
  if ((await store.listDir(parent)).length === 0) await store.removeDir(parent);
}
