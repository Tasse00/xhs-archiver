# GitHub Actions 发布流程 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一条 `workflow_dispatch` 触发的 GitHub Actions 流水线，一次点击完成「测试 → 类型检查 → 构建 → 打 zip → 改版本号 → 打 tag → 发 Release」。

**Architecture:** 版本号以 `package.json` 为唯一来源，`manifest.config.ts` 从它 import。打包逻辑落在 `scripts/package.mjs`（可本地复现），workflow 只负责编排顺序并把不可逆动作（push / 建 Release）排在所有质量门之后。

**Tech Stack:** GitHub Actions（`ubuntu-latest`、Node 22、`actions/checkout` v4、`actions/setup-node` v4）、`gh` CLI（runner 预装）、系统 `zip` CLI、Vitest、TypeScript 7。

配套设计文档：`docs/superpowers/specs/2026-08-05-github-actions-release-design.md`。有分歧以它为准。

## Global Constraints

- **远端仓库：** `https://github.com/Tasse00/xhs-archiver`，`origin` 已配好，远端当前是空仓库（无任何分支）。
- **起始版本号统一为 `0.1.0`**，首个 Release 即 `v0.1.0`。
- **版本号唯一来源是 `package.json`。** 任何地方都不得再硬编码版本号。
- **不引入任何新的 npm 依赖**，也不使用第三方 GitHub Action（`actions/checkout`、`actions/setup-node` 除外）。
- **不做 push/PR 上的独立 CI、不自动生成 changelog、不做 prerelease/draft、不上架商店、不签 `.crx`。**
- **注释用中文，写「为什么」而不是「做了什么」**（项目约定）。
- **每个任务结束提交一次。**
- Task 1–4 只在本地提交，**不要 push**。push 是 Task 6 的动作，需要用户确认。

---

### Task 1: 修好 `tsc --noEmit` 的 8 个既有错误

`npx tsc --noEmit` 现在退出码为 1。它是流水线第 4 步的质量门，不修则首次发布必然失败。本任务与发布流程无耦合，可独立验收。

**Files:**
- Create: `src/fsa.d.ts`
- Modify: `tests/core/browse/row-meta.test.ts:69-70`
- Modify: `tests/core/read-store.test.ts:50`

**Interfaces:**
- Consumes: 无
- Produces: `npx tsc --noEmit` 退出码 0。Task 5 的 workflow 依赖这一点。

- [ ] **Step 1: 跑类型检查，确认它失败**

```bash
npx tsc --noEmit; echo "exit=$?"
```

预期：`exit=1`，8 条 `error TS`。其中 5 条是 `queryPermission` / `requestPermission` / `showDirectoryPicker` 不存在，3 条是 `TS2352` 断言过窄。

- [ ] **Step 2: 新建 `src/fsa.d.ts`**

```ts
// File System Access 的权限 API 不在 TS 内置 lib 里，@types/chrome 也不提供，
// 但 handle-store / PermissionGate / App 都要用。这里只补项目实际调用的三个成员，
// 不整套引入 —— 多出来的声明没人验证，反而会让错误的用法通过编译。
//
// queryPermission/requestPermission 声明在 FileSystemHandle 上而非
// FileSystemDirectoryHandle 上：后者继承前者，声明一次两边都有。

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: FileSystemHandle | string;
  }): Promise<FileSystemDirectoryHandle>;
}
```

- [ ] **Step 3: 再跑类型检查，确认只剩 3 条**

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

预期：`3`，且都在 `tests/` 下。若 FSA 那 5 条还在，说明 `src/fsa.d.ts` 没被 `include` 覆盖 —— `tsconfig.json` 的 `include` 是 `["src", "tests", "*.ts"]`，`src` 目录下的 `.d.ts` 应当被自动纳入。

- [ ] **Step 4: 修 `tests/core/browse/row-meta.test.ts` 的两处断言**

把第 69–70 行：

