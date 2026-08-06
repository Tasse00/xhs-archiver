# CLAUDE.md

## 现状

小红书笔记归档 Chrome 扩展。**计划里的 13 个任务已全部实现，正在真实页面上做验收。** 已在实测中修掉的问题：笔记定位（见下）、正文夹带话题标签、缺最后编辑时间、采集结果与历史记录混淆、注入失败被误报成读不到全局变量。

验收期间新增的两项（已实现并有测试覆盖，**尚未在真实页面端到端验证**）：

- **随笔记采集评论**，落到同目录的 `comments.json`，配图落 `images/comments/`。只采页面已加载的那部分，见设计文档第 13 节
- **工作日志只记录笔记页上的判定**（`shouldLog`），切标签页、逛非笔记页不再产生条目；相同结论就地合并（`recordLog`），中间态不单独成条
- **侧边栏界面重做**：顶栏（仓库/采集者可点改）+ 可滚动主体 + 固定底部动作区 + 折叠日志，样式集中在 `src/sidepanel/panel.css`（token 化，深浅主题各一套）
- **写入路径要确认一次**（`need_path`，排在采集者 ID 之后），之后常驻底部只读展示；点「修改」进入独立设置页，保存时才持久化
- **他人采过改为可接管**，写入路径默认改为固定的 `collected`（见下方决策表）
- **随笔记采集作者悬浮卡片信息**（简介、关注、粉丝、获赞与收藏），并进 `note.json` 的 `author`；浏览页表格增加粉丝、获赞收藏两列并可排序，详情栏展示完整作者信息与原文链接。设计见 `docs/superpowers/specs/2026-08-06-author-card-design.md`
- **随笔记采集分享链接**（分享面板 →「复制链接」的产出），进 `note.json` 的 `share_url`；浏览页详情栏的原文链接改用它。设计见 `docs/superpowers/specs/2026-08-06-share-link-design.md`

**发布：** 手动在 GitHub Actions 上触发 `Release` workflow 并填版本号，产出挂在 Release 上的 zip（手动加载安装，不上架商店）。版本号唯一来源是 `package.json`，`manifest.config.ts` 从中读取——不要在 manifest 里硬编码版本号。Release 的更新说明由 GitHub 按「上一个 tag 以来合并的 PR」自动汇总，**每个 PR 标题就是发布说明里的一行**，所以标题怎么写有硬性约定，见下方「工作约定」。细节见 `docs/superpowers/specs/2026-08-05-github-actions-release-design.md`。

**下一步动作：** 继续按 `docs/superpowers/plans/2026-08-03-xhs-archiver-v1.md` 的 Task 13 走验收清单（24 项），修实测中暴露的问题；并补验上面两项。

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
- **顶层 try/catch 不要把自身异常标成注入失败**。侧边栏自己的错误用 `panel_error`，否则提示会把人指向「重新加载扩展」这个错误方向。但 `NotAllowedError` 要在这之前单独挑出来，它是权限问题，见下条。
- **FSA 权限会在扩展 origin 的最后一个标签页关闭时被回收**。实测路径：侧边栏 → 打开浏览页 → 关掉浏览页 → 回小红书采集，`getDirectoryHandle` 抛 `NotAllowedError`。侧边栏一直开着也救不了，它不算标签页。所以每个判定周期都要 `hasPermission()` 查一遍，别只在挂载时查；权限没了要进 `need_permission`（一键恢复），退回 `need_root` 就等于让人重选目录。
- **目录被删掉时 FSA 句柄不会失效**。句柄仍在 IndexedDB 里，`queryPermission` 仍是 `granted`，只有真正读写才抛 `NotFoundError`。而 `store.ts` 把 `NotFoundError` 一律解读成「没有这个条目」，所以**「仓库没了」和「仓库是空的」在读路径上完全同形**。必须每个判定周期显式探一次（`rootExists`，取一个条目就停），进 `missing_root`——它跟 `need_permission` 相反，只能重选目录，恢复授权救不了。不探的后果：面板把不存在的仓库显示成「这篇还没人采过」，点采集才在 `writeFile` 里抛，逸出成未捕获的 rejection，进度条卡死。注意遍历类操作（`listEntries`/`listDir`）不吞 `NotFoundError`，会一路抛上来。
- **`chrome.tabs.onUpdated` 必须过滤**。它在一次导航里触发好几次（`loading`、title、favicon、`complete`），而且**别的标签页更新也会触发**。不过滤就会并发跑起好几个判定周期：日志刷屏、注入白做好几遍。只认 `tab.active` 且 `info.url` 有值或 `info.status === 'complete'`。
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

作者悬浮卡片（同样是登录页实测）：

