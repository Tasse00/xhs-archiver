#!/usr/bin/env node
// 把 dist/ 打成可直接「加载已解压的扩展程序」的 zip。
//
// 为什么单独成脚本而不是写在 workflow 的 shell 步骤里：CI 上打包失败时日志是
// 唯一线索，做成脚本后本地能打出内容一致的包，排查不依赖 CI。
//
// 为什么不顺手调用 vite build：构建与打包分开，失败时能一眼看出是哪一步。
// 代价是必须自己防「拿陈旧产物打包」，即下面的版本号一致性检查。

import { existsSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const pkgVersion = JSON.parse(
  readFileSync(resolve(ROOT, 'package.json'), 'utf8'),
).version;

if (!existsSync(DIST)) fail('dist/ 不存在，先跑 npm run build');

const distManifest = resolve(DIST, 'manifest.json');
if (!existsSync(distManifest)) fail('dist/manifest.json 不存在，构建没出全，先跑 npm run build');

// 防呆的关键一步：改完版本号忘了重新构建的话，zip 文件名会是新版本、
// 里面的 manifest 却是旧版本，装上之后完全看不出问题。
const distVersion = JSON.parse(readFileSync(distManifest, 'utf8')).version;
if (distVersion !== pkgVersion) {
  fail(
    `dist 里的版本号是 ${distVersion}，package.json 是 ${pkgVersion}。` +
      '构建产物是旧的，先跑 npm run build',
  );
}

// INSTALL.md 与 manifest.json 同级 —— Chrome 会忽略 manifest 未声明的文件。
// vite build 每次会清空 outDir，所以这里每次都要重新复制。
copyFileSync(resolve(ROOT, 'INSTALL.md'), resolve(DIST, 'INSTALL.md'));

const zipPath = resolve(ROOT, `xhs-archiver-${pkgVersion}.zip`);
// zip 遇到已存在的归档是「追加」而不是「覆盖」，不先删就会把上一次的残留带进去。
rmSync(zipPath, { force: true });

// 在 dist 里执行，让 zip 的根就是扩展根 —— 解压出来那一层直接含 manifest.json，
// 不需要使用者再往下点一级（这是手动加载扩展最常见的失败原因）。
// -X 去掉 macOS 的额外文件属性，免得 Linux 上解压出一堆无关元数据。
execFileSync('zip', ['-r', '-X', '-9', '-q', zipPath, '.'], {
  cwd: DIST,
  stdio: 'inherit',
});

console.log(`✓ xhs-archiver-${pkgVersion}.zip`);
