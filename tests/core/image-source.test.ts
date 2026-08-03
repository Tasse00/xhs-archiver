import { describe, it, expect } from 'vitest';
import { candidatesFor, extensionFor, isDecodable } from '../../src/core/image-source';
import type { ExtractedImage } from '../../src/types';

const img: ExtractedImage = {
  index: 1,
  fileId: 'notes_pre_post/abc123',
  declaredWidth: 3106,
  declaredHeight: 4096,
  isLive: false,
  urlDefault: 'http://sns-webpic-qc.xhscdn.com/dft.webp',
  urlPre: 'http://sns-webpic-qc.xhscdn.com/pre.webp',
};

describe('candidatesFor', () => {
  it('原图两个 host 优先，然后 WB_DFT，最后 WB_PRV', () => {
    expect(candidatesFor(img)).toEqual([
      { kind: 'original', url: 'https://sns-img-qc.xhscdn.com/notes_pre_post/abc123' },
      { kind: 'original', url: 'https://ci.xiaohongshu.com/notes_pre_post/abc123' },
      { kind: 'WB_DFT', url: 'http://sns-webpic-qc.xhscdn.com/dft.webp' },
      { kind: 'WB_PRV', url: 'http://sns-webpic-qc.xhscdn.com/pre.webp' },
    ]);
  });

  it('缺 fileId 时跳过原图候选', () => {
    expect(candidatesFor({ ...img, fileId: '' })).toEqual([
      { kind: 'WB_DFT', url: 'http://sns-webpic-qc.xhscdn.com/dft.webp' },
      { kind: 'WB_PRV', url: 'http://sns-webpic-qc.xhscdn.com/pre.webp' },
    ]);
  });

  it('空的降级 URL 不进入候选', () => {
    expect(candidatesFor({ ...img, urlDefault: '', urlPre: '' })).toHaveLength(2);
  });
});

describe('extensionFor', () => {
  it('识别常见类型', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/webp; charset=binary')).toBe('webp');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/heic')).toBe('heic');
  });
  it('非图片返回 null', () => {
    expect(extensionFor('text/html')).toBeNull();
  });
});

describe('isDecodable', () => {
  it('HEIC 不可解码', () => expect(isDecodable('image/heic')).toBe(false));
  it('JPEG/WebP/PNG 可解码', () => {
    expect(isDecodable('image/jpeg')).toBe(true);
    expect(isDecodable('image/webp')).toBe(true);
    expect(isDecodable('image/png')).toBe(true);
  });
});
