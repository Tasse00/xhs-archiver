import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../../src/core/store';
import { checkQuality } from '../../../src/core/browse/quality';
import type { NoteDetail } from '../../../src/core/browse/types';
import { memRoot } from '../../helpers/memory-fs';

const A = '6a61e639000000001c00e6d9';
const DS = 'collected/2026-08-03';
const ref = { noteId: A, datasetPath: DS };

function detailWith(files: string[]): NoteDetail {
  return {
    url: '', ipLocation: '',
    author: { user_id: 'u1', nickname: '小 A', avatar_url: '', profile_url: '' },
    images: files.map((file, i) => ({
      index: i + 1, file, is_live: false, file_id: `f${i}`,
      width: 1, height: 1, declared_width: 1, declared_height: 1,
      bytes: 1, sha256: 'x', source_kind: 'original' as const, source_url: '',
    })),
  };
}

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

async function writePointer(collector: string, path: string) {
  await store.writeFile(
    `_index/6a/${A}/${collector}.json`,
    JSON.stringify({ note_id: A, path, collector, title: 't',
      first_archived_at: '2026-08-03T14:02:11+08:00', last_archived_at: '2026-08-03T14:02:11+08:00' }),
  );
}

describe('checkQuality', () => {
  it('指针唯一且指向当前目录、图片齐全 → ok', async () => {
    await writePointer('zach', `${DS}/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state).toEqual({ kind: 'ok' });
    expect(r.missingImages).toEqual([]);
  });

  it('没有任何指针 → no_pointer', async () => {
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state.kind).toBe('no_pointer');
  });

  it('有指针但指向别的目录 → pointer_elsewhere', async () => {
    await writePointer('zach', `collected/2026-07-29/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state).toEqual({ kind: 'pointer_elsewhere', paths: [`collected/2026-07-29/${A}`] });
  });

  it('多个指针指向不同目录 → race_diverged', async () => {
    await writePointer('zach', `${DS}/${A}`);
    await writePointer('lily', `collected/2026-07-29/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state.kind).toBe('race_diverged');
  });

  it('多人指针指向同一个当前目录 → race_same_path', async () => {
    await writePointer('zach', `${DS}/${A}`);
    await writePointer('lily', `${DS}/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state).toEqual({ kind: 'race_same_path', collectors: ['lily', 'zach'] });
  });

  it('指针指向当前目录但图片缺失 → invariant_broken，且盖过 race_same_path', async () => {
    await writePointer('zach', `${DS}/${A}`);
    await writePointer('lily', `${DS}/${A}`);
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg', 'images/02.webp']));
    expect(r.state).toEqual({ kind: 'invariant_broken', missing: ['images/01.jpg', 'images/02.webp'] });
  });

  it('note.json 读不出但指针指向当前目录 → invariant_broken', async () => {
    await writePointer('zach', `${DS}/${A}`);
    const r = await checkQuality(store, ref, null);
    expect(r.state).toEqual({ kind: 'invariant_broken', missing: ['note.json'] });
  });

  it('没有指针时图片缺失只记 missingImages，不升级为不变量破裂', async () => {
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state.kind).toBe('no_pointer');
    expect(r.missingImages).toEqual(['images/01.jpg']);
  });

  it('损坏的指针文件不让整个判定失败', async () => {
    await store.writeFile(`_index/6a/${A}/broken.json`, '{ 坏');
    await writePointer('zach', `${DS}/${A}`);
    await store.writeFile(`${DS}/${A}/images/01.jpg`, 'x');
    const r = await checkQuality(store, ref, detailWith(['images/01.jpg']));
    expect(r.state).toEqual({ kind: 'ok' });
  });
});
