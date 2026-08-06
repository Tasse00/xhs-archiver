# 笔记分享链接采集 —— 设计

日期：2026-08-06

本文是 `2026-08-03-xhs-archiver-design.md` 的补充，只覆盖「随笔记采集分享链接」这一件事。
与主设计文档冲突时，本文在分享链接这个范围内为准，其余一律以主设计文档为准。

## 1. 目标

采集笔记时一并记录**笔记页右下角分享按钮里「复制链接」产出的那个地址**，落到
`note.json` 顶层的 `share_url`。

配套两处界面改动：

- sidepanel 要如实体现分享链接的采集状态与结果
- 浏览页详情栏的「小红书原文」改用 `share_url`，没有时回退到 `url`

## 2. 为什么需要它 —— 一条已作废的项目事实

主设计文档与 `README.md` 里写着「不存 `xsec_token`，想回访原帖靠 `note_id` + 作者主页
链接」。**这条已经不成立。**

实测（2026-08-06，真实登录会话）：

```
导航到 https://www.xiaohongshu.com/explore/6a7149a6000000003400fae7
→ 302 到 /404?…&error_code=300031&error_msg=当前笔记暂时无法浏览
```

也就是说 `note.json` 里现在写的 `url` 字段**已经点不开了**。要回访原帖，地址里必须带
`xsec_token`。分享链接正是平台自己给出的、带 token 的规范形态。

这条作废的说法要在主设计文档、`CLAUDE.md`、`README.md` 里**直接改掉**，不保留旧说法。

## 3. 数据来源（真实登录页面实测）

### 3.1 「复制链接」写进剪贴板的是一整段口令文案

不是纯 URL：

```
61 【40万翻新的自建房还是毛胚怎么办？ - 大疏不是大叔 | 小红书 - 你的生活兴趣社区】 😆 https://www.xiaohongshu.com/discovery/item/6a7149a6000000003400fae7?source=webshare&xhsshare=pc_web&xsec_token=…&xsec_source=pc_share
```

开头的数字是分享码，来自面板打开时发的 `POST /api/sns/web/share/code`（需要签名）。
这个请求**每篇笔记只在面板首次打开时发一次**，同一篇再开面板不再请求。

我们要的是文案里那个 URL。四个 query 参数：`source=webshare`、`xhsshare=pc_web`、
`xsec_token=…`、`xsec_source=pc_share`。

### 3.2 明确否决：本地拼接这个 URL

除 token 外三个参数都是常量，而 token 就是已经读到的 `raw.xsecToken`——所以技术上
完全可以本地拼出来，实测拼出来的地址也能正常打开笔记。

**但不这么做。** 理由：

1. `share/code` 是服务端接口，分享这个动作在服务端可能有对应逻辑；绕过它等于对平台
   的语义做未经验证的假设。
2. 让服务端看到的是与真人一致的操作序列，而不是一个凭空出现的链接。

参数模板由页面自己给出，改版时我们跟着变，不需要维护一份对平台内部约定的猜测。

### 3.3 触发序列（逐条实测）

| 事项 | 结论 |
|---|---|
| 分享按钮 | `.buttons.engage-bar-style .share-wrapper svg`。modal 与独立页都唯一命中 |
| 打开方式 | 对该 svg 依次派发 `pointerdown`/`mousedown`/`pointerup`/`mouseup`/`click` |
| 是否需要 hover 链 | **不需要**。与作者卡片不同，不必对祖先链逐层派发 enter |
| 面板判据 | `.xhs-note-share-popup-action-item` 出现三条：私信好友 / 复制链接 / 扫码分享 |
| 复制 | 对文本为「复制链接」的那一条派发同一组事件 |
| 输出 | 页面调 `navigator.clipboard.writeText(文案)` |
| 复制后 | 面板**不会自动关**，必须再点一次 svg 才收起 |

**踩过的坑**：对 `.share-wrapper`、`.share-icon-container`、`svg` 三层都派发 click，会
连续 toggle 三次，净结果是面板关着——现象看起来像「合成事件对这个组件无效」。
只能点 svg 一个元素。这条要写进代码注释。

**另一个坑**：`document.querySelector('.engage-bar .share-wrapper')` 会命中 modal 背后
信息流卡片上的分享图标（页面上存在两套 `engage-bar`）。必须用
`.buttons.engage-bar-style` 限定。

