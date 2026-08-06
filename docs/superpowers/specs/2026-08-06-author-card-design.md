# 作者悬浮卡片信息采集 —— 设计

日期：2026-08-06

本文是 `2026-08-03-xhs-archiver-design.md` 的补充，只覆盖「随笔记采集作者信息」这一件事。
与主设计文档冲突时，本文在作者信息这个范围内为准，其余一律以主设计文档为准。

## 1. 目标

采集笔记时一并记录作者的**简介、关注数、粉丝数、获赞与收藏数**——也就是在笔记页把鼠标
悬浮到作者头像/昵称上时，那张卡片里显示的全部内容。

配套两处界面改动：

- sidepanel 要如实体现作者信息的采集状态与采集结果
- 浏览页表格增加粉丝、获赞与收藏两列（可排序），详情栏展示完整作者信息
- 浏览页详情栏补一个小红书原文链接（新标签页打开）

## 2. 数据来源（真实登录页面实测）

### 2.1 卡片数据来自 hover_card 接口

鼠标悬浮作者时，页面发出：

```
GET https://edith.xiaohongshu.com/api/sns/web/v1/user/hover_card
    ?target_user_id={userId}&image_formats=jpg,webp,avif
    &xsec_source=pc_note&xsec_token={user.xsecToken}
```

`xsec_token` 就是已采到的 `raw.user.xsecToken`，不必额外寻找。

响应体：

```json
{ "code": 0, "success": true, "msg": "成功",
  "data": {
    "basic_info":  { "nickname": "…", "images": "https://sns-avatar-qc…", "desc": "…" },
    "verify_info": { "red_official_verify_type": 0 },
    "interact_info": { "follows": "0", "fans": "138", "interaction": "3021" },
    "extraInfo_info": { "fstatus": "none", "block_type": "DEFAULT" },
    "notes": [ { "xsec_token": "…", "note_id": "…", "type": "normal", "cover": … } ]
  } }
```

**`data` 里没有 userId。** 身份只能从请求 URL 的 `target_user_id` 取。

`interact_info` 三个值都是字符串，与 `interactInfo` 一样可能出现 `"1.2万"`、`"10万+"`。

### 2.2 扩展不能自己发这个请求

裸 `fetch` 返回 **406** `{"code":-1,"success":false}`，与评论接口同一堵签名墙。
按已定决策不借页面的 `_webmsxyw` 加签——那是拿使用者的账号跟风控对撞。

### 2.3 合成事件可以触发页面自己去请求，但必须派发整条祖先链

页面顶部作者栏的 DOM 是：

```
DIV.author-container > A.name > SPAN.username
```

（注意：底部 footer 里另有一个 `DIV.author-wrapper > A.author`，那**不是**悬浮卡片的触发元素。）

只对目标元素及其两三层父节点派发 `pointerenter`/`mouseenter` **不起作用**，实测卡片不弹、
请求不发。必须对 `document` 到目标元素的**整条祖先链**（实测 16 层）逐层派发不冒泡的
`pointerenter` 与 `mouseenter`，配合在目标元素上派发冒泡的 `pointerover`/`mouseover`/
`pointermove`/`mousemove`。这样做之后，真实鼠标停在屏幕另一侧也能弹出卡片并发出请求。

因此**不需要** `chrome.debugger` 的 `Input.dispatchMouseEvent`（那会在浏览器顶部常驻一条
调试横幅），也**不需要**使用者手动 hover。

### 2.4 收起卡片必须带 relatedTarget

只派发 `pointerout`/`mouseout` 与 leave 链，卡片**收不回去**。必须：

1. leave 系列事件带 `relatedTarget` 指向目标之外的元素（如 `document.body`）
2. 再对那个元素派发一整套 enter 链，让组件认为指针已经移走

实测这样卡片会干净消失。

### 2.5 hover_card 有客户端缓存

同一作者第二次 hover **不再发请求**，卡片直接用缓存渲染。所以「使用者自己先看过一眼，
再点采集」这条路径上，网络钩子什么也抓不到。必须有 DOM 兜底，否则会出现「手动看过的
作者反而采不到」这种反直觉的 bug。

### 2.6 被否决的方案：作者主页 SSR

`https://www.xiaohongshu.com/user/profile/{userId}` 的 HTML 里，
`__INITIAL_STATE__.user.userPageData` 带着同样的字段（还多出 redId、gender、ipLocation、
认证 tags），且是普通文档请求，**不需要签名、连 `xsec_token` 都不用带**。

但它有频控降级，实测记录：

| 时机 | 关注 | 粉丝 | 获赞与收藏 |
|---|---|---|---|
| 前两次请求 | 21 | 384 | 1498 |
| 一分钟内第四次起 | 10+ | 10+ | 1千+ |

降级是会话/账号级的——降级期间**真实导航**到该主页，页面上显示的也是 `10+`。
同一时刻 hover 卡片仍然精确，说明 `hover_card` 不受这套降级影响。

**结论：不走主页。** 这条路会污染使用者自己的浏览体验，而 hover 方案的请求量与使用者
真实 hover 一次完全相同。

## 3. 落盘结构