```ts
    expect(r.ok && (r.detail as Record<string, unknown>).raw).toBeUndefined();
    expect(r.ok && (r.meta as Record<string, unknown>).raw).toBeUndefined();
```

改成：

```ts
    // 断言的是「raw 这个键不该存在」，而 NoteDetail/RowMeta 类型里本就没有它，
    // 所以必须先过 unknown 才能转成索引签名类型。
    expect(r.ok && (r.detail as unknown as Record<string, unknown>).raw).toBeUndefined();
    expect(r.ok && (r.meta as unknown as Record<string, unknown>).raw).toBeUndefined();
```

- [ ] **Step 5: 修 `tests/core/read-store.test.ts` 的一处断言**

把第 50 行：

```ts
    const ro = toReadStore(store) as Record<string, unknown>;
```

改成：

```ts
    // 这个测试的意义就是探测 ReadStore 类型里没有的写方法，转换必须经 unknown。
    const ro = toReadStore(store) as unknown as Record<string, unknown>;
```

- [ ] **Step 6: 确认类型检查通过且测试没被改坏**

```bash
npx tsc --noEmit; echo "tsc exit=$?"
npm test
```

预期：`tsc exit=0`（无任何输出），`npm test` 全绿。

- [ ] **Step 7: 提交**

```bash
git add src/fsa.d.ts tests/core/browse/row-meta.test.ts tests/core/read-store.test.ts
git commit -m "fix: 补齐 FSA 权限 API 类型声明，修好 tsc --noEmit"
```

---

### Task 2: 版本号收敛到 `package.json`

**Files:**
- Create: `tests/manifest-version.test.ts`
- Modify: `tsconfig.json`（加 `resolveJsonModule`）
- Modify: `manifest.config.ts:6`（`version` 硬编码 → 读 `pkg.version`）
- Modify: `package.json:3`（`version` 由 `1.0.0` 改 `0.1.0`）

**Interfaces:**
- Consumes: Task 1 产出的 `tsc --noEmit` 退出码 0
- Produces: `package.json` 的 `version` 字段是全项目唯一版本号来源；`npm run build` 后 `dist/manifest.json` 的 `version` 等于它。Task 3、Task 5 都依赖这条。

- [ ] **Step 1: 写会失败的测试**

新建 `tests/manifest-version.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import manifest from '../manifest.config';
import pkg from '../package.json';

// 守的是「有人图省事把版本号硬编码回 manifest.config.ts」这件事。
// 一旦两处脱钩，zip 的文件名和扩展里显示的版本号就会对不上，而这在 CI 上不报错。
describe('版本号唯一来源', () => {
  it('manifest 的版本号取自 package.json', () => {
    expect(manifest.version).toBe(pkg.version);
  });
});
```

- [ ] **Step 2: 跑它，确认失败**

```bash
npx vitest run tests/manifest-version.test.ts
```

预期：FAIL，`expected '0.1.0' to be '1.0.0'`（manifest 硬编码 `0.1.0`，package.json 是 `1.0.0`）。

若报的是 `Cannot find module '../package.json'` 之类的解析错误，那是 Step 3 要解决的问题，同样算「失败」，继续往下。

- [ ] **Step 3: `tsconfig.json` 打开 `resolveJsonModule`**

在 `compilerOptions` 里加一行（放在 `moduleResolution` 之后）：

```json
    "resolveJsonModule": true,
```

不加这行，`manifest.config.ts` 里 import JSON 会报 `TS2732`。当前 `moduleResolution` 是 `"bundler"`，不会自动打开它。

- [ ] **Step 4: `package.json` 版本号改成 `0.1.0`**

把第 3 行 `"version": "1.0.0",` 改成：

```json
  "version": "0.1.0",
```

`1.0.0` 是 `npm init` 的默认值，没有语义；`0.1.0` 是 manifest 里一直在用的、有意义的那个。

- [ ] **Step 5: `manifest.config.ts` 改为读 `package.json`**

