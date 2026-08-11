import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import {
  ANNOTATION_FILE,
  normalizeArticleNote,
  readArticleNote,
  writeArticleNote,
} from '../../src/core/article-note';

const DIR = 'collected/6a030b860000000036000201';
let store: Store;

beforeEach(() => { store = createStore(memRoot()); });

describe('article-note', () => {
  it('文件不存在时返回空内容', async () => {
    expect(await readArticleNote(store, DIR)).toBe('');
  });

  it('读取时去掉格式化用的最后一个换行', async () => {
    await store.writeFile(`${DIR}/${ANNOTATION_FILE}`, '第一行\n第二行\n');
    expect(await readArticleNote(store, DIR)).toBe('第一行\n第二行');
  });

  it('统一换行并保证非空文件只有一个结尾换行', () => {
    expect(normalizeArticleNote('第一行\r\n第二行\r\n\r\n')).toBe('第一行\n第二行\n');
  });

  it('纯空白输入归一化为 null', () => {
    expect(normalizeArticleNote(' \n\t\r\n')).toBeNull();
  });

  it('写入非空内容，清空时删除文件', async () => {
    await writeArticleNote(store, DIR, '观察一\r\n观察二');
    expect(await store.readText(`${DIR}/${ANNOTATION_FILE}`)).toBe('观察一\n观察二\n');

    await writeArticleNote(store, DIR, '   \n');
    expect(await store.exists(`${DIR}/${ANNOTATION_FILE}`)).toBe(false);
  });

  it('真实读取错误不会被当成空内容', async () => {
    const broken = { ...store, readText: async () => { throw new Error('read boom'); } };
    await expect(readArticleNote(broken, DIR)).rejects.toThrow('read boom');
  });

  it('写入和删除错误向调用方传播', async () => {
    const writeBroken: Store = {
      ...store,
      writeFile: async () => { throw new Error('write boom'); },
    };
    await expect(writeArticleNote(writeBroken, DIR, '内容')).rejects.toThrow('write boom');

    await store.writeFile(`${DIR}/${ANNOTATION_FILE}`, '内容\n');
    const deleteBroken: Store = {
      ...store,
      removeFile: async () => { throw new Error('delete boom'); },
    };
    await expect(writeArticleNote(deleteBroken, DIR, '')).rejects.toThrow('delete boom');
  });
});