字段并入 `note.json` 现有的 `author` 对象，**不新建文件**。

理由：`note.json` 里已经有 `interact`（赞/藏/评/享）和 `archive.last_archived_at` 这类时变
数据，重采本来就会产生 diff，粉丝数不引入新的问题类别。合并的收益是少一个文件、浏览页
扫描零额外读盘、`RowMeta` 直接取用。

```json
"author": {
  "user_id": "69eff1470000000002001803",
  "nickname": "不会coding的开发",
  "avatar_url": "https://sns-avatar-qc.xhscdn.com/avatar/…",
  "profile_url": "https://www.xiaohongshu.com/user/profile/69eff147…",

  "desc": "nineone1996@163.com\nagent/data/术数/自媒体/流量/电商\n相关领域都欢迎跟我讨论🥹",
  "verify_type": 0,
  "follows": 21,
  "fans": 384,
  "interaction": 1500,
  "counts_raw": { "follows": "21", "fans": "384", "interaction": "1500" },
  "approximate": false,
  "card_fetched_at": "2026-08-06T14:32:10+08:00"
}
```

前 4 个是现有字段，后 8 个为新增。规则：

- **卡片没抓到时，8 个新字段一个都不写**，`author` 保持原样。`card_fetched_at` 存在与否就是
  「有没有采到作者信息」的判据。绝不写 `fans: 0` 这种假值。
- **走 DOM 兜底时省略 `verify_type`**（DOM 上读不到认证类型），其余 7 个照写。
  同样绝不写 `verify_type: 0` 占位——那会让「未认证」与「不知道」变得无法区分。
- **`counts_raw` 与 `approximate` 都要留。** 大号返回 `"10万+"` 时 `parseCount` 只能给出
  100000，那不是真值。任一字段含 `+`、`万`、`千`、`亿` 时 `approximate` 为 `true`。
- **不存 `extraInfo_info.fstatus`**（「当前账号有没有关注 ta」，与采集者绑定）
  **和 `notes` 数组**（含会过期的 `xsec_token`）。同「评论不留 raw」那条决策。
- **不存 raw**：卡片字段少而稳，留 raw 只会带进 token 与账号相关字段。

`serializeNote` 保持固定 key 顺序，新字段按上面的顺序排在原有 4 个之后；没抓到时整段省略。

## 4. 页面读取：`src/page/read-author.ts`

注入 MAIN world，一次调用完成「弹卡片 → 接数据 → 收卡片」。

```ts
readAuthorCardFromPage(expectedUserId: string): AuthorReadResult
readAuthorViaTab(tabId: number, expectedUserId: string): Promise<AuthorReadResult>
```

步骤：

1. 装 XHR + fetch 钩子，只认 URL 含 `hover_card` 的响应，同时从 URL 正则取 `target_user_id`
2. `document.querySelector('.author-container span.username')`
3. 对整条祖先链派发 enter 系列（见 §2.3）
4. 轮询等响应，最长 **3 秒**
5. 无论成败，派发带 `relatedTarget` 的 leave 链收起卡片（见 §2.4）
6. 钩子没拿到但卡片已弹出时，从 DOM 文本兜底解析（读不到 `verify_type`，该字段省略）
7. 校验 `target_user_id === expectedUserId`，不一致整个丢弃

沿用注入脚本的既有约束：

- **全程 try/catch 且始终返回值。** 抛出去会让 `executeScript` 的 `result` 变成 `undefined`，
  现场信息全丢。
- **回传现场快照**（`AuthorDiag`：找没找到元素、走的钩子还是 DOM、等了多久、拿到的 uid）。
- 函数体会被序列化后在页面上下文运行，**不能引用模块内的任何外部变量**。

失败原因分开报，不要兜成同一个码：

| 原因 | 含义 |
|---|---|
| `no_element` | 页面上找不到作者元素——多半是小红书改版，选择器失效 |
| `timeout` | 3 秒内既没抓到响应，卡片也没弹出来 |
| `uid_mismatch` | 拿到的卡片不属于当前笔记作者（页面中途切了笔记） |
| `page_error` | 页面内抛异常 |
| `inject_failed` | 注入本身没跑成 |

`PointerEvent` 在 jsdom 里支持不完整，实现里做
`typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent` 降级——这在真实页面上
也是有价值的防御。

## 5. 归一化：`src/core/author.ts`

```ts
extractAuthorCard(raw: RawAuthorCard, userId: string, fetchedAt: string): ExtractedAuthorCard | null
```

- 复用 `extractor.ts` 的 `parseCount` 解析三个计数
- `approximate` 由 `counts_raw` 三个字符串是否含 `+ 万 千 亿` 判定
- `basic_info` 缺失或三个计数全缺时返回 `null`（当作没采到，不写半份数据）
- 核心层不碰 DOM 与 chrome API，可在 Node 下用 Vitest 跑

## 6. 采集流程与 sidepanel

只在 `doArchive` 里抓一次。**判定周期绝不抓**——它在每次 tab 更新时都跑，放那儿会导致
使用者每切一次页面卡片就弹一下。

