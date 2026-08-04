import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { checkNote, archive } from '../../src/core/archiver';
import { writePointer, lookup } from '../../src/core/index-store';
import { extract } from '../../src/core/extractor';
import type { Deps } from '../../src/core/downloader';
import { extractComments } from '../../src/core/comments';
import type { ExtractedComments, ExtractedNote, RawComments, RawNote, Pointer } from '../../src/types';
import imageNote from '../fixtures/note-image.json';
import rawComments from '../fixtures/note-comments.json';

const NOTE_ID = '6a030b860000000036000201';

function goodNote(): ExtractedNote {
  const r = extract(imageNote as unknown as RawNote);
  if (!r.ok) throw new Error('fixture 应当可解析');
  return r.note;
}

function okDeps(): Deps {
  return {
    fetch: (async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])]),
    })) as unknown as typeof fetch,
    async decode() { return { width: 3106, height: 4096 }; },
    async sha256() { return 'hash'; },
  };
}

function goodComments(): ExtractedComments {
  return extractComments(rawComments as unknown as RawComments, 96);
}

/** 只让评论图的请求失败，笔记图照常成功。 */
function commentImageFailDeps(): Deps {
  const base = okDeps();
  const inner = base.fetch;
  return {
    ...base,
    fetch: (async (url: string) =>
      url.includes('/comment/')
        ? ({ ok: false, status: 500, headers: new Headers() } as unknown as Response)
        : inner(url)) as unknown as typeof fetch,
  };
}

function failingDeps(): Deps {
  return { ...okDeps(), fetch: (async () => ({ ok: false, status: 500, headers: new Headers() })) as unknown as typeof fetch };
}

const ptr = (collector: string, path: string): Pointer => ({
  note_id: NOTE_ID, path, collector, title: 't',
  first_archived_at: '2026-08-01T10:00:00+08:00',
  last_archived_at: '2026-08-01T10:00:00+08:00',
});

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('checkNote', () => {
  it('未采集返回 new', async () => {
    expect(await checkNote(store, NOTE_ID, 'zach')).toEqual({ state: 'new' });
  });

  it('自己采过返回 mine', async () => {
    await writePointer(store, ptr('zach', `zach/2026-08-01/${NOTE_ID}`));
    const r = await checkNote(store, NOTE_ID, 'zach');
    expect(r.state).toBe('mine');
  });

  it('他人采过返回 others', async () => {
    await writePointer(store, ptr('alice', `alice/2026-08-01/${NOTE_ID}`));
    const r = await checkNote(store, NOTE_ID, 'zach');
    expect(r.state).toBe('others');
    if (r.state !== 'others') throw new Error();
    expect(r.pointers[0]!.collector).toBe('alice');
  });

  it('自己和他人都采过时以 mine 为准，并带出重复项', async () => {
    await writePointer(store, ptr('zach', `zach/2026-08-01/${NOTE_ID}`));
    await writePointer(store, ptr('alice', `alice/2026-08-01/${NOTE_ID}`));
    const r = await checkNote(store, NOTE_ID, 'zach');
    expect(r.state).toBe('mine');
    if (r.state !== 'mine') throw new Error();
    expect(r.duplicates.map((d) => d.collector)).toEqual(['alice']);
  });
});

describe('archive - 新采集', () => {
  it('写入 note.json、图片与指针', async () => {
    const res = await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'new', deps: okDeps(),
    });
    expect(res.status).toBe('complete');
    expect(res.path).toBe(`zach/2026-08-03/${NOTE_ID}`);

    const txt = await store.readText(`zach/2026-08-03/${NOTE_ID}/note.json`);
    expect(txt).not.toBeNull();
    const j = JSON.parse(txt!);
    expect(j.images[0].file).toBe('images/01.jpg');
    expect(j.images[0].file_id).toBe('notes_pre_post/1040g3k83202lbd8f48005qcgi63ocap3qtle3do');
    expect(j.archive.collector).toBe('zach');
    expect(j.archive.archive_count).toBe(1);
    expect(j.archive.status).toBe('complete');
    expect(j.url).not.toContain('xsec_token');

    expect(await store.exists(`zach/2026-08-03/${NOTE_ID}/images/01.jpg`)).toBe(true);
    expect(await lookup(store, NOTE_ID)).toHaveLength(1);
  });

  it('图片全部失败时标记 partial 且不写指针', async () => {
    const res = await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'new', deps: failingDeps(),
    });
    expect(res.status).toBe('partial');
    // 指针不存在 —— 查重永不产生假阳性
    expect(await lookup(store, NOTE_ID)).toEqual([]);
  });

  it('汇报进度', async () => {
    const seen: number[] = [];
    await archive({
      store, note: goodNote(), collector: 'zach', datasetPath: 'zach/2026-08-03',
      mode: 'new', deps: okDeps(), onProgress: (done) => seen.push(done),
    });
    expect(seen).toEqual([1]);
  });
});