### 3.4 token 的性质

- **会过期**：这是项目既有结论，不变。
- **每次签发都不同**：实测同一篇笔记，从首页 feed 进和从作者主页进，拿到的
  `xsecToken` 不是同一个值（都是 46 字符）。
- **跨来源可用**：把 feed 签发的 token 放进 `xsec_source=pc_share` 的分享链接里，
  实测正常打开。

结论：`share_url` 是**一段时间内有效的入口**，不是永久凭据。文档必须说清楚。

## 4. 页面脚本 —— `src/page/read-share.ts`

与 `read-author.ts` 平级，注入 MAIN world。函数体会被序列化后在页面上下文运行，
**不能引用本模块的任何外部变量**，常量与辅助函数都得写在函数体里。

### 4.1 流程

1. 定位分享按钮。找不到 → `no_element`。
2. 记录 `alreadyOpen`（面板是不是使用者自己已经点开的）。
3. 未开则点一次 svg，轮询至多 3 秒等 `.xhs-note-share-popup-action-item` 出现。
   没出来 → `no_panel`。
4. 在这三条里找文本含「复制链接」的一条。没有 → `no_item`。
5. 安装剪贴板拦截（见 4.2）。
6. 点这一条，轮询至多 3 秒等接住文本。没接到 → `timeout`。
7. 还原剪贴板方法。
8. 还原面板状态（见 4.3）。
9. 返回**接住的原文**（不解析）。文案 → 链接的映射由 core 层负责，见第 5 节。

这个分层与作者卡片一致：`read-author.ts` 回传 `RawAuthorCard`，字段映射交给
`core/author.ts` 的 `extractAuthorCard`。页面脚本只负责「把东西从页面上弄出来」。

轮询间隔 100 ms，与 `read-author.ts` 一致。

全程 try/catch 且**始终返回值**：抛出去会让 `executeScript` 的 `result` 变成
`undefined`，现场信息全丢。页面内异常归为 `page_error`，注入本身没跑成归为
`inject_failed`，两者分开报——前者是页面侧问题，后者是扩展侧问题。

### 4.2 剪贴板：拦截而不写入

临时替换 `navigator.clipboard.writeText`，接住文本后直接 `resolve()`，**不真正写盘**。
使用者的剪贴板不该因为一次采集被覆盖。

还原必须精确：

```
const desc = Object.getOwnPropertyDescriptor(navigator.clipboard, 'writeText');
// …替换…
// 还原：desc 存在就 defineProperty 还回去，不存在（原本是原型方法）就 delete
```

直接 `delete` 而不看 `desc`，会在页面本来就有同名自有属性时把它永久抹掉。

另备 `document.execCommand('copy')` 通道兜底：真正命中的通道记在 `diag.via`
（`'writeText' | 'execCommand' | null`）。

`navigator.clipboard` 在非安全上下文下可能不存在（jsdom 里默认就没有）——这时跳过
这一路钩子，只留 `execCommand`，不抛异常。

### 4.3 面板状态还原

- `alreadyOpen === false`：结束时点一次 svg 收起。
- `alreadyOpen === true`：保持开着。使用者自己点开的面板不属于我们，不动它。

不做「一律关掉」。

### 4.4 现场快照

无论成败都回传 `ShareDiag`，用于侧边栏工作日志：

```ts
interface ShareDiag {
  elementFound: boolean;
  alreadyOpen: boolean;
  panelFound: boolean;
  via: 'writeText' | 'execCommand' | null;
  waitedMs: number;
  error?: string;
}
```

### 4.5 失败分类

`ShareReadFailure` 只覆盖**页面层**的失败——解析层的两种在第 5 节：

| 值 | 含义 | 排查方向 |
|---|---|---|
| `no_element` | 页面上没有分享按钮 | 多半是改版，选择器失效 |
| `no_panel` | 点了但面板没出来 | 组件行为变化，或页面没就绪 |
| `no_item` | 面板出来了但没有「复制链接」 | 面板项改版 |
| `timeout` | 点了复制但没人写剪贴板 | 复制实现换了通道 |
| `page_error` | 页面内抛异常 | 看 `diag.error` |
| `inject_failed` | 注入本身没跑成 | 扩展权限 / world / 时序 |

