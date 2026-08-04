import type {
  CommentImageRecord,
  CommentRecord,
  CommentsFile,
  ExtractedComment,
  ExtractedCommentImage,
  ExtractedComments,
  ExtractedNote,
  ImageRecord,
  NoteRecord,
  Pointer,
} from '../types';
import type { Store } from './store';
import {
  downloadCommentImage,
  downloadImage,
  defaultDeps,
  type Deps,
  type FetchedImage,
} from './downloader';
import { lookup, removePointer, writePointer } from './index-store';
import { serializeComments, serializeNote } from './serialize';
import { nowBeijingIso } from './time';

export type CheckResult =
  | { state: 'new' }
  | { state: 'mine'; pointer: Pointer; duplicates: Pointer[] }
  | { state: 'others'; pointers: Pointer[] };

export interface ArchiveOptions {
  store: Store;
  note: ExtractedNote;
  /** 页面上已加载的评论。读不到就不传，此时不写 comments.json。 */
  comments?: ExtractedComments;
  collector: string;
  datasetPath: string;
  mode: 'new' | 'update' | 'migrate';
  existing?: Pointer;
  /**
   * 接管：成功写入后要作废的旧指针。指针一个采集者一个文件，接管别人采过的笔记
   * 时不删掉对方那份，lookup 就会返回两条指向同一份数据的指针，下次打开这篇会
   * 被判成「重复采集」。自己的那条会跳过——它刚被覆盖写过。
   */
  supersede?: Pointer[];
  deps?: Deps;
  onProgress?(done: number, total: number): void;
}

export interface ArchiveResult {
  status: 'complete' | 'partial';
  path: string;
  failures: string[];
  /** 评论配图取不到的原因。不影响 status——评论是附属数据。 */
  commentImageFailures: string[];
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
  const { store, note, comments, collector, mode, existing } = opts;
  const deps = opts.deps ?? defaultDeps;
  const targetPath = mode === 'update' && existing ? existing.path : `${opts.datasetPath}/${note.noteId}`;

  const commentImages = comments ? flattenCommentImages(comments) : [];
  const total = note.images.length + commentImages.length;

  // 1. 先把全部图片取到内存，任何一张失败都不落盘。
  const fetched: FetchedImage[] = [];
  const failures: string[] = [];
  for (const img of note.images) {
    try {
      fetched.push(await downloadImage(img, deps));
      opts.onProgress?.(fetched.length, total);
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
      break;
    }
  }

  const now = nowBeijingIso();

  if (failures.length > 0) {
    // 不写指针：残缺目录在语义上等同「未采集」，下次重采会直接覆盖。
    return { status: 'partial', path: targetPath, failures, commentImageFailures: [] };
  }

  // 2. 评论配图。取不到就跳过这一张，绝不阻断归档：评论是附属数据，
  //    让一张配图把主干拖成 partial 是本末倒置。
  const commentImageFailures: string[] = [];
  const fetchedComment = new Map<string, FetchedImage>();
  let done = fetched.length;
  for (const { key, image } of commentImages) {
    try {
      fetchedComment.set(key, await downloadCommentImage(image, deps));
    } catch (e) {
      commentImageFailures.push(e instanceof Error ? e.message : String(e));
    }
    opts.onProgress?.(++done, total);
  }

  // 3. 组装 note.json
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

  // 4. 写数据
  await store.writeFile(`${targetPath}/note.json`, serializeNote(record));
  for (let i = 0; i < fetched.length; i++) {
    await store.writeFile(`${targetPath}/${images[i]!.file}`, fetched[i]!.bytes);
  }

  if (comments) {
    // 先清空旧评论图：重采时评论会增减，残留的旧文件会让目录里躺着
    // comments.json 根本没提到的图片。
    await store.removeDir(`${targetPath}/${COMMENT_IMAGE_DIR}`);
    await store.writeFile(
      `${targetPath}/comments.json`,
      serializeComments(buildCommentsFile(note.noteId, comments, fetchedComment)),
    );
    for (const { key } of commentImages) {
      const f = fetchedComment.get(key);
      if (f) await store.writeFile(`${targetPath}/${COMMENT_IMAGE_DIR}/${key}.${f.ext}`, f.bytes);
    }
  }

