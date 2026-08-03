# CLAUDE.md

## 现状

小红书笔记归档 Chrome 扩展。**设计与实现计划已完成，代码一行没写。** 仓库里目前只有 `README.md`、本文件和 `docs/`。

**下一步动作：** 执行 `docs/superpowers/plans/2026-08-03-xhs-archiver-v1.md`，从 Task 1 开始。计划是 13 个 TDD 任务，每个都给了完整的测试代码与实现代码，按顺序做即可。用 `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。

## 阅读顺序

1. `README.md` — 项目在做什么，数据长什么样
2. `docs/superpowers/specs/2026-08-03-xhs-archiver-design.md` — **唯一权威设计文档**，有分歧以它为准
3. `docs/superpowers/plans/2026-08-03-xhs-archiver-v1.md` — 逐任务执行

## 实测硬事实

这些是在真实登录页面上验证过的，不要凭直觉改：

- **定位笔记必须用 `note.currentNoteId._value`**（Vue ref）。`noteDetailMap` 里有 `""` 和 `"undefined"` 脏 key，遍历取首个非空 key 会拿到错误数据。
- **只能取 `noteDetailMap[id].note` 子对象**。它的父层 `__INITIAL_STATE__.note` 含 `dep`/`computed` 循环引用，整体不可序列化，穿不过扩展边界。`.note` 本身干净，约 4.4 KB，可 `structuredClone`。
- **`interactInfo` 各字段是字符串**（`"1236"`），不是数字。可能出现 `"1.2万"`、`"10万+"`。
- **`infoList` 里没有原图**。只有 `WB_PRV` 和 `WB_DFT`，都是 1080 宽的派生图。原图须由 `fileId` 构造：`https://sns-img-qc.xhscdn.com/{fileId}`，**不需要任何 token**，CDN 也不校验 Referer。备用 host `https://ci.xiaohongshu.com/{fileId}`，实测字节数完全一致。
- **`fileId` 前缀含 `uhdr` 的笔记，原图是 HEIC**，Chrome 无法解码（`createImageBitmap` 直接失败）。按设计降级到 `WB_DFT`。
- **视频判据是 `note.type === "video"`**。不要用 `videoList`，实测该字段不存在。
- **note 的字段顺序在三种入口下不一致**，所以 `raw` 必须递归排序，否则换个入口重采就是整块 diff。
- **三种入口（独立页 `/explore/{id}`、首页 modal、搜索 modal）走完全相同的代码路径**，URL 形态也相同。

## 已定的决策，不要重开讨论

这些都是权衡过的结果，理由写在设计文档里。如果要改，先读理由：

| 决策 | 别做什么 |
|---|---|
| File System Access API | 不要改用 `chrome.downloads`——它读不回目录，查重就没了 |
| 索引 = 每篇一目录、每人一文件 | 不要合并成单个 `index.json`，那在 Git 里必然冲突 |
| 他人采过则**阻止**采集 | 不要改成"另存一份"。逃生口是手删指针文件，不做 UI 按钮 |
| `partial` 状态**不写指针** | 这是「指针存在 ⟹ 数据完整」不变量的基础，别为了方便破坏它 |
| 不存 `xsec_token` | 它会过期。想回访原帖靠 `note_id` + 作者主页链接 |
| 不采集评论、不采集视频 | 明确排除在 v1 之外 |
| 插件不执行任何 git 命令 | commit/push 由使用者自己做 |

## 工作约定

- **TDD**：先写失败的测试，跑一遍确认它失败，再写最小实现。计划里每个任务都是这个结构。
- **提交粒度**：每个任务结束提交一次，计划里给了 commit message。
- **改了行为就同步改文档**，与代码放在同一个 commit 里。文档滞后于代码是这个项目最容易出的问题——本项目的设计经历过多轮推翻重来（数据源方案、索引结构、图片获取规则都改过），下一个 session 完全依赖文档判断现状，一处不同步就会让人按作废的方案实现。具体来说：
  - 改了数据结构、落盘格式、流程或状态机 → 更新**设计文档**对应章节
  - 在真实页面上发现了新事实，或推翻了已有结论 → 更新**设计文档第 9 节**，并把作废的说法直接删掉而不是留着
  - 完成一个任务、调整了任务顺序或范围 → 勾掉**计划**里的 checkbox，范围变化写清原因
  - 出现了新的「不要重开讨论的决策」或新的实测坑 → 补进**本文件**
  - 对外可见的能力、数据布局或使用方式变了 → 更新 **README**
- **文档冲突时以设计文档为准**，并顺手把其他文档改到一致。
- **核心层不碰 DOM 和 chrome API**。`src/core/` 下所有依赖（fetch、decode、storage）都通过参数注入，因此能在 Node 环境下用 Vitest 跑。碰 `chrome.*` 的代码只应出现在 `src/sidepanel/`、`src/background/`、`src/page/`。
- **FSA 测试用内存 mock**，计划 Task 5 提供了完整实现（`tests/helpers/memory-fs.ts`），不需要真实浏览器。
- 用中文回复；代码注释也用中文，写「为什么」而不是「做了什么」。

## 需要用户参与的环节

这些 agent 做不了，到了要主动说明并请用户操作：

- **选择数据仓库目录** —— `showDirectoryPicker()` 必须由用户手势触发
- **数据仓库的 git init 与 `git lfs install`** —— 插件不执行 git 命令
- **登录小红书** —— 未登录时页面全局变量可能读不到
- **在 `chrome://extensions` 加载 `dist/`** 并做端到端验收（计划 Task 13 有 24 项清单）