在文件顶部的 import 之后加一行：

```ts
import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';
```

把 `version: '0.1.0',` 改成：

```ts
  // 版本号唯一来源是 package.json，发布流程只改那一处（见
  // docs/superpowers/specs/2026-08-05-github-actions-release-design.md §4）。
  // 不要在这里硬编码，否则 zip 文件名与扩展显示的版本会对不上。
  version: pkg.version,
```

- [ ] **Step 6: 跑测试，确认通过**

```bash
npx vitest run tests/manifest-version.test.ts
```

预期：PASS。

- [ ] **Step 7: 验证构建产物真的跟着变**

```bash
npm run build
node -p "require('./dist/manifest.json').version"
```

预期：输出 `0.1.0`。

这一步不能省。测试验的是 `manifest.config.ts` 这个模块，而 crxjs 是否把它的 `version` 原样写进 `dist/manifest.json` 是另一回事。

- [ ] **Step 8: 确认类型检查与全量测试仍然通过**

```bash
npx tsc --noEmit; echo "tsc exit=$?"
npm test
```

预期：`tsc exit=0`，测试全绿。

- [ ] **Step 9: 提交**

```bash
git add tsconfig.json manifest.config.ts package.json tests/manifest-version.test.ts
git commit -m "refactor: 版本号收敛到 package.json，manifest 从中读取"
```

---

### Task 3: 安装说明 `INSTALL.md`

单独成任务是因为它是面向使用者的文案，与 Task 4 的打包机制可以分开评审。

**Files:**
- Create: `INSTALL.md`

**Interfaces:**
- Consumes: 无
- Produces: 仓库根的 `INSTALL.md`。Task 4 的 `scripts/package.mjs` 会把它复制进 zip；Task 6 的 Release 正文会引用它。

- [ ] **Step 1: 写 `INSTALL.md`**

```markdown
# 安装小红书笔记归档插件

这个扩展没有上架 Chrome 应用商店，需要手动加载。全程不到一分钟。

## 一、加载扩展

1. 把下载到的 `xhs-archiver-x.y.z.zip` **解压**，会得到一个同名文件夹
2. 打开 Chrome，地址栏输入 `chrome://extensions` 回车
3. 打开右上角的 **「开发者模式」** 开关
4. 点左上角 **「加载已解压的扩展程序」**
5. 选中第 1 步解压出来的那个文件夹 —— 就是**直接包含 `manifest.json` 的那一层**，不要再往下点

侧边栏图标出现在工具栏上就算装好了。

## 二、首次使用

1. 点工具栏上的插件图标，打开侧边栏
2. 侧边栏会依次要你完成三件事：
   - **选择数据仓库目录** —— 归档的笔记会写到这里。建议先单独建一个空文件夹
   - **填写采集者 ID** —— 用来标记「这篇是谁采的」，随便一个短名字即可
   - **确认写入路径** —— 默认 `collected`，不确定就用默认值
3. 打开任意一篇小红书**图文**笔记（视频笔记不支持），点侧边栏的采集按钮

## 三、常见问题

**装完提示「无法加载清单文件」**
选错目录了。要选的是直接含 `manifest.json` 的那一层，不是它的上一级。

**侧边栏提示需要重新授权**
Chrome 会在扩展的最后一个标签页关闭时回收目录访问权限，这是浏览器行为，不是插件出错。按侧边栏的提示点一下恢复授权即可，**不需要重选目录**。

**侧边栏提示仓库目录不存在**
数据仓库目录被移动或删除了。这种情况只能重新选择目录。