```ts
export type ShareReadResult =
  | { ok: true; text: string; diag: ShareDiag }
  | { ok: false; reason: ShareReadFailure; detail?: string; diag: ShareDiag };
```

对外导出 `readShareViaTab(tabId: number): Promise<ShareReadResult>`，与
`readAuthorViaTab` 同形。它**不接收 `expectedNoteId`**——身份校验在解析层做。

## 5. 解析 —— `src/core/share.ts`

```ts
export type ShareUrlFailure = 'no_url' | 'id_mismatch';

export type ShareUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: ShareUrlFailure };

/** 从「复制链接」写进剪贴板的口令文案里取出笔记地址。 */
export function extractShareUrl(text: string, expectedNoteId: string): ShareUrlResult
```

放 core 而不是页面脚本里：它是纯字符串处理，能在 Node 下用 Vitest 跑。

返回**判别联合而不是 `string | null`**：`no_url`（文案模板变了）与 `id_mismatch`
（页面中途切了笔记）指向完全不同的排查方向，兜成同一个 `null` 就等于把这个区别丢掉。

规则：

1. 取第一个链接：`/https?:\/\/[^\s，。！？、）】」"'<>]+/`。字符类同时承担了「在空白
   处截断」与「剥掉尾部中文标点」两件事，不需要再单独做一次 trim。
2. 没匹配到 → `{ ok: false, reason: 'no_url' }`。
3. `expectedNoteId` 必须出现在链接里，否则 → `{ ok: false, reason: 'id_mismatch' }`。

第 3 条与作者卡片的 `uid_mismatch` 同理：页面中途切了笔记时拿到的是上一篇的链接，
写进去就是张冠李戴。副作用是——若平台哪天改用 `xhslink.com` 短链（链接里没有
note_id），这里会报 `id_mismatch`。这是**刻意选择的保守失败**：宁可不写，不可写错。

## 6. 落盘

`note.json` 顶层新增 `share_url`，位置紧跟 `url`：

```json
{
  "schema_version": 1,
  "note_id": "6a7149a6000000003400fae7",
  "url": "https://www.xiaohongshu.com/explore/6a7149a6000000003400fae7",
  "share_url": "https://www.xiaohongshu.com/discovery/item/6a7149a6000000003400fae7?source=webshare&xhsshare=pc_web&xsec_token=…&xsec_source=pc_share",
  "type": "normal",
  "title": "…"
}
```

- **采不到就整个字段缺席**，不写空串占位。沿用作者卡片那条决策。
  实现上 `serializeNote` 里写 `share_url: n.share_url`，`JSON.stringify` 自然丢掉
  `undefined`，其余 key 顺序不受影响。
- **`url` 保持不动**。它是这篇笔记的稳定身份（长期不变、无凭据、可读），
  `share_url` 是当下能点开的入口。两者语义分开。
- **`schema_version` 不升**。新增一个可缺席的可选字段，旧读取方（`row-meta.ts`
  用 `?? ''` 兜底）不受影响。

### 6.1 关于 diff 噪音

token 每次签发都不同，所以每次重采 `share_url` 这一行都会变。可以接受：重采本来
就会改 `last_archived_at`、`archive_count` 与互动数，多一行不构成新的噪音来源。

### 6.2 关于「不存 xsec_token」

既有决策表里的「不存 `xsec_token`」这条，实际上一直只对**顶层 `url` 字段**成立——
`serialize.ts` 把整个 `raw` 写进 `note.json`，`raw.xsecToken` 与 `raw.user.xsecToken`
早就在盘上了。所以 `share_url` 不构成新的凭据落盘，只是把已经在盘上的东西提到顶层、
拼成可用形态。文档里那条决策要按此重述。

## 7. 接线

### 7.1 类型

- `ExtractedNote` 加 `shareUrl?: string`。extractor 是纯函数、拿不到页面，所以由
  sidepanel 在 `noteToWrite` 上补——与 `noteToWrite.author = { ...card }` 同一模式。
- `NoteRecord` 加 `share_url?: string`，archiver 里 `share_url: note.shareUrl`。
- `archive()` 的签名不变。

