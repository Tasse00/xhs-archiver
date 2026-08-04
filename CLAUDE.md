# CLAUDE.md

## 现状

小红书笔记归档 Chrome 扩展。**计划里的 13 个任务已全部实现，正在真实页面上做验收。** 已在实测中修掉的问题：笔记定位（见下）、正文夹带话题标签、缺最后编辑时间、采集结果与历史记录混淆、注入失败被误报成读不到全局变量。

验收期间新增（已实现并有测试覆盖，**尚未在真实页面端到端验证**）：**随笔记采集评论**，落到同目录的 `comments.json`，配图落 `images/comments/`。只采页面已加载的那部分，见设计文档第 13 节。

**下一步动作：** 继续按 `docs/superpowers/plans/2026-08-03-xhs-archiver-v1.md` 的 Task 13 走验收清单（24 项），修实测中暴露的问题；并补验评论采集。

## 阅读顺序

1. `README.md` — 项目在做什么，数据长什么样
2. `docs/superpowers/specs/2026-08-03-xhs-archiver-design.md` — **唯一权威设计文档**，有分歧以它为准
3. `docs/superpowers/plans/2026-08-03-xhs-archiver-v1.md` — 实现计划，现只剩验收清单还有用

## 实测硬事实

这些是在真实登录页面上验证过的，不要凭直觉改：

- **定位笔记用页面自己的 `location.pathname`**。另外两个候选都不可靠：`currentNoteId._value` 会在 modal 关闭后被重置为 `""`；侧边栏的 `tab.url` 会滞后于 SPA 实际地址，关掉 modal 后还带着上一篇的 id。`tab.url` 只用来判域名，`currentNoteId` 只作兜底。
- **注入脚本必须全程 try/catch 且始终返回值**，并回传现场快照（pathname / urlId / currentNoteId / mapKeys / 是否命中）。抛出去会让 `result` 变成 `undefined`，现场就全丢了。Chrome 把页面内异常放在 `InjectionResult.error` 里。
- **取数据用 `JSON.parse(JSON.stringify(note))`，不要用 `structuredClone`**。后者的产物不一定能跨扩展边界，实测出现过传回时丢失、调用方只拿到 `undefined`。落盘本来就是 JSON。
- **`noteDetailMap[id]` 是异步填充的**，点开 modal 瞬间可能不存在或只有半份字段。归一化必须校验 `noteId`/`time`/`user.userId`/`imageList`，缺就返回 `missing_data`。`time` 缺失时 `toBeijingIso` 抛 `RangeError: Invalid time value`，不校验就会一路冒泡到面板顶层。
- **顶层 try/catch 不要把自身异常标成注入失败**。侧边栏自己的错误用 `panel_error`，否则提示会把人指向「重新加载扩展」这个错误方向。
- **不能遍历 `noteDetailMap` 取首个非空 key**：里面有 `""` 和 `"undefined"` 脏 key，会拿到错误数据。必须用精确 id 索引。
- **`desc` 里会重复一遍话题标签**（`#名字[话题]#`，可连写，截断时剩一个孤立 `#`）。落盘的 `content` 要剔掉，`tags` 取自 `tagList`。原文保留在 `raw.desc`。
- **`lastUpdateTime` 就是页面上「编辑于 …」的时间**，毫秒时间戳，归档为 `last_edited_at`。
- **只能取 `noteDetailMap[id].note` 子对象**。它的父层 `__INITIAL_STATE__.note` 含 `dep`/`computed` 循环引用，整体不可序列化，穿不过扩展边界。`.note` 本身干净，约 4.4 KB，可 `structuredClone`。
- **`interactInfo` 各字段是字符串**（`"1236"`），不是数字。可能出现 `"1.2万"`、`"10万+"`。
- **`infoList` 里没有原图**。只有 `WB_PRV` 和 `WB_DFT`，都是 1080 宽的派生图。原图须由 `fileId` 构造：`https://sns-img-qc.xhscdn.com/{fileId}`，**不需要任何 token**，CDN 也不校验 Referer。备用 host `https://ci.xiaohongshu.com/{fileId}`，实测字节数完全一致。
- **`fileId` 前缀含 `uhdr` 的笔记，原图是 HEIC**，Chrome 无法解码（`createImageBitmap` 直接失败）。按设计降级到 `WB_DFT`。
- **视频判据是 `note.type === "video"`**。不要用 `videoList`，实测该字段不存在。
- **note 的字段顺序在三种入口下不一致**，所以 `raw` 必须递归排序，否则换个入口重采就是整块 diff。
- **三种入口（独立页 `/explore/{id}`、首页 modal、搜索 modal）走完全相同的代码路径**，URL 形态也相同。

