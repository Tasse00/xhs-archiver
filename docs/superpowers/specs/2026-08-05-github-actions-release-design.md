# GitHub Actions 发布流程 — 设计文档

配套阅读：`2026-08-03-xhs-archiver-design.md`（主设计文档，唯一权威）。本文只描述发布流程，不涉及扩展本身的行为。

远端仓库：<https://github.com/Tasse00/xhs-archiver>

## 1. 目标

把「改完代码 → 别人能装上这个版本」这件事固定成一条可重复的流水线，产物是挂在 GitHub Release 上的 zip。

要解决的实际问题有两个：

- **版本号现在有两处且不一致**（`package.json` 是 `1.0.0`，`manifest.config.ts` 是 `0.1.0`）。手工同步迟早会漏
- **构建产物没有归档**。`dist/` 在 `.gitignore` 里，「上周那个能用的版本」现在找不回来

## 2. 范围

**做：** 一条 `workflow_dispatch` 触发的发布流水线，跑测试与类型检查、构建、打 zip、改版本号、打 tag、建 Release。

**不做（明确排除，不是遗漏）：**

- **不做 push/PR 上的独立 CI。** 质量门只在发布时跑
- **不自动生成 changelog。** Release 正文手写
- **不做 prerelease / draft。** 每次发布都是正式版
- **不上架 Chrome Web Store。** 分发方式就是「下载 zip、解压、加载已解压的扩展程序」
- **不做自签 `.crx` + `update_url`。** Chrome 早已默认拒绝非商店 crx 安装，个人使用装不上
- **CI 不执行任何 git 以外的仓库操作。** 与主文档「插件不执行 git 命令」是两回事——那条约束的是扩展运行时，这里约束的是 CI

## 3. 分发形态

zip 的根目录**就是**扩展根目录：

```
xhs-archiver-0.1.0.zip
└── (解压后)
    ├── manifest.json
    ├── INSTALL.md
    ├── icons/
    ├── assets/
    ├── src/
    └── service-worker-loader.js
```

解压出来的那个目录可直接用于「加载已解压的扩展程序」，**不需要再往下点一层**。多一层目录是最常见的安装失败原因。

`INSTALL.md` 与 `manifest.json` 同级。Chrome 会忽略 manifest 未声明的文件，不影响加载。将来若要上架商店，需要把它从包里排除。

## 4. 版本号：单一来源

**`package.json` 的 `version` 是唯一来源。** `manifest.config.ts` 从它读：

```ts
import pkg from './package.json';

export default defineManifest({
  // 版本号唯一来源是 package.json。改版本号走 npm version，不要手改这里，
  // 否则 zip 文件名与 manifest 里的版本会对不上。
  version: pkg.version,
  ...
});
```

这需要 `tsconfig.json` 打开 `resolveJsonModule`（当前 `moduleResolution: "bundler"` 下不开会编译报错）。

推进方式是 `npm version <x.y.z>`，它一次完成三件事：改 `package.json`、生成 commit、打 tag。CI 不自己拼这三步。

**起始版本统一为 `0.1.0`**，以 manifest 里的为准；`package.json` 的 `1.0.0` 是 `npm init` 的默认值，没有语义。首个 Release 即 `v0.1.0`。

## 5. 打包脚本

打包逻辑放在 `scripts/package.mjs`，通过 `npm run package` 调用。**不写在 workflow 的 shell 步骤里。**

理由：CI 上打包失败时，日志是唯一线索。做成脚本后本地能打出内容一致的 zip，排查不依赖 CI。（zip 会把文件 mtime 写进包里，所以做不到字节一致，也不需要。）

脚本遵循 `scripts/gen-icons.mjs` 的既有形态：纯 `.mjs`、顶层直接执行、不写单元测试。验证方式是真的跑一遍再看 zip 内容。

脚本职责（只做这些）：

1. 读 `package.json` 的 `version`
2. 断言 `dist/` 存在且含 `manifest.json`，且其中的 `version` 等于 `package.json` 的 —— 防止拿着上一次构建的陈旧产物打包
3. 把 `INSTALL.md` 复制进 `dist/`
4. 把 `dist/` 的内容压成 `xhs-archiver-<version>.zip`，放在仓库根

脚本不调用 `vite build`。构建与打包分开，失败时能一眼看出是哪一步。

## 6. workflow

文件：`.github/workflows/release.yml`

**触发：** `workflow_dispatch`，一个必填输入 `version`（形如 `0.2.0`，不带 `v` 前缀）。

**权限：** `permissions: { contents: write }`，用内置 `GITHUB_TOKEN`。不需要配置任何 secret。

**并发：** `concurrency: { group: release, cancel-in-progress: false }`。防止重复点击并发跑出两个 tag。

**运行环境：** `ubuntu-latest`，Node 22（与本地开发环境的 22.18 一致），`actions/setup-node` 带 npm 缓存。

### 6.1 步骤顺序

不可逆的动作尽量靠后。第 8 步之前的任何失败都只污染 CI 的临时工作区，仓库零影响。