顺序上有个必须避开的坑：`doArchive` 开头的 `ensurePermission(root)` 依赖用户手势，
手势有效期只有几秒。作者抓取要排在 `ensurePermission` 与 `rootExists` **之后**：

```
点采集
 → ensurePermission / rootExists / 路径校验      （原有，顺序不动）
 → 读取作者信息（约 1.5–3 秒，卡片在页面上闪现后自动收起）
 → 下载图片 → 写 note.json → 写 comments.json → 写指针
```

`archive()` 不自己发起读取。作者数据由 sidepanel 抓好后合并进 `ExtractedNote.author` 传入，
核心层保持不碰 chrome API。

**过程中**：`NoteView` 显示一行「正在读取作者信息…」。它排在图片进度条之前，是独立的一步，
不塞进 `done/total`——那个分母是图片数，混进去会让进度条的含义变浑。

**结果**：`ArchiveOutcome` 增加 `author` 字段。

- 成功：`作者信息 · 384 粉丝 · 1500 获赞与收藏`，`approximate` 时数字前缀「约」
- 失败：`作者信息未采到：页面上没找到作者元素`，附一句「重采这篇可以再试」

**失败不阻断归档**，`status` 仍是 `complete`。同「评论配图失败不影响归档状态」那条决策：
附属数据不该把主干拖下水。

**不提供「只补采作者信息」按钮。** 要补就整篇重采。

工作日志（`log.ts`）不为作者抓取单独成条——它只记页面判定，采集动作本来就不进日志。

## 7. 浏览页

### 7.1 表格

`RowMeta` 增加：

```ts
authorFans: number | null;
authorInteraction: number | null;
```

两列紧跟「作者」列，`SortKey` 增加这两个键。

- 老数据（`note.json` 里没有 `card_fetched_at`）显示 `—`
- 排序时 `null` **沉到末尾**，与现有「缺元数据的沉到末尾」一致：「不知道」不等于「是 0」
- **搜索不动**。把作者简介塞进 `RowMeta` 会让它常驻内存，收益不值当

### 7.2 详情栏

增加作者块：昵称、简介、`21 关注 / 384 粉丝 / 1500 获赞与收藏`、采集时间。
`approximate` 时数字标注「约」。没有卡片数据时只显示昵称，与现状一致。

### 7.3 原文链接

`NoteDetail.url` 已有值，只是没渲染。在标题下方加：

- 小红书原文：`<a href={detail.url} target="_blank" rel="noreferrer">`
- 作者主页：`detail.author.profile_url`，同样新标签页打开

## 8. 测试

按项目 TDD 约定，每个任务先写失败的测试、跑一遍确认失败，再写最小实现。

| 层 | 环境 | 测什么 |
|---|---|---|
| `core/author.ts` | node | 归一化；`"10万+"` → `approximate: true`；缺字段返回 `null` |
| `core/serialize.ts` | node | 新字段固定 key 顺序；**没抓到时 7 个字段一个都不写** |
| `page/read-author.ts` | jsdom | 找到/找不到元素；祖先链派发（监听器断言）；钩子抓取；DOM 兜底；uid 不符丢弃；超时；leave 一定被派发 |
| `core/browse/row-meta.ts` | node | 读出新字段；老 `note.json` 得到 `null` |
| `core/browse/scope.ts` | node | 新排序键；`null` 沉底 |
| `browser/DetailPane` | SSR 断言 | 作者块渲染；两个链接的 `href`/`target` |

jsdom 已是依赖，给单个测试文件加 `// @vitest-environment jsdom` docblock 即可，
不改 `vitest.config.ts`。

## 9. 真机验收（agent 做不了，需使用者操作）

1. 独立页 `/explore/{id}` 采一篇，确认 `note.json` 有 8 个新字段
2. 首页 modal 采一篇
3. **搜索页 modal 采一篇**——这个入口的 DOM 结构尚未验证过
4. 先手动 hover 过作者再点采集，验证 DOM 兜底路径（§2.5）
5. 采集后确认卡片自动收起，页面无残留
6. 采一个粉丝数很大的作者，确认 `approximate` 与 `counts_raw` 的行为
7. 浏览页：两列显示、排序、`null` 沉底、详情栏作者块、两个链接能新标签页打开
8. 老数据在浏览页显示 `—` 而不是 0

## 10. 本次新增的决策

| 决策 | 别做什么 |
|---|---|
| 作者数据靠合成事件触发页面自己请求 | 不要裸 fetch（406）、不要加签、不要用 `chrome.debugger` |
| 合成事件必须派发整条祖先链 | 只派发目标元素及其两三层父节点是无效的，别再试一遍 |
| 收卡片必须带 `relatedTarget` | 光派发 leave 链收不掉 |
| 不走作者主页 SSR | 有会话级频控降级，会把使用者自己看到的数字也变成 `10+` |
| 字段并入 `note.json`，不新建文件 | 不要为它单开 `author.json` |
| 没采到就一个新字段都不写；DOM 兜底时省略 `verify_type` | 不要写 `fans: 0`、`verify_type: 0` 占位 |
| 采不到不阻断归档 | 不要把它算进 `partial` |
| 不提供「只补采作者」按钮 | 要补就整篇重采 |
