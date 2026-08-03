import { describe, it, expect } from 'vitest';
import { downloadImage, type Deps } from '../../src/core/downloader';
import type { ExtractedImage } from '../../src/types';

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
