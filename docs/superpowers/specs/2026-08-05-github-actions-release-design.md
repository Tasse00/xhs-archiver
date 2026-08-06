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
| 9 | 生成更新说明并 `gh release create v<version> <zip>` | 见 §6.3、§6.6 |

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

补救是手动执行（`generate-notes` 那一步不能省，否则 Release 正文就只剩安装说明）：

```bash
gh api --method POST "repos/<owner>/<repo>/releases/generate-notes" \
  -f tag_name="v<version>" -q .body > notes.md
gh release create v<version> xhs-archiver-<version>.zip \
  --title "v<version>" --notes-file notes.md
```

这段说明写进 `release.yml` 的注释里，不要只留在文档中。

### 6.5 分支保护

main 目前没有保护规则，但开发流程上已约定改动一律经 PR 进 main（见 §8）。**只有发布流水线的第 8 步是例外**：它把 `chore: release v<version>` 这个版本号 commit 直接推到 main。

若将来给 main 加上「必须经 PR」的保护规则，这一步会被拒绝。届时的选项是：给 `GITHUB_TOKEN` 配 bypass，或让流水线开一个 PR 来推版本号 commit。后者会把「打 tag」与「合并」拆成两个不同步的时刻，`v<version>` 会指向一个还没进 main 的 commit——真要走这条路，得先重排 §6.1 的步骤顺序，不是加个 PR 就完事。

### 6.6 更新说明由 PR 汇总生成

Release 正文 = 一段固定的安装提示 + GitHub 生成的变更列表。

变更列表来自 `POST /repos/{owner}/{repo}/releases/generate-notes`，它列出**上一个 tag 到本 tag 之间合并的每个 PR**，一行一个，内容就是 PR 标题加作者加 PR 链接。所以：

**PR 标题是直接面向使用者的发布说明，不是给自己看的备忘。** 标题写砸了，Release 页上就是一行看不懂的字。格式约定在 `CLAUDE.md` 的「工作约定」里。

几个实现上的决定：

- **用 `gh api ... generate-notes` 而不是 `gh release create --generate-notes`。** 后者只能把生成的列表接在 `--notes` 后面，而安装提示得排在最前面——装不上的人最需要先看到它。显式取回正文就能自己定拼接顺序。
- **这一步必须排在 tag 推送之后。** `generate-notes` 要求 `tag_name` 已经在远端存在。
- **不加 `.github/release.yml` 做分组。** GitHub 的分类只认 label，而这是单人仓库，为了分组去逐个 PR 打 label 不划算。PR 标题的 `feat:` / `fix:` 前缀本身已经起到了分类作用。
- **不引入 changelog 生成类的第三方 action。** 理由同 §6.3。

代价是第 9 步多了一次 API 调用，多一个失败点，且落在 §6.4 那个不可逆窗口里。补救命令已相应更新。

## 7. 前置修复：`tsc --noEmit` 当前不通过

实测 `npx tsc --noEmit` 退出码 1，有 8 个错误。**不修的话第一次发布就会卡在质量门上**，所以这是流水线的前置工作，不是附带的顺手改动。

两类：

**（1）File System Access 的权限 API 缺类型声明（5 处）**

`FileSystemDirectoryHandle.queryPermission` / `requestPermission` 与 `window.showDirectoryPicker` 都不在 TS 内置 lib 里，`@types/chrome` 也不提供。命中 `src/core/handle-store.ts`、`src/browser/components/PermissionGate.tsx`、`src/sidepanel/App.tsx`。

修法是加一个 `src/fsa.d.ts` 环境声明，只补项目实际用到的这三个，不整套引入。

**（2）测试文件里的类型断言过窄（3 处）**

`tests/core/browse/row-meta.test.ts` 与 `tests/core/read-store.test.ts` 里 `as Record<string, unknown>` 被 TS 判为「两个类型重叠不足」。改成 `as unknown as Record<string, unknown>`，测试语义不变。

## 8. 开发流程：改动经 PR 进 main

**所有代码改动都通过 PR 合并进 main，不直接往 main push。** 唯一例外是发布流水线自己推的版本号 commit（见 §6.5）。

这条约定不是为了走流程，而是因为 §6.6 把 PR 标题变成了发布说明的正文——不开 PR 的改动，在 Release 页上就是不存在的改动。

**合并方式不作限制**（squash / merge commit / rebase 都行）。`generate-notes` 认的是「这个区间里合并过哪些 PR」，三种方式 GitHub 都能关联回 PR，变更列表不受影响。强制某一种只是给自己添麻烦。

**PR 标题格式与正文结构的完整约定写在 `CLAUDE.md` 的「工作约定」段**，不在这里重复——那是每个 session 都会读到的文件，写在这里等于没写。

## 9. 需要用户参与的环节

- **创建 GitHub 仓库、首次 push main** —— 已完成
- **首个 Release** —— 已完成，远端有 `v0.1.0`
- **触发发布** —— 在 GitHub 的 Actions 页面点 Run workflow 并填版本号。CI 不会自己决定何时发布

## 10. 变更清单

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
