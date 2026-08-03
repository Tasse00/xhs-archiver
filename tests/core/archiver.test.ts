import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { checkNote, archive } from '../../src/core/archiver';
import { writePointer, lookup } from '../../src/core/index-store';
import { extract } from '../../src/core/extractor';
import type { Deps } from '../../src/core/downloader';
import type { ExtractedNote, RawNote, Pointer } from '../../src/types';
import imageNote from '../fixtures/note-image.json';

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