- **卡片数据来自 `GET /api/sns/web/v1/user/hover_card`**，需要签名，裸 fetch 是 406。`xsec_token` 就是 `raw.user.xsecToken`。
- **合成事件可以让页面自己去请求**，但必须对 `document` 到目标元素的**整条祖先链**逐层派发不冒泡的 `pointerenter`/`mouseenter`。只派发目标元素及其两三层父节点，卡片不弹、请求也不发——这条踩过，别再试一遍。
- **触发元素是 `.author-container span.username`**。页面底部的 `.author-wrapper > a.author` 不是它。
- **收卡片时 leave 系列必须带 `relatedTarget`**，并对那个元素再派发一整套 enter。只派发 leave 收不掉，卡片会一直挂在使用者眼前。
- **响应体里没有 userId**，身份只能从请求 URL 的 `target_user_id` 取，必须与 `note.user.userId` 比对。
- **页面对 hover_card 有客户端缓存**，同一作者第二次 hover 不再发请求。所以必须有 DOM 兜底（`.tooltip-content` 下的 `.basic-info .name`、`.desc`、`.interaction-info a.interaction`），否则「自己先看过一眼的作者反而采不到」。
- **不要走作者主页 SSR**。`user/profile/{id}` 的 HTML 里有同样的数据且不需要签名，但有会话级频控降级：一分钟内请求几次，数字就从 `384` 变成 `10+`，且**真实导航过去看到的也是 `10+`**，等于污染使用者自己的浏览体验。
- **计数可能是「10万+」「1千+」**，`parseCount` 给出的不是真值，所以要留 `counts_raw` 与 `approximate`。

分享链接（同样是登录页实测）：

- **不带 `xsec_token` 的 `/explore/{id}` 已经 404**（`error_code=300031 当前笔记暂时无法浏览`）。所以 `note.json` 里的 `url` 字段点不开，回访原帖必须靠带 token 的分享链接。这条推翻了原先「回访靠 `note_id` + 作者主页链接」的说法。
- **「复制链接」写进剪贴板的是一整段口令文案**，不是纯 URL：`61 【标题 - 作者 | 小红书…】 😆 <URL>`。开头的数字是分享码，来自面板首次打开时发的 `POST /api/sns/web/share/code`（要签名），同一篇再开面板不再请求。
- **分享按钮是 `.buttons.engage-bar-style .share-wrapper svg`**。只写 `.engage-bar .share-wrapper` 会命中 modal 背后信息流卡片上的分享图标——页面上存在两套 `engage-bar`。
- **只能对 svg 一层派发 click**。对 `.share-wrapper` / `.share-icon-container` / `svg` 三层都派发会连续 toggle 三次，净结果是面板关着，现象看起来像「合成事件对这个组件无效」。这条踩过，别再试一遍。
- **分享面板不需要 hover 祖先链**，与作者卡片相反，一次 click 就够。
- **点完「复制链接」面板不会自动关**，必须再点一次 svg 才收起。
- **`xsec_token` 每次签发都不同**：同一篇从首页 feed 进和从作者主页进拿到的不是同一个值（都是 46 字符）。但跨来源可用——feed 签发的 token 放进 `xsec_source=pc_share` 的分享链接里照常打开。
- **本地拼分享 URL 是可行的但被否决**：除 token 外三个参数都是常量（`source=webshare`、`xhsshare=pc_web`、`xsec_source=pc_share`），token 就是 `raw.xsecToken`，拼出来实测能打开。不这么做是因为 `share/code` 是服务端接口，绕过它等于对平台语义做未经验证的假设。

## 已定的决策，不要重开讨论

这些都是权衡过的结果，理由写在设计文档里。如果要改，先读理由：

| 决策 | 别做什么 |
|---|---|
| File System Access API | 不要改用 `chrome.downloads`——它读不回目录，查重就没了 |
| 索引 = 每篇一目录、每人一文件 | 不要合并成单个 `index.json`，那在 Git 里必然冲突 |
| 他人采过可**接管**（更新/迁移，动作与自己采过完全相同） | 不要改成"另存一份"。接管必须删掉对方的指针（`supersede`），且删在写自己那条之后 |
| 默认写入路径固定为 `collected`，不自动拼日期、不按采集者分目录 | 日期可作为手动设置的二级路径，例如 `collected/2026-08-04`。归属记在指针文件名与 `note.json` 里，不要把采集者 ID 放回路径 |
| `partial` 状态**不写指针** | 这是「指针存在 ⟹ 数据完整」不变量的基础，别为了方便破坏它 |
| 顶层 `url` 不带 `xsec_token`，带 token 的地址单独放 `share_url` | 不要把 token 拼进 `url`——它是笔记的稳定身份。也不要因此以为仓库里没有 token：`raw` 里一直有 |
| 评论只采页面**已加载**的那部分 | 不要为了采全去滚页面、点展开、或构造签名请求。理由见设计文档 13.1 |
| 评论不留 `raw`（与 note 相反） | 里面的 `xsecToken` 会过期、`liked` 与采集者绑定，只会污染 diff |
| 评论配图失败**不**影响归档状态 | 不要把它算进 `partial`——那会因为一张配图丢掉整篇的指针 |
| 不采集视频 | 明确排除在 v1 之外 |
| 插件不执行任何 git 命令 | commit/push 由使用者自己做 |
| 作者卡片靠合成事件让页面自己请求 | 不要裸 fetch（406）、不要加签、不要用 `chrome.debugger` |
| 作者字段并入 `note.json` 的 `author` | 不要为它单开 `author.json` |
| 没采到就一个卡片字段都不写；DOM 兜底时省略 `verify_type` | 不要写 `fans: 0`、`verify_type: 0` 占位 |
| 作者信息采不到不阻断归档 | 不要把它算进 `partial` |
| 分享链接靠合成事件让页面自己走完流程 | 不要本地拼 URL——拼得出来，但那是对平台语义的未验证假设 |
| 剪贴板拦截而不真写 | 不要让一次采集覆盖使用者当前的剪贴板内容 |
| 分享面板由谁开由谁关 | 使用者自己点开的面板不要动；不要「一律关掉」 |
| 分享链接采不到不阻断归档 | 不要把它算进 `partial`，也不要写空串占位 |