describe('archive - 评论', () => {
  const dir = `zach/2026-08-03/${NOTE_ID}`;

  async function archiveWithComments(deps = okDeps()) {
    return archive({
      store, note: goodNote(), comments: goodComments(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'new', deps,
    });
  }

  it('与 note.json 同目录写出 comments.json', async () => {
    await archiveWithComments();
    const j = JSON.parse((await store.readText(`${dir}/comments.json`))!);
    expect(j.note_id).toBe(NOTE_ID);
    expect(j.declared_total).toBe(96);
    expect(j.collected_count).toBe(4);
    expect(j.complete).toBe(false);
    expect(j.comments).toHaveLength(3);
    expect(j.comments[1].sub_comments[0].content).toBe('笑死我了');
  });

  it('评论图落到 images/comments/，文件名带评论 id', async () => {
    await archiveWithComments();
    const j = JSON.parse((await store.readText(`${dir}/comments.json`))!);
    const img = j.comments[2].images[0];
    expect(img.file).toBe('images/comments/6a61e88a00000000090162b7-01.jpg');
    expect(img.source_kind).toBe('WB_DFT');
    expect(await store.exists(`${dir}/${img.file}`)).toBe(true);
  });

  // 评论是附属数据。让一张取不到的评论配图把整篇笔记拖成 partial、
  // 进而不写指针，等于因为末节丢掉主干。
  it('评论图失败不影响归档状态与指针', async () => {
    const res = await archiveWithComments(commentImageFailDeps());
    expect(res.status).toBe('complete');
    expect(res.commentImageFailures).toHaveLength(1);
    expect(await lookup(store, NOTE_ID)).toHaveLength(1);
  });

  it('取不到的评论图在 comments.json 里留空数组，不留半截记录', async () => {
    await archiveWithComments(commentImageFailDeps());
    const j = JSON.parse((await store.readText(`${dir}/comments.json`))!);
    expect(j.comments[2].images).toEqual([]);
  });

  // 没读到评论和「读到了、就是 0 条」不是一回事，前者不该留下空文件。
  it('没有评论数据时不写 comments.json', async () => {
    await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'new', deps: okDeps(),
    });
    expect(await store.exists(`${dir}/comments.json`)).toBe(false);
  });

  it('进度把评论图算在总数里', async () => {
    const seen: [number, number][] = [];
    await archive({
      store, note: goodNote(), comments: goodComments(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'new', deps: okDeps(),
      onProgress: (done, total) => seen.push([done, total]),
    });
    // 笔记图 1 张 + 评论图 1 张
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });

  // 重采时评论只会更少（旧评论被删）或更多，残留的旧文件会造成
  // 「comments.json 说没有这张图，目录里却躺着一张」的不一致。
  it('重采时清掉上一次的评论图目录', async () => {
    await archiveWithComments();
    const imgPath = `${dir}/images/comments/6a61e88a00000000090162b7-01.jpg`;
    expect(await store.exists(imgPath)).toBe(true);

    const noPic = extractComments(
      { list: [(rawComments as unknown as RawComments).list![0]] } as RawComments,
      96,
    );
    const existing = (await lookup(store, NOTE_ID))[0]!;
    await archive({
      store, note: goodNote(), comments: noPic, collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'update', existing, deps: okDeps(),
    });
    expect(await store.exists(imgPath)).toBe(false);
  });
});

describe('archive - 更新原处', () => {
  it('保留首采时间，递增计数，路径不变', async () => {
    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'zach/2026-08-01', mode: 'new', deps: okDeps() });
    const before = JSON.parse((await store.readText(`zach/2026-08-01/${NOTE_ID}/note.json`))!);

    const existing = (await lookup(store, NOTE_ID))[0]!;
    await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'update', existing, deps: okDeps(),
    });

    const after = JSON.parse((await store.readText(`zach/2026-08-01/${NOTE_ID}/note.json`))!);
    expect(after.archive.first_archived_at).toBe(before.archive.first_archived_at);
    expect(after.archive.archive_count).toBe(2);
    // 没有写到新的数据集路径
    expect(await store.exists(`zach/2026-08-03/${NOTE_ID}/note.json`)).toBe(false);
  });
});