### 7.2 sidepanel

`doArchive` 顺序：权限/目录检查 → 读作者卡片 → **读分享链接** → 下载图片 → 落盘。
两步页面交互串行，各自包在 try/catch 里，任一步出错都不影响归档。

`ArchiveOutcome` 加 `share: ShareOutcome`：

```ts
export type ShareOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: ShareReadFailure | ShareUrlFailure };
```

失败原因是页面层与解析层两个 union 的合并——这两层各自的失败都要能原样报给使用者。

结果卡在「作者」下面多一行「分享链接」：成功显示已记录，失败显示原因并提示
「重采这篇可以再试」。

采集中的提示：现有的 `authorReading: boolean` 已经不够用（现在是两步），改成
`pageStep: 'author' | 'share' | null`，文案分别是「正在读取作者信息…」与
「正在读取分享链接…」，后者补一句「页面上会弹一下分享面板」。

### 7.3 浏览页

- `NoteDetail` 加 `shareUrl: string`，`loadNote` 里 `shareUrl: j.share_url ?? ''`。
- `AuthorBlock` 的「小红书原文 ↗」改用 `shareUrl || url`。老数据没有 `share_url`
  就回退到旧地址（点开是 404，重采一次即可修复）。
- **列表页不动**，不加列，不加提示文案。

## 8. 失败即缺席，不阻断归档

分享链接采不到时：

- `note.json` 里不写 `share_url`
- 归档状态**不受影响**，不算进 `partial`
- 侧边栏如实说明失败原因

与作者信息、评论配图同一条决策：附属数据不该把主干拖下水。

## 9. 测试

全部 Vitest，不需要真实浏览器。

| 文件 | 覆盖 |
|---|---|
| `tests/core/share.test.ts` | `extractShareUrl`：口令文案 → `ok` / 裸链接 → `ok` / 无链接 → `no_url` / 空串 → `no_url` / id 不符 → `id_mismatch` / 尾部还有文案 / 尾部中文标点 |
| `tests/page/read-share.test.ts` | 见下 |
| `tests/core/serialize.test.ts` | 有 `share_url` 时紧跟 `url`；`undefined` 时整个 key 缺席 |
| `tests/core/archiver.test.ts` | `shareUrl` 透传进 `note.json`；不传时不出现 |
| `tests/browser/detail-pane.test.ts` | 有 `share_url` 用它；没有时回退到 `url` |

`tests/page/read-share.test.ts` 在 jsdom 里搭出实测 DOM 与一个假面板（点 svg 切换
面板挂载，点「复制链接」调 `navigator.clipboard.writeText`），覆盖：

- 找不到分享按钮 → `no_element`
- 正常流程 → `ok`，回传的原文与页面写入剪贴板的一致
- 面板本来就开着 → 不重复点开（`diag.alreadyOpen` 为真），结束时保持开着
- 面板是我们点开的 → 结束时收起
- **原始 `writeText` 从未被调用**（剪贴板没被覆盖）
- 结束后 `navigator.clipboard.writeText` 已还原
- 面板不出来 → `no_panel`
- 面板里没有「复制链接」→ `no_item`
- 没人写剪贴板 → `timeout`

`id_mismatch` 与 `no_url` 属于解析层，由 `tests/core/share.test.ts` 覆盖，页面脚本
测试不重复验。

jsdom 里 `navigator.clipboard` 不存在，测试自己 `defineProperty` 装一个。
`PointerEvent` 也可能缺，页面代码降级到 `MouseEvent`——与 `read-author.ts` 同一处理。

## 10. 明确不做

- 不采「扫码分享」的二维码
- 不存口令文案全文（含标题，与 `title` 冗余）
- 不存 `share/code` 返回的分享码
- 不为历史数据做批量补采
- 不改 `schema_version`
- 不在浏览页列表加列

## 11. 已知代价

采集时分享面板会在使用者眼前弹出约 1~2 秒，并可能闪一下「复制成功」toast。

这与「评论只采已加载的，不滚动、不点展开」那条决策存在张力。区别在于：分享链接
**除了走 UI 没有别的正当拿法**（本地拼接见 3.2 已否决），而评论有别的拿法，只是我们
选择不用。使用者已确认接受这个可见变化。
