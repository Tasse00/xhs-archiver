import { describe, it, expect } from 'vitest';
import { downloadImage, downloadCommentImage, type Deps } from '../../src/core/downloader';
import type { ExtractedCommentImage, ExtractedImage } from '../../src/types';

const img: ExtractedImage = {
  index: 1,
  fileId: 'notes_pre_post/abc',
  declaredWidth: 3106,
  declaredHeight: 4096,
  isLive: false,
  urlDefault: 'http://cdn/dft.webp',
  urlPre: 'http://cdn/pre.webp',
};

function makeDeps(handlers: Record<string, { status?: number; type?: string; size?: number }>): Deps {
  return {
    fetch: (async (url: string) => {
      const h = handlers[url];
      if (!h) return { ok: false, status: 404, headers: new Headers() } as unknown as Response;
      const status = h.status ?? 200;
      const body = new Uint8Array(h.size ?? 8);
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': h.type ?? 'image/jpeg' }),
        arrayBuffer: async () => body.buffer,
        blob: async () => new Blob([body]),
      } as unknown as Response;
    }) as unknown as typeof fetch,
    async decode() { return { width: 3106, height: 4096 }; },
    async sha256() { return 'fakehash'; },
  };
}

describe('downloadImage', () => {
  it('原图可解码且尺寸匹配时接受', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'image/jpeg', size: 1000 },
    });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('original');
    expect(r.ext).toBe('jpg');
    expect(r.width).toBe(3106);
    expect(r.bytes.byteLength).toBe(1000);
  });

  it('HEIC 原图被跳过，降级到 WB_DFT', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'image/heic' },
      'https://ci.xiaohongshu.com/notes_pre_post/abc': { type: 'image/heic' },
      'http://cdn/dft.webp': { type: 'image/webp' },
    });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('WB_DFT');
    expect(r.ext).toBe('webp');
  });

  it('第一个 host 失败时用第二个 host', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { status: 403 },
      'https://ci.xiaohongshu.com/notes_pre_post/abc': { type: 'image/jpeg' },
    });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('original');
    expect(r.sourceUrl).toBe('https://ci.xiaohongshu.com/notes_pre_post/abc');
  });

  it('尺寸与声明不符时降级', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'image/jpeg' },
      'https://ci.xiaohongshu.com/notes_pre_post/abc': { type: 'image/jpeg' },
      'http://cdn/dft.webp': { type: 'image/webp' },
    });
    deps.decode = async () => ({ width: 100, height: 100 });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('WB_DFT');
    // 降级图不做尺寸校验，记录解码所得
    expect(r.width).toBe(100);
  });

  it('非图片 Content-Type 被跳过', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'text/html' },
      'https://ci.xiaohongshu.com/notes_pre_post/abc': { type: 'text/html' },
      'http://cdn/dft.webp': { type: 'image/webp' },
    });
    const r = await downloadImage(img, deps);
    expect(r.sourceKind).toBe('WB_DFT');
  });

  it('全部候选失败时抛错并带 index', async () => {
    await expect(downloadImage(img, makeDeps({}))).rejects.toThrow(/第 1 张/);
  });

  it('返回 sha256', async () => {
    const deps = makeDeps({
      'https://sns-img-qc.xhscdn.com/notes_pre_post/abc': { type: 'image/jpeg' },
    });
    expect((await downloadImage(img, deps)).sha256).toBe('fakehash');
  });
});

describe('downloadCommentImage', () => {
  const cimg: ExtractedCommentImage = {
    index: 1,
    declaredWidth: 284,
    declaredHeight: 367,
    urlDefault: 'https://cdn/c-dft.webp',
    urlPre: 'https://cdn/c-pre.webp',
  };

  it('优先取 WB_DFT', async () => {
    const deps = makeDeps({
      'https://cdn/c-dft.webp': { type: 'image/webp' },
      'https://cdn/c-pre.webp': { type: 'image/webp' },
    });
    const r = await downloadCommentImage(cimg, deps);
    expect(r.sourceKind).toBe('WB_DFT');
    expect(r.sourceUrl).toBe('https://cdn/c-dft.webp');
  });

  it('WB_DFT 失败时退到 WB_PRV', async () => {
    const deps = makeDeps({ 'https://cdn/c-pre.webp': { type: 'image/webp' } });
    expect((await downloadCommentImage(cimg, deps)).sourceKind).toBe('WB_PRV');
  });

  // 评论图没有 fileId，构造出的原图地址实测一律 404，试它纯属浪费一次请求。
  it('不尝试原图地址', async () => {
    const seen: string[] = [];
    const deps = makeDeps({ 'https://cdn/c-dft.webp': { type: 'image/webp' } });
    const inner = deps.fetch;
    deps.fetch = ((url: string) => { seen.push(url); return inner(url); }) as unknown as typeof fetch;
    await downloadCommentImage(cimg, deps);
    expect(seen.every((u) => !u.includes('sns-img-qc') && !u.includes('ci.xiaohongshu'))).toBe(true);
  });

  // 声明尺寸是页面上的展示尺寸，实测 284x367 的图实际是 556x717。
  // 拿它做校验会让每张评论图都判为「尺寸不符」而全数失败。
  it('不按声明尺寸校验，记录解码所得的真实尺寸', async () => {
    const deps = makeDeps({ 'https://cdn/c-dft.webp': { type: 'image/webp' } });
    deps.decode = async () => ({ width: 556, height: 717 });
    const r = await downloadCommentImage(cimg, deps);
    expect(r.sourceKind).toBe('WB_DFT');
    expect([r.width, r.height]).toEqual([556, 717]);
  });

  it('全部候选失败时抛错', async () => {
    await expect(downloadCommentImage(cimg, makeDeps({}))).rejects.toThrow(/评论图/);
  });
});