| # | 步骤 | 失败意味着 |
|---|---|---|
| 1 | 校验 `version` 匹配 `^\d+\.\d+\.\d+$`，且 tag `v<version>` 在远端不存在 | 输入写错或版本号重复，早失败 |
| 2 | `npm ci` | 依赖问题 |
| 3 | `npm test` | 测试没过，不该发 |
| 4 | `npx tsc --noEmit` | 类型错误。`vite build` 不做类型检查，这一步不可省 |
| 5 | 改版本号 + commit + tag（见 §6.2） | — |
| 6 | `npm run build` | manifest 此时才拿到新版本号 |
| 7 | `npm run package` | 产出 zip |
| 8 | `git push --follow-tags` | **第一个不可逆动作** |
| 9 | `gh release create v<version> <zip>` | 见 §6.3 |

### 6.2 第 5 步不能直接用 `npm version <v>`

`npm version` 在目标版本与当前版本相同时会报 `Version not changed` 并退出。而**首个 Release 恰好撞上这个情形**：仓库里已经是 `0.1.0`（见 §4），要发的也是 `v0.1.0`。

所以拆成「改文件」与「打 tag」两件事，版本号已经对的时候只打 tag：

```bash
CURRENT=$(node -p "require('./package.json').version")
if [ "$CURRENT" != "$VERSION" ]; then
  # --no-git-tag-version：只改 package.json 与 package-lock.json，不代劳 commit/tag
  npm version "$VERSION" --no-git-tag-version
  git commit -am "chore: release v$VERSION"
fi
# 必须是 -a（带注解），不能是轻量标签。
git tag -a "v$VERSION" -m "v$VERSION"
```

顺带的好处是 tag 名与 commit message 都由我们自己写死，不依赖 `npm version` 的默认格式。

**`-a` 不能省**：第 8 步用的是 `git push --follow-tags`，它只推带注解的标签，轻量标签会被静默跳过。首个 Release 实测踩中过这个坑——版本号没变（本来就是 `0.1.0`），走的是上面 `if` 的 else 分支，没有新 commit 可推；`git tag "v$VERSION"`（轻量标签）配合 `--follow-tags` 直接打出 `Everything up-to-date`，标签从未到达远端，下一步 `gh release create` 才报错「tag exists locally but has not been pushed」。这不是首次发布特有的边界情况：只要某次发布凑巧没有可推的新 commit，就会复现。

### 6.3 为什么用 `gh` 而不是第三方 action

`gh` CLI 在 GitHub runner 上预装，认证靠 `GITHUB_TOKEN` 环境变量。用它就少一个供应链依赖——发布流水线持有仓库写权限，引入的第三方 action 越少越好。

### 6.4 已知的非幂等窗口

第 8 步成功、第 9 步失败时，tag 已经在远端，重跑会卡在第 1 步的 tag 存在性检查上。

补救是手动执行：

```bash
gh release create v<version> xhs-archiver-<version>.zip --title "v<version>"
```

这段说明写进 `release.yml` 的注释里，不要只留在文档中。

### 6.5 分支保护

main 目前没有保护规则。若将来加上，第 8 步的 push 会被拒绝，需要给 `GITHUB_TOKEN` 配 bypass，或改为通过 PR 发布。

## 7. 前置修复：`tsc --noEmit` 当前不通过

实测 `npx tsc --noEmit` 退出码 1，有 8 个错误。**不修的话第一次发布就会卡在质量门上**，所以这是流水线的前置工作，不是附带的顺手改动。

两类：

**（1）File System Access 的权限 API 缺类型声明（5 处）**

`FileSystemDirectoryHandle.queryPermission` / `requestPermission` 与 `window.showDirectoryPicker` 都不在 TS 内置 lib 里，`@types/chrome` 也不提供。命中 `src/core/handle-store.ts`、`src/browser/components/PermissionGate.tsx`、`src/sidepanel/App.tsx`。

修法是加一个 `src/fsa.d.ts` 环境声明，只补项目实际用到的这三个，不整套引入。

**（2）测试文件里的类型断言过窄（3 处）**

`tests/core/browse/row-meta.test.ts` 与 `tests/core/read-store.test.ts` 里 `as Record<string, unknown>` 被 TS 判为「两个类型重叠不足」。改成 `as unknown as Record<string, unknown>`，测试语义不变。

## 8. 需要用户参与的环节

- **创建 GitHub 仓库** —— 已完成，远端目前是空仓库（无任何分支）
- **首次 push main** —— 尚未执行。流水线跑起来的前提
- **触发发布** —— 在 GitHub 的 Actions 页面点 Run workflow 并填版本号。CI 不会自己决定何时发布

## 9. 变更清单

新增：

- `.github/workflows/release.yml`
- `scripts/package.mjs`
- `src/fsa.d.ts`
- `INSTALL.md`
- `tests/manifest-version.test.ts` —— 守住「manifest 版本号 === package.json 版本号」

修改：

- `package.json` —— `version` 改 `0.1.0`，新增 `package` 脚本
- `manifest.config.ts` —— `version` 改为读 `pkg.version`
- `tsconfig.json` —— 加 `resolveJsonModule`
- `.gitignore` —— 加 `xhs-archiver-*.zip`
- `tests/core/browse/row-meta.test.ts`、`tests/core/read-store.test.ts` —— 修类型断言
- `README.md` —— 加「安装」段，指向 Releases