**更新到新版本**
下载新的 zip 解压，回到 `chrome://extensions`，把旧的那个扩展**移除**后重新「加载已解压的扩展程序」。数据仓库里已归档的内容不受影响，但需要重新授权目录。
```

- [ ] **Step 2: 核对说明与实际实现一致**

逐条对照 `src/sidepanel/App.tsx` 的配置流程，确认「选目录 → 采集者 ID → 确认写入路径」这个顺序、以及默认写入路径 `collected` 与代码一致：

```bash
grep -n "need_root\|need_collector\|need_path\|collected" src/sidepanel/App.tsx | head -30
```

若实际顺序或默认值与文案不符，**改文案，不要改代码** —— 代码是验收过的。

- [ ] **Step 3: 提交**

```bash
git add INSTALL.md
git commit -m "docs: 新增面向使用者的安装说明"
```

---

### Task 4: 打包脚本 `scripts/package.mjs`

**Files:**
- Create: `scripts/package.mjs`
- Modify: `package.json`（`scripts` 里加 `package`）
- Modify: `.gitignore`（忽略产出的 zip）

**Interfaces:**
- Consumes: Task 2 的「`dist/manifest.json` 版本号 === `package.json` 版本号」；Task 3 的 `INSTALL.md`
- Produces: `npm run package` 命令，产出仓库根的 `xhs-archiver-<version>.zip`。Task 5 的 workflow 第 7 步调用它，第 9 步上传它。

- [ ] **Step 1: 写 `scripts/package.mjs`**

```js
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
```

- [ ] **Step 2: `package.json` 加脚本**

在 `scripts` 里加一条（放在 `build` 之后）：

```json
    "package": "node scripts/package.mjs",
```

- [ ] **Step 3: `.gitignore` 忽略产出的 zip**

在文件末尾加：

```
xhs-archiver-*.zip
```

- [ ] **Step 4: 跑一遍，确认能出包**

```bash
npm run build && npm run package
```

预期：输出 `✓ xhs-archiver-0.1.0.zip`。

- [ ] **Step 5: 验证 zip 的结构是对的**

```bash
unzip -l xhs-archiver-0.1.0.zip | head -20
```

预期：能看到 `manifest.json` 和 `INSTALL.md`**都在根层**（路径里没有前缀目录），以及 `icons/`、`assets/`、`src/`。

```bash
unzip -p xhs-archiver-0.1.0.zip manifest.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version"
```

预期：`0.1.0`。

- [ ] **Step 6: 验证防呆检查真的会拦**

```bash
node -e "
const fs=require('fs');
const m=JSON.parse(fs.readFileSync('dist/manifest.json','utf8'));
m.version='9.9.9';
fs.writeFileSync('dist/manifest.json',JSON.stringify(m));
"
npm run package; echo "exit=$?"
```

预期：`exit=1`，并打印 `✗ dist 里的版本号是 9.9.9，package.json 是 0.1.0...`。

改坏的是构建产物，恢复只需重新构建：

```bash
npm run build && npm run package
```

预期：重新出包成功。

- [ ] **Step 7: 清掉本地产物，确认它不进 git**

```bash
rm -f xhs-archiver-*.zip
git status --short
```

预期：`git status` 里不出现任何 zip。

- [ ] **Step 8: 提交**

```bash
git add scripts/package.mjs package.json .gitignore
git commit -m "feat: 新增 npm run package，把 dist 打成可直接加载的 zip"
```

---

### Task 5: 发布 workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `npm test`、`npx tsc --noEmit`（Task 1）、`npm run build`（Task 2）、`npm run package` 与 `xhs-archiver-<version>.zip`（Task 4）
- Produces: GitHub Actions 上一个名为 `Release` 的手动 workflow

- [ ] **Step 1: 写 `.github/workflows/release.yml`**

```yaml
name: Release

# 只手动触发。版本号由人填，CI 不猜。
on:
  workflow_dispatch:
    inputs:
      version:
        description: '版本号，形如 0.2.0（不要带 v 前缀）'
        required: true
        type: string