评论相关（同样是登录页实测）：

- **评论在 `noteDetailMap[id].comments`**，与 `note` 同级，形如 `{list, cursor, hasMore, loading, firstRequestFinish}`。与 note 同一次注入取回，别拆成两次——中间页面可能已经换了笔记。
- **首屏只有 10 条主评论，每条有回复的只预载 1 条回复。** 所以「只采已加载的」默认约 10~20 条，一篇 96 条评论的笔记差得很远。这个差额必须显示在 UI 上。
- **不要去构造评论 API 请求。** 裸 fetch 是 406；借页面的 `_webmsxyw` 加签能过签名，但服务端回 `300011 当前账号存在异常`。再往下就是拿使用者的账号跟风控对撞。
- **不要自动滚动或点「展开 N 条回复」。** 技术上跑得通（实测滚 4 轮 + 点 3 轮把 96 条全拿到了），但那是在用户眼皮底下操作他正在看的页面。这条是明确决策，不是没想到。
- **`主评论数 + Σ子评论数` 精确等于 `interactInfo.commentCount`**（实测 96/96），可直接用作 `complete` 判据。
- **`subCommentHasMore` 加载完后不会重置为 false**，不能拿它判断「是否还有回复没加载」。
- **评论图没有 `fileId`**，按笔记原图规则构造的地址一律 404。只有 `WB_DFT`/`WB_PRV`，且 url 是 `http://`，要升 https。
- **评论图的声明尺寸是展示尺寸**（284×367 的图实际 556×717），拿它做尺寸校验会让评论图全数失败。

## 已定的决策，不要重开讨论

这些都是权衡过的结果，理由写在设计文档里。如果要改，先读理由：

| 决策 | 别做什么 |
|---|---|
| File System Access API | 不要改用 `chrome.downloads`——它读不回目录，查重就没了 |
| 索引 = 每篇一目录、每人一文件 | 不要合并成单个 `index.json`，那在 Git 里必然冲突 |
| 他人采过则**阻止**采集 | 不要改成"另存一份"。逃生口是手删指针文件，不做 UI 按钮 |
| `partial` 状态**不写指针** | 这是「指针存在 ⟹ 数据完整」不变量的基础，别为了方便破坏它 |
| 不存 `xsec_token` | 它会过期。想回访原帖靠 `note_id` + 作者主页链接 |
| 评论只采页面**已加载**的那部分 | 不要为了采全去滚页面、点展开、或构造签名请求。理由见设计文档 13.1 |
| 评论不留 `raw`（与 note 相反） | 里面的 `xsecToken` 会过期、`liked` 与采集者绑定，只会污染 diff |
| 评论配图失败**不**影响归档状态 | 不要把它算进 `partial`——那会因为一张配图丢掉整篇的指针 |
| 不采集视频 | 明确排除在 v1 之外 |
| 插件不执行任何 git 命令 | commit/push 由使用者自己做 |

## 工作约定

- **TDD**：先写失败的测试，跑一遍确认它失败，再写最小实现。计划里每个任务都是这个结构。
- **提交粒度**：每个任务结束提交一次，计划里给了 commit message。
- **改了行为就同步改文档**，与代码放在同一个 commit 里。本项目的设计经历过多轮推翻重来（数据源方案、索引结构、图片获取规则都改过），下一个 session 完全依赖文档判断现状，一处不同步就会让人按作废的方案实现。推翻某个结论时把旧说法直接删掉，不要留着。文档之间冲突以设计文档为准。
- **核心层不碰 DOM 和 chrome API**。`src/core/` 下所有依赖（fetch、decode、storage）都通过参数注入，因此能在 Node 环境下用 Vitest 跑。碰 `chrome.*` 的代码只应出现在 `src/sidepanel/`、`src/background/`、`src/page/`。
- **FSA 测试用内存 mock**，计划 Task 5 提供了完整实现（`tests/helpers/memory-fs.ts`），不需要真实浏览器。
- 用中文回复；代码注释也用中文，写「为什么」而不是「做了什么」。

## 需要用户参与的环节

这些 agent 做不了，到了要主动说明并请用户操作：

- **选择数据仓库目录** —— `showDirectoryPicker()` 必须由用户手势触发
- **数据仓库的 git init 与 `git lfs install`** —— 插件不执行 git 命令
- **登录小红书** —— 未登录时页面全局变量可能读不到
- **在 `chrome://extensions` 加载 `dist/`** 并做端到端验收（计划 Task 13 有 24 项清单）
