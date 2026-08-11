import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { ensureRepoTemplates } from '../../src/core/repo-template';

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('ensureRepoTemplates', () => {
  it('首次调用创建三个文件', async () => {
    const created = await ensureRepoTemplates(store);
    expect(created.sort()).toEqual(['.gitattributes', '.gitignore', 'README.md']);
  });

  it('.gitattributes 含 LFS 与 -merge 规则', async () => {
    await ensureRepoTemplates(store);
    const txt = (await store.readText('.gitattributes'))!;
    expect(txt).toContain('**/images/** filter=lfs diff=lfs merge=lfs -text');
    expect(txt).toContain('_index/**/*.json -merge');
    expect(txt).toContain('**/note.json -merge');
    // 同理：逐行合并会往 json 里插冲突标记，把文件变成非法 JSON
    expect(txt).toContain('**/comments.json -merge');
  });

  it('README 含冲突处理与解除阻止的指引', async () => {
    await ensureRepoTemplates(store);
    const txt = (await store.readText('README.md'))!;
    expect(txt).toContain('git checkout --theirs');
    expect(txt).toContain('_index/');
    expect(txt).toContain('last_archived_at');
  });

  // 拿到这个仓库的人不会知道评论是「只采了页面上加载出来的」，
  // 不写清楚就会把 20/96 条评论当成全部去做分析。
  it('README 说明评论的采集范围', async () => {
    await ensureRepoTemplates(store);
    const txt = (await store.readText('README.md'))!;
    expect(txt).toContain('comments.json');
    expect(txt).toContain('collected_count');
    expect(txt).toContain('declared_total');
  });

  it('README 说明 annotation.txt 是可选的文章级人工 Note', async () => {
    await ensureRepoTemplates(store);
    const txt = (await store.readText('README.md'))!;
    expect(txt).toContain('annotation.txt');
    expect(txt).toContain('文章级');
    expect(txt).toContain('更新、接管和迁移');
  });

  it('已存在的文件不被覆盖', async () => {
    await store.writeFile('README.md', '我自己写的\n');
    const created = await ensureRepoTemplates(store);
    expect(created).not.toContain('README.md');
    expect(await store.readText('README.md')).toBe('我自己写的\n');
  });

  it('重复调用是幂等的', async () => {
    await ensureRepoTemplates(store);
    expect(await ensureRepoTemplates(store)).toEqual([]);
  });
});