## 工作约定

- **TDD**：先写失败的测试，跑一遍确认它失败，再写最小实现。计划里每个任务都是这个结构。
- **提交粒度**：每个任务结束提交一次，计划里给了 commit message。
- **所有改动经 PR 合并进 main，不直接往 main push**（唯一例外是发布流水线自己推的版本号 commit）。合并方式不限，怎么方便怎么来——Release 的更新说明认的是 PR 本身，不是 commit 形态。PR 标题与正文的格式要求见下方「PR 标题与正文」。
- **改了行为就同步改文档**，与代码放在同一个 commit 里。本项目的设计经历过多轮推翻重来（数据源方案、索引结构、图片获取规则都改过），下一个 session 完全依赖文档判断现状，一处不同步就会让人按作废的方案实现。推翻某个结论时把旧说法直接删掉，不要留着。文档之间冲突以设计文档为准。
- **核心层不碰 DOM 和 chrome API**。`src/core/` 下所有依赖（fetch、decode、storage）都通过参数注入，因此能在 Node 环境下用 Vitest 跑。碰 `chrome.*` 的代码只应出现在 `src/sidepanel/`、`src/background/`、`src/page/`。
- **FSA 测试用内存 mock**，计划 Task 5 提供了完整实现（`tests/helpers/memory-fs.ts`），不需要真实浏览器。
- 用中文回复；代码注释也用中文，写「为什么」而不是「做了什么」。

### PR 标题与正文

Release 的更新说明是 GitHub 按「上一个 tag 以来合并的 PR」汇总出来的，一个 PR 一行，内容就是 PR 标题。**所以 PR 标题是写给使用者看的发布说明，不是给自己看的备忘。**

**标题格式**：`<type>: <这次改动让什么变得不一样>`，中文，不带句号，控制在 50 字以内。`type` 沿用仓库现有 commit 的取值：`feat` / `fix` / `refactor` / `docs` / `chore` / `test`。

写「多了什么能力、修好了什么毛病」，不要写「动了哪个文件、改了哪个函数」——读的人没有代码上下文：

- ✅ `feat: 随笔记采集作者的粉丝与获赞数`
- ✅ `fix: 目录被删后面板不再把仓库显示成空的`
- ❌ `feat: 增加 author-card.ts`（读的人不知道这是什么）
- ❌ `fix: 修复 bug`（等于没说）

**正文结构**：四段，缺一段就说明这个 PR 还没想清楚。目的是让半年后的人（包括下一个 session 的 agent）只读 PR 就能还原来龙去脉，不必去翻 diff 猜动机。

```markdown
## 为什么
起因是什么、原来的行为哪里不对。是实测发现的就写清复现路径。

## 怎么做
选的方案，以及**为什么不选另一个**。踩过的坑、试过但行不通的路子写在这里——
这些不写进代码注释就会丢，下一个人会原样再踩一遍。

## 改了什么
按文件或模块列关键改动，一条一句。不必逐行复述 diff，但读完要能知道
去哪儿找。涉及数据格式或落盘结构的变化必须点名。

## 怎么验证的
跑了哪些测试、结果如何；有没有在真实页面上验过、验的是哪一条。
没验的部分明写「未验证」，不要含糊过去。
```

正文里的结论如果是长期有效的（实测硬事实、被推翻的方案），**同时**写进本文件或设计文档——PR 正文没人会回头翻，只有这两个文件是每个 session 都读的。

## 需要用户参与的环节

这些 agent 做不了，到了要主动说明并请用户操作：

- **选择数据仓库目录** —— `showDirectoryPicker()` 必须由用户手势触发
- **数据仓库的 git init 与 `git lfs install`** —— 插件不执行 git 命令
- **登录小红书** —— 未登录时页面全局变量可能读不到
- **在 `chrome://extensions` 加载 `dist/`** 并做端到端验收（计划 Task 13 有 24 项清单）