describe('archive - 迁移', () => {
  it('写新位置后删除旧目录，指针指向新路径', async () => {
    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'zach/2026-08-01', mode: 'new', deps: okDeps() });
    const existing = (await lookup(store, NOTE_ID))[0]!;

    await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'migrate', existing, deps: okDeps(),
    });

    expect(await store.exists(`zach/2026-08-03/${NOTE_ID}/note.json`)).toBe(true);
    expect(await store.exists(`zach/2026-08-01/${NOTE_ID}/note.json`)).toBe(false);

    const ptrs = await lookup(store, NOTE_ID);
    expect(ptrs).toHaveLength(1);
    expect(ptrs[0]!.path).toBe(`zach/2026-08-03/${NOTE_ID}`);
  });

  it('迁移失败时不删除旧目录', async () => {
    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'zach/2026-08-01', mode: 'new', deps: okDeps() });
    const existing = (await lookup(store, NOTE_ID))[0]!;

    const res = await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'zach/2026-08-03', mode: 'migrate', existing, deps: failingDeps(),
    });

    expect(res.status).toBe('partial');
    expect(await store.exists(`zach/2026-08-01/${NOTE_ID}/note.json`)).toBe(true);
    expect((await lookup(store, NOTE_ID))[0]!.path).toBe(`zach/2026-08-01/${NOTE_ID}`);
  });
});

/**
 * 接管别人采过的笔记。指针是「一个采集者一个文件」，所以接管必须把对方那份删掉，
 * 否则 lookup 会返回两条指向同一份数据的指针，下次打开这篇就被判成「重复采集」。
 */
describe('archive - 接管他人的采集', () => {
  /** 先让 lily 采一份，返回她的指针。 */
  async function lilyArchived(path = 'collected/2026-08-01'): Promise<Pointer> {
    await archive({ store, note: goodNote(), collector: 'lily', datasetPath: path, mode: 'new', deps: okDeps() });
    return (await lookup(store, NOTE_ID))[0]!;
  }

  it('原位更新：数据留在原路径，指针换成自己', async () => {
    const existing = await lilyArchived();

    await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'collected/2026-08-04', mode: 'update',
      existing, supersede: [existing], deps: okDeps(),
    });

    const ptrs = await lookup(store, NOTE_ID);
    expect(ptrs).toHaveLength(1);
    expect(ptrs[0]!.collector).toBe('zach');
    expect(ptrs[0]!.path).toBe(`collected/2026-08-01/${NOTE_ID}`);

    const rec = JSON.parse((await store.readText(`collected/2026-08-01/${NOTE_ID}/note.json`))!);
    expect(rec.archive.collector).toBe('zach');
    // 首采时间沿用对方的：这篇进仓库的时间并没有变
    expect(rec.archive.first_archived_at).toBe(existing.first_archived_at);
  });

  it('迁移接管：搬到自己的路径，旧目录与旧指针都清掉', async () => {
    const existing = await lilyArchived();

    await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'collected/2026-08-04', mode: 'migrate',
      existing, supersede: [existing], deps: okDeps(),
    });

    expect(await store.exists(`collected/2026-08-04/${NOTE_ID}/note.json`)).toBe(true);
    expect(await store.exists(`collected/2026-08-01/${NOTE_ID}/note.json`)).toBe(false);

    const ptrs = await lookup(store, NOTE_ID);
    expect(ptrs).toHaveLength(1);
    expect(ptrs[0]!.collector).toBe('zach');
  });

  // 删指针排在写指针之后。中途出错最坏留下两条指针（能看出来），而不是一条都不剩。
  it('接管失败时对方的指针原样保留', async () => {
    const existing = await lilyArchived();

    const res = await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'collected/2026-08-04', mode: 'update',
      existing, supersede: [existing], deps: failingDeps(),
    });

    expect(res.status).toBe('partial');
    const ptrs = await lookup(store, NOTE_ID);
    expect(ptrs).toHaveLength(1);
    expect(ptrs[0]!.collector).toBe('lily');
  });

  // lookup 返回多条的情况是并发采集竞态。接管要把它们一并收拢，不能只处理第一条。
  it('多人各采过一份时全部指针都被取代', async () => {
    const existing = await lilyArchived();
    await writePointer(store, ptr('bob', `collected/2026-07-20/${NOTE_ID}`));
    const all = await lookup(store, NOTE_ID);
    expect(all).toHaveLength(2);

    await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'collected/2026-08-04', mode: 'update',
      existing, supersede: all, deps: okDeps(),
    });

    const ptrs = await lookup(store, NOTE_ID);
    expect(ptrs).toHaveLength(1);
    expect(ptrs[0]!.collector).toBe('zach');
  });

  // supersede 里混进自己的指针时不能把刚写好的那条删掉。
  it('不会删掉自己刚写的指针', async () => {
    await archive({ store, note: goodNote(), collector: 'zach', datasetPath: 'collected/2026-08-01', mode: 'new', deps: okDeps() });
    const existing = (await lookup(store, NOTE_ID))[0]!;

    await archive({
      store, note: goodNote(), collector: 'zach',
      datasetPath: 'collected/2026-08-01', mode: 'update',
      existing, supersede: [existing], deps: okDeps(),
    });

    expect(await lookup(store, NOTE_ID)).toHaveLength(1);
  });
});
