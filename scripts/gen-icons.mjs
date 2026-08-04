#!/usr/bin/env node
// 扩展图标生成器：红底 + 一张笔记卡片正插入档案盒。
//
// 为什么自己光栅化而不是 SVG 转 PNG：本机没有 rsvg-convert，ImageMagick 只能
// 退回内置 SVG 渲染器，圆角与抗锯齿的结果因机器而异；图标又必须在 16px 下逐像素
// 可控。这里用 SDF（有符号距离场）解析抗锯齿，任何尺寸都按该尺寸的像素宽度算
// 覆盖率，小尺寸不会糊、大尺寸边缘干净，且不引入构建期外部依赖。
// 设计稿坐标系固定 128×128，各输出尺寸只是采样密度不同。

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/icons');
const SIZES = [16, 32, 48, 128];
const CANVAS = 128; // 设计稿边长

// —— 配色 ——
// 小红书红。背景做一道极轻的竖向渐变，纯色在 128px 下显得发闷。
const BG_TOP = [0xff, 0x3b, 0x54];
const BG_BOTTOM = [0xf5, 0x11, 0x38];
const WHITE = [0xff, 0xff, 0xff];

// —— SDF 原语 ——

/** 圆角矩形的有符号距离：内部为负，外部为正，单位与设计稿一致。 */
function sdRoundBox(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 距离 → 覆盖率。pw 是当前输出尺寸下一个像素在设计稿里的宽度。 */
function coverage(d, pw) {
  return Math.min(Math.max(0.5 - d / pw, 0), 1);
}

// —— 图形定义 ——
// 绘制顺序即图层顺序。卡片先画、盒子后画，卡片下缘被盒子遮住 → 读作"正在插进去"。
// 盒盖/盒体各自先用背景色外扩描一圈，让白色部件之间留出红缝。
//
// 两套几何：任何一个特征窄于一个物理像素，在小尺寸下就只会变成一层灰雾，
// 反而把整体轮廓也拖脏。48px 起 1 物理像素 = 2.7 设计单位，撑得住正文线（5 单位）
// 和分层的盒盖/盒体；16px 时 1 物理像素 = 8 设计单位，只够放"一张卡片 + 一个托盘 +
// 一道红缝"三个特征，其余全部去掉，缝也要加宽到能占住一整个像素。
const DETAILED = {
  card: { x0: 38, y0: 11, x1: 90, y1: 86, r: 8 },
  lines: [
    { x0: 48, y0: 25, x1: 80, y1: 30 },
    { x0: 48, y0: 37, x1: 80, y1: 42 },
    { x0: 48, y0: 49, x1: 70, y1: 54 }, // 末行短一截，像一段正文的收尾
  ],
  lid: { x0: 14, y0: 72, x1: 114, y1: 89, r: 5 },
  body: { x0: 22, y0: 94, x1: 106, y1: 117, r: 5 },
  handle: { x0: 53, y0: 101, x1: 75, y1: 109, r: 4 }, // 档案盒的抠手
  gap: 5,
};
const SIMPLE = {
  card: { x0: 43, y0: 16, x1: 85, y1: 74, r: 6 },
  lines: [],
  lid: null,
  body: { x0: 15, y0: 76, x1: 113, y1: 112, r: 8 },
  handle: null,
  gap: 9,
};

/** 算出设计稿坐标 (px, py) 处的最终颜色与不透明度。 */
function shade(px, py, pw, G) {
  // 底：红色圆角方块，外部透明
  const bgCov = coverage(sdRoundBox(px, py, 0, 0, CANVAS, CANVAS, 28), pw);
  if (bgCov <= 0) return [0, 0, 0, 0];

  const t = py / CANVAS;
  let r = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t;
  let g = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t;
  let b = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t;

  const bg = [r, g, b];
  let color = bg;

  const over = (cov, c) => {
    if (cov <= 0) return;
    color = [
      color[0] + (c[0] - color[0]) * cov,
      color[1] + (c[1] - color[1]) * cov,
      color[2] + (c[2] - color[2]) * cov,
    ];
  };
  const box = (s, r2 = s.r) => sdRoundBox(px, py, s.x0, s.y0, s.x1, s.y1, r2);
  const grow = (s, k) =>
    sdRoundBox(px, py, s.x0 - k, s.y0 - k, s.x1 + k, s.y1 + k, s.r + k);

  over(coverage(box(G.card), pw), WHITE); // 笔记卡片
  for (const l of G.lines) over(coverage(box(l, 2.5), pw), bg); // 卡片上的正文线
  if (G.lid) {
    over(coverage(grow(G.lid, G.gap), pw), bg); // 盒盖的红缝
    over(coverage(box(G.lid), pw), WHITE);
  }
  over(coverage(grow(G.body, G.gap), pw), bg); // 盒体的红缝
  over(coverage(box(G.body), pw), WHITE);
  if (G.handle) over(coverage(box(G.handle), pw), bg); // 抠手

  return [color[0], color[1], color[2], bgCov * 255];
}

/** 渲染成 RGBA 像素缓冲。小尺寸多加超采样，SDF 图层叠加处仍会有阶梯感。 */
function render(size) {
  const G = size >= 48 ? DETAILED : SIMPLE;
  const ss = size <= 48 ? 4 : 2; // 每像素边长方向的采样数
  const pw = CANVAS / size;
  const step = CANVAS / (size * ss);
  const buf = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = (x * ss + sx + 0.5) * step;
          const py = (y * ss + sy + 0.5) * step;
          // 覆盖率按整像素宽度算（而非子采样宽度），否则边缘会被削得过硬
          const [r, g, b, a] = shade(px, py, pw, G);
          const w = a / 255;
          ar += r * w; ag += g * w; ab += b * w; aa += w;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      if (aa > 0) {
        buf[i] = Math.round(ar / aa);
        buf[i + 1] = Math.round(ag / aa);
        buf[i + 2] = Math.round(ab / aa);
      }
      buf[i + 3] = Math.round((aa / n) * 255);
    }
  }
  return buf;
}

// —— 最小 PNG 编码器（RGBA8，逐行 filter 0）——

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type: None
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// —— SVG 源文件：给以后改设计用，也用在 README / 面板里；构建不读它 ——

function toSvg(G) {
  const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const rect = (s, r = s.r, fill = 'white') =>
    `<rect x="${s.x0}" y="${s.y0}" width="${s.x1 - s.x0}" height="${s.y1 - s.y0}" rx="${r}" fill="${fill}"/>`;
  const grown = (s, k) =>
    `<rect x="${s.x0 - k}" y="${s.y0 - k}" width="${s.x1 - s.x0 + 2 * k}" height="${s.y1 - s.y0 + 2 * k}" rx="${s.r + k}" fill="url(#bg)"/>`;
  const layers = [
    rect(G.card),
    ...G.lines.map((l) => rect(l, 2.5, 'url(#bg)')),
    ...(G.lid ? [grown(G.lid, G.gap), rect(G.lid)] : []),
    grown(G.body, G.gap),
    rect(G.body),
    ...(G.handle ? [rect(G.handle, G.handle.r, 'url(#bg)')] : []),
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${hex(BG_TOP)}"/>
      <stop offset="1" stop-color="${hex(BG_BOTTOM)}"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  ${layers.join('\n  ')}
</svg>
`;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(render(size), size));
  console.log(`✓ public/icons/icon${size}.png`);
}
writeFileSync(resolve(OUT_DIR, 'icon.svg'), toSvg(DETAILED));
console.log('✓ public/icons/icon.svg（设计源，构建不读）');