# 防止手滑连点两次并发跑出两个 tag。不取消进行中的那次 —— 它可能已经 push 了。
concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: write # 需要 push commit/tag 和创建 Release

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # 默认是深度 1 的浅克隆，从浅克隆往回 push 在某些情况下会被拒。
          # 仓库很小，取全量省掉这一整类失败。
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm

      # —— 以下四步都是质量门，任一失败都不会对仓库产生任何影响 ——

      - name: 校验输入与前置条件
        env:
          VERSION: ${{ inputs.version }}
        run: |
          set -euo pipefail
          if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
            echo "::error::版本号必须是 x.y.z 形式，收到的是 '$VERSION'"
            exit 1
          fi
          # 只允许从 main 发布，避免从功能分支发出一个内容不明的版本
          if [ "$GITHUB_REF_NAME" != "main" ]; then
            echo "::error::只能从 main 分支发布，当前是 $GITHUB_REF_NAME"
            exit 1
          fi
          if git ls-remote --exit-code origin "refs/tags/v$VERSION" >/dev/null 2>&1; then
            echo "::error::tag v$VERSION 已存在。若是上次发布中途失败，见本文件底部的补救说明"
            exit 1
          fi

      - run: npm ci

      - run: npm test

      # vite build 不做类型检查，这一步不可省
      - run: npx tsc --noEmit

      # —— 以下是产物生成。仍未触碰远端 ——

      - name: 改版本号并打 tag
        env:
          VERSION: ${{ inputs.version }}
        run: |
          set -euo pipefail
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          # npm version 在目标版本与当前相同时会报 Version not changed 退出，
          # 而首个 Release 恰好是这种情况（仓库里已经是 0.1.0）。所以拆成两步：
          # 版本号已经对的时候只打 tag。
          CURRENT=$(node -p "require('./package.json').version")
          if [ "$CURRENT" != "$VERSION" ]; then
            npm version "$VERSION" --no-git-tag-version
            git commit -am "chore: release v$VERSION"
          fi
          git tag "v$VERSION"

      # 必须排在改版本号之后：manifest 的版本是从 package.json 读的
      - run: npm run build

      - run: npm run package

      # —— 从这里开始不可逆 ——

      - name: 推送 commit 与 tag
        run: git push --follow-tags

      - name: 创建 Release
        env:
          GH_TOKEN: ${{ github.token }}
          VERSION: ${{ inputs.version }}
        run: |
          set -euo pipefail
          gh release create "v$VERSION" "xhs-archiver-$VERSION.zip" \
            --title "v$VERSION" \
            --notes '下载 zip 解压后，在 `chrome://extensions` 打开开发者模式，点「加载已解压的扩展程序」，选中解压出来的文件夹。详细步骤见包内的 `INSTALL.md`。'

# —— 补救说明 ——
# 「推送 commit 与 tag」成功、「创建 Release」失败时，tag 已经在远端，重跑会卡在
# 第一步的 tag 存在性检查上。这时不要删 tag 重来，本地执行：
#
#   git fetch --tags && git checkout "v<version>"
#   npm ci && npm run build && npm run package
#   gh release create "v<version>" "xhs-archiver-<version>.zip" --title "v<version>"
```

- [ ] **Step 2: 校验 YAML 语法**

```bash
npx --yes js-yaml .github/workflows/release.yml > /dev/null && echo "YAML OK"
```

预期：`YAML OK`。语法错在 GitHub 上表现为 workflow 根本不出现在 Actions 列表里，很难排查，所以本地先过一遍。

- [ ] **Step 3: 逐条核对步骤顺序**

对照设计文档 `§6.1` 的表格，确认 9 个步骤的顺序与其一致，尤其是这三条：

1. 校验（含 tag 存在性）排在 `npm ci` 之前 —— 输入写错时几秒就失败
2. `npm run build` 排在「改版本号」之后 —— 否则 manifest 里是旧版本号
3. `git push` 排在 `npm run package` 之后 —— 它是第一个不可逆动作

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/release.yml
git commit -m "ci: 新增手动触发的 Release 流水线"
```

---

### Task 6: 文档同步、首次 push、实跑一次发布

**这个任务需要用户参与**，agent 不能独自完成 Step 4 之后的操作。