  // 5. 写指针（数据已完整）
  await writePointer(store, {
    note_id: note.noteId,
    path: targetPath,
    collector,
    title: note.title,
    first_archived_at: record.archive.first_archived_at,
    last_archived_at: now,
  });

  // 6. 接管：作废旧指针。排在写指针之后，中断最坏留下两条指针（看得出来要清理），
  //    而不是一条都不剩（那会让这篇凭空变回「没人采过」）。
  for (const p of opts.supersede ?? []) {
    if (p.collector !== collector) await removePointer(store, note.noteId, p.collector);
  }

  // 7. 迁移：新位置确认无误后才删旧目录。
  //    任何中断最坏留下孤儿目录，绝不会「删了旧的但新的没写成」。
  if (mode === 'migrate' && existing && existing.path !== targetPath) {
    await store.removeDir(existing.path);
    await removeEmptyParent(store, existing.path);
  }

  return { status: 'complete', path: targetPath, failures: [], commentImageFailures };
}

const COMMENT_IMAGE_DIR = 'images/comments';

interface PlannedCommentImage {
  /** 同时是文件名主体：评论 id 唯一，配图在评论内部按序号排。 */
  key: string;
  image: ExtractedCommentImage;
}

function commentImageKey(commentId: string, index: number): string {
  return `${commentId}-${pad2(index)}`;
}

/** 主评论与回复的配图拉平成一串，下载和写盘都按这个顺序走。 */
function flattenCommentImages(comments: ExtractedComments): PlannedCommentImage[] {
  const out: PlannedCommentImage[] = [];
  const visit = (c: ExtractedComment) => {
    for (const image of c.images) out.push({ key: commentImageKey(c.id, image.index), image });
    for (const s of c.subComments ?? []) visit(s);
  };
  for (const c of comments.list) visit(c);
  return out;
}

/**
 * 只把真正取到的配图写进 comments.json。取不到的整条省略而不是留个
 * 半截记录——否则读者会照着 file 字段去找一个不存在的文件。
 */
function buildCommentsFile(
  noteId: string,
  comments: ExtractedComments,
  fetched: Map<string, FetchedImage>,
): CommentsFile {
  const toRecord = (c: ExtractedComment, withSub: boolean): CommentRecord => {
    const images: CommentImageRecord[] = [];
    for (const img of c.images) {
      const key = commentImageKey(c.id, img.index);
      const f = fetched.get(key);
      if (!f) continue;
      images.push({
        index: img.index,
        file: `${COMMENT_IMAGE_DIR}/${key}.${f.ext}`,
        width: f.width,
        height: f.height,
        declared_width: img.declaredWidth,
        declared_height: img.declaredHeight,
        bytes: f.bytes.byteLength,
        sha256: f.sha256,
        source_kind: f.sourceKind,
        source_url: f.sourceUrl,
      });
    }
    const base: CommentRecord = {
      id: c.id,
      content: c.content,
      published_at: c.publishedAt,
      ip_location: c.ipLocation,
      liked_count: c.likedCount,
      author: c.author,
      at_users: c.atUsers,
      tags: c.tags,
      images,
    };
    if (!withSub) return base;
    return {
      ...base,
      sub_comment_count: c.subCommentCount,
      sub_comments: (c.subComments ?? []).map((s) => toRecord(s, false)),
    };
  };

  return {
    schema_version: 1,
    note_id: noteId,
    declared_total: comments.declaredTotal,
    collected_count: comments.collectedCount,
    complete: comments.complete,
    has_more: comments.hasMore,
    comments: comments.list.map((c) => toRecord(c, true)),
  };
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