**Files:**
- Modify: `README.md`（加「安装」段）
- Modify: `CLAUDE.md`（「现状」里补一句发布流程）

**Interfaces:**
- Consumes: Task 1–5 的全部产出
- Produces: 远端 `main` 分支、tag `v0.1.0`、GitHub Release `v0.1.0` 及其 zip 附件

- [ ] **Step 1: `README.md` 加「安装」段**

插在 `## 解决什么问题` 之后、`## 数据长什么样` 之前：

```markdown
## 安装

到 [Releases](https://github.com/Tasse00/xhs-archiver/releases) 下载最新的 `xhs-archiver-x.y.z.zip`，解压后在 `chrome://extensions` 打开开发者模式，点「加载已解压的扩展程序」，选中解压出来的文件夹。

完整步骤与首次使用配置见 [`INSTALL.md`](INSTALL.md)。
```

- [ ] **Step 2: `CLAUDE.md` 的「现状」补一句**

在「现状」小节末尾（`**下一步动作：**` 那段之前）加一段：

```markdown
**发布：** 手动在 GitHub Actions 上触发 `Release` workflow 并填版本号，产出挂在 Release 上的 zip（手动加载安装，不上架商店）。版本号唯一来源是 `package.json`，`manifest.config.ts` 从中读取——不要在 manifest 里硬编码版本号。细节见 `docs/superpowers/specs/2026-08-05-github-actions-release-design.md`。
```

- [ ] **Step 3: 提交文档改动**

```bash
git add README.md CLAUDE.md
git commit -m "docs: README 与 CLAUDE.md 同步发布流程"
```

- [ ] **Step 4: 最后一次本地全量验证**

```bash
npm ci && npm test && npx tsc --noEmit && npm run build && npm run package && unzip -l xhs-archiver-0.1.0.zip | head
rm -f xhs-archiver-*.zip
git status --short
```

预期：全部通过，`git status` 干净。这一步是把 workflow 里的质量门在本地原样跑一遍 —— 本地过不了，CI 一定过不了。

- [ ] **Step 5: 【需要用户确认】首次 push main**

远端目前是空仓库。push 是把整个项目公开出去的动作，**执行前必须向用户确认**。

```bash
git push -u origin main
```

- [ ] **Step 6: 【用户操作】触发首次发布**

请用户在浏览器里操作：

1. 打开 <https://github.com/Tasse00/xhs-archiver/actions>
2. 左侧选 **Release**
3. 点 **Run workflow**，`version` 填 `0.1.0`，确认分支是 `main`
4. 点绿色的 **Run workflow** 按钮

- [ ] **Step 7: 验收首次发布**

等 workflow 跑完（约 1–2 分钟），逐项确认：

```bash
git fetch --tags && git tag        # 预期能看到 v0.1.0
gh release view v0.1.0             # 预期能看到 Release 与 zip 附件
```

再由用户确认这三项：

1. Release 页面上有 `xhs-archiver-0.1.0.zip` 附件，能下载
2. 下载解压后，在 `chrome://extensions` 用「加载已解压的扩展程序」选中解压出的文件夹，**能加载成功**
3. 扩展详情页显示的版本号是 `0.1.0`

- [ ] **Step 8: 若发布失败，按现象归类**

不要盲目重跑。对照这三类：

| 现象 | 原因 | 处理 |
|---|---|---|
| 卡在「校验输入与前置条件」 | 版本号格式错、或 tag 已存在 | 换版本号；tag 已存在说明上次 push 成功了，走 `release.yml` 底部的补救流程 |
| 卡在 `npm test` / `tsc` / `build` | 代码问题 | 仓库零污染，修完直接重跑同一个版本号 |
| 卡在「推送 commit 与 tag」 | main 有分支保护规则 | 见设计文档 §6.5 |
| 卡在「创建 Release」 | tag 已推出去 | 走 `release.yml` 底部的补救流程，不要删 tag |
